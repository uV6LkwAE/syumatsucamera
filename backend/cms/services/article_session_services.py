"""
記事編集セッションサービスを定義する。
"""
from datetime import datetime, timedelta
import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from cms.models import Article
from redis_layer.client import get_redis_client
from redis_layer.keys import LockKeys
from redis_layer.lock import acquire_lock, extend_lock, get_lock_token, release_lock
from users.models import User, UserRole

SESSION_KEY_PREFIX = "cms:article-session"


@dataclass
class ArticleSessionPayload:
    """
    記事編集セッションの内部表現。
    """

    lock_token: str
    locked_by_id: str
    article_id: str | None
    lock_expires_at: str


class ArticleSessionService:
    """
    記事編集セッションの業務ロジックを扱う。
    """

    @staticmethod
    def create_session(*, user: User, article_id=None) -> dict:
        """
        編集セッションを作成して返す。
        """
        ArticleSessionService._prune_stale_tmp_dirs()

        if article_id is None:
            reusable_session = ArticleSessionService._find_reusable_draft_session(user=user)
            if reusable_session is not None:
                expires_at = timezone.now() + timedelta(
                    seconds=settings.CMS_ARTICLE_SESSION_TTL_SECONDS
                )
                reusable_session.lock_expires_at = expires_at.isoformat()
                ArticleSessionService._store_session(reusable_session)
                ArticleSessionService._ensure_tmp_dir(lock_token=reusable_session.lock_token)
                return ArticleSessionService._build_response(
                    session=reusable_session,
                    article=None,
                )

        article = None
        if article_id is not None:
            try:
                article = Article.objects.select_related("author").get(id=article_id)
            except Article.DoesNotExist as exc:
                raise NotFound("記事が存在しません。") from exc

            if user.role != UserRole.ADMIN and str(article.author_id) != str(user.id):
                raise PermissionDenied("対象記事の編集権限がありません。")

            existing_token = get_lock_token(LockKeys.article_edit(str(article.id)))
            if existing_token is not None:
                existing_session = ArticleSessionService._get_session(lock_token=existing_token)
                if existing_session is None:
                    ArticleSessionService._cleanup_expired_lock(
                        lock_token=existing_token,
                        article=article,
                    )
                elif existing_session.locked_by_id == str(user.id):
                    return ArticleSessionService._build_response(
                        session=existing_session,
                        article=article,
                    )
                else:
                    raise PermissionDenied("この記事は他のユーザーが編集中です。")

        lock_token = str(uuid.uuid4())
        expires_at = timezone.now() + timedelta(
            seconds=settings.CMS_ARTICLE_SESSION_TTL_SECONDS
        )
        session = ArticleSessionPayload(
            lock_token=lock_token,
            locked_by_id=str(user.id),
            article_id=str(article.id) if article is not None else None,
            lock_expires_at=expires_at.isoformat(),
        )

        if article is not None:
            acquired = acquire_lock(
                LockKeys.article_edit(str(article.id)),
                settings.CMS_ARTICLE_SESSION_TTL_SECONDS,
                token=lock_token,
            )
            if acquired is None:
                raise PermissionDenied("この記事は他のユーザーが編集中です。")
            ArticleSessionService._sync_article_lock_state(
                article=article,
                user=user,
                lock_token=lock_token,
                expires_at=expires_at,
            )

        ArticleSessionService._store_session(session)
        ArticleSessionService._ensure_tmp_dir(lock_token=lock_token)
        return ArticleSessionService._build_response(session=session, article=article)

    @staticmethod
    def refresh_session(*, user: User, lock_token: str) -> dict:
        """
        セッションTTLを延長する。
        """
        session = ArticleSessionService._get_owned_session(user=user, lock_token=lock_token)
        expires_at = timezone.now() + timedelta(
            seconds=settings.CMS_ARTICLE_SESSION_TTL_SECONDS
        )
        session.lock_expires_at = expires_at.isoformat()
        ArticleSessionService._store_session(session)

        article = None
        if session.article_id is not None:
            try:
                article = Article.objects.get(id=session.article_id)
            except Article.DoesNotExist as exc:
                raise NotFound("記事が存在しません。") from exc

            extended = extend_lock(
                LockKeys.article_edit(session.article_id),
                lock_token,
                settings.CMS_ARTICLE_SESSION_TTL_SECONDS,
            )
            if not extended:
                ArticleSessionService._cleanup_expired_lock(
                    lock_token=lock_token,
                    article=article,
                )
                raise PermissionDenied("編集ロックが失効しています。")
            ArticleSessionService._sync_article_lock_state(
                article=article,
                user=user,
                lock_token=lock_token,
                expires_at=expires_at,
            )

        return ArticleSessionService._build_response(session=session, article=article)

    @staticmethod
    def release_session(*, user: User, lock_token: str) -> None:
        """
        編集セッションを解放する。
        """
        session = ArticleSessionService._get_owned_session(user=user, lock_token=lock_token)
        ArticleSessionService._delete_session(lock_token=lock_token)

        if session.article_id is not None:
            release_lock(LockKeys.article_edit(session.article_id), lock_token)
            Article.objects.filter(id=session.article_id).update(
                locked_by=None,
                locked_at=None,
                lock_token=None,
                lock_expires_at=None,
                updated_at=timezone.now(),
            )
        ArticleSessionService._cleanup_temp_dir(lock_token=lock_token)

    @staticmethod
    def assert_session_owner(*, user: User, lock_token: str, article: Article | None = None) -> None:
        """
        保存API用にロック所有者を検証する。
        """
        session = ArticleSessionService._get_owned_session(user=user, lock_token=lock_token)
        if article is not None:
            if session.article_id is not None and session.article_id != str(article.id):
                raise PermissionDenied("編集ロック対象の記事が一致しません。")
            if session.article_id is None:
                ArticleSessionService.bind_session_to_article(
                    user=user,
                    lock_token=lock_token,
                    article=article,
                )

    @staticmethod
    def bind_session_to_article(*, user: User, lock_token: str, article: Article) -> None:
        """
        新規作成後にセッションを記事へ紐付ける。
        """
        session = ArticleSessionService._get_owned_session(user=user, lock_token=lock_token)

        acquired = acquire_lock(
            LockKeys.article_edit(str(article.id)),
            settings.CMS_ARTICLE_SESSION_TTL_SECONDS,
            token=lock_token,
        )
        if acquired is None and get_lock_token(LockKeys.article_edit(str(article.id))) != lock_token:
            raise PermissionDenied("この記事は他のユーザーが編集中です。")

        session.article_id = str(article.id)
        ArticleSessionService._store_session(session)
        ArticleSessionService._sync_article_lock_state(
            article=article,
            user=user,
            lock_token=lock_token,
            expires_at=datetime.fromisoformat(session.lock_expires_at),
        )

    @staticmethod
    def _build_response(*, session: ArticleSessionPayload, article: Article | None) -> dict:
        """
        API返却用のセッション情報を組み立てる。
        """
        locked_by = User.objects.get(id=session.locked_by_id)
        return {
            "article_id": article.id if article is not None else None,
            "default_thumbnail_preview_path": settings.DEFAULT_OG_IMAGE_PATH,
            "lock_token": session.lock_token,
            "locked_by_id": locked_by.id,
            "locked_by": locked_by,
            "lock_expires_at": datetime.fromisoformat(session.lock_expires_at),
        }

    @staticmethod
    def _ensure_tmp_dir(*, lock_token: str) -> Path:
        """
        セッション用 tmp ディレクトリを作成する。
        """
        path = Path(settings.MEDIA_ROOT) / "tmp" / lock_token
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _cleanup_temp_dir(*, lock_token: str) -> None:
        """
        セッション用 tmp ディレクトリを削除する。
        """
        path = Path(settings.MEDIA_ROOT) / "tmp" / lock_token
        if path.exists():
            shutil.rmtree(path)

    @staticmethod
    def _store_session(session: ArticleSessionPayload) -> None:
        """
        Redis にセッション情報を保存する。
        """
        get_redis_client().set(
            ArticleSessionService._session_key(session.lock_token),
            json.dumps(
                {
                    "lock_token": session.lock_token,
                    "locked_by_id": session.locked_by_id,
                    "article_id": session.article_id,
                    "lock_expires_at": session.lock_expires_at,
                }
            ),
            ex=settings.CMS_ARTICLE_SESSION_TTL_SECONDS,
        )

    @staticmethod
    def _get_owned_session(*, user: User, lock_token: str) -> ArticleSessionPayload:
        """
        指定ユーザー所有のセッションを取得する。
        """
        session = ArticleSessionService._get_session(lock_token=lock_token)
        if session is None:
            ArticleSessionService._cleanup_expired_lock(lock_token=lock_token)
            raise PermissionDenied("編集ロックが存在しません。")
        if session.locked_by_id != str(user.id):
            raise PermissionDenied("この編集ロックの所有者ではありません。")
        return session

    @staticmethod
    def _get_session(*, lock_token: str) -> ArticleSessionPayload | None:
        """
        Redis からセッション情報を取得する。
        """
        raw = get_redis_client().get(ArticleSessionService._session_key(lock_token))
        if raw is None:
            return None
        return ArticleSessionService._deserialize_session(raw)

    @staticmethod
    def _delete_session(*, lock_token: str) -> None:
        """
        Redis からセッション情報を削除する。
        """
        get_redis_client().delete(ArticleSessionService._session_key(lock_token))

    @staticmethod
    def _cleanup_expired_lock(*, lock_token: str, article: Article | None = None) -> None:
        """
        失効した編集ロックに紐づく一時データと状態を掃除する。
        """
        target_article = article
        if target_article is None:
            target_article = Article.objects.filter(lock_token=lock_token).first()

        ArticleSessionService._delete_session(lock_token=lock_token)
        ArticleSessionService._cleanup_temp_dir(lock_token=lock_token)

        if target_article is None:
            return

        release_lock(LockKeys.article_edit(str(target_article.id)), lock_token)
        Article.objects.filter(id=target_article.id).update(
            locked_by=None,
            locked_at=None,
            lock_token=None,
            lock_expires_at=None,
            updated_at=timezone.now(),
        )

    @staticmethod
    def _deserialize_session(raw: str | bytes) -> ArticleSessionPayload:
        """
        Redis 取得値をセッション表現へ変換する。
        """
        payload = json.loads(raw)
        return ArticleSessionPayload(
            lock_token=payload["lock_token"],
            locked_by_id=payload["locked_by_id"],
            article_id=payload.get("article_id"),
            lock_expires_at=payload["lock_expires_at"],
        )

    @staticmethod
    def _find_reusable_draft_session(*, user: User) -> ArticleSessionPayload | None:
        """
        同一ユーザーの未記事紐付けセッションを再利用対象として返す。
        """
        redis_client = get_redis_client()
        candidate: ArticleSessionPayload | None = None
        duplicate_sessions: list[ArticleSessionPayload] = []

        for key in redis_client.scan_iter(match=ArticleSessionService._session_key("*")):
            raw = redis_client.get(key)
            if raw is None:
                continue

            session = ArticleSessionService._deserialize_session(raw)
            if session.locked_by_id != str(user.id) or session.article_id is not None:
                continue

            if candidate is None:
                candidate = session
                continue

            candidate_expires_at = datetime.fromisoformat(candidate.lock_expires_at)
            session_expires_at = datetime.fromisoformat(session.lock_expires_at)
            if session_expires_at > candidate_expires_at:
                duplicate_sessions.append(candidate)
                candidate = session
                continue

            duplicate_sessions.append(session)

        for duplicate_session in duplicate_sessions:
            ArticleSessionService._delete_session(lock_token=duplicate_session.lock_token)
            ArticleSessionService._cleanup_temp_dir(lock_token=duplicate_session.lock_token)

        return candidate

    @staticmethod
    def _prune_stale_tmp_dirs() -> None:
        """
        TTL切れ後に残った tmp ディレクトリを削除する。
        """
        tmp_root = Path(settings.MEDIA_ROOT) / "tmp"
        if not tmp_root.exists():
            return

        now_timestamp = timezone.now().timestamp()

        for path in tmp_root.iterdir():
            if not path.is_dir():
                continue

            try:
                uuid.UUID(path.name)
            except ValueError:
                continue

            if ArticleSessionService._get_session(lock_token=path.name) is not None:
                continue

            age_seconds = now_timestamp - path.stat().st_mtime
            if age_seconds < settings.CMS_ARTICLE_SESSION_TTL_SECONDS:
                continue

            shutil.rmtree(path)

    @staticmethod
    def _session_key(lock_token: str) -> str:
        """
        セッション格納キーを返す。
        """
        return f"{SESSION_KEY_PREFIX}:{lock_token}"

    @staticmethod
    def _sync_article_lock_state(*, article: Article, user: User, lock_token: str, expires_at) -> None:
        """
        記事ロック状態をDBへ反映する。
        """
        article.locked_by = user
        article.locked_at = timezone.now()
        article.lock_token = lock_token
        article.lock_expires_at = expires_at
        article.save(update_fields=["locked_by", "locked_at", "lock_token", "lock_expires_at", "updated_at"])
