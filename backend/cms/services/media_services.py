"""
メディア操作サービスを定義する。
"""
import logging
import hashlib
import io
import re
import shutil
import uuid
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from django.conf import settings
from django.utils.text import slugify
from PIL import ExifTags, Image, ImageCms, ImageDraw, ImageFont, ImageOps
from rest_framework.exceptions import ValidationError

from cms.models import (
    Article,
    MediaAsset,
)
from core.media_urls import build_cdn_media_url

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif"}
THUMBNAIL_IMAGE_EXTENSIONS = {"jpg", "jpeg"}
IMAGE_FORMATS_BY_EXTENSION = {
    "jpg": {"JPEG", "MPO"},
    "jpeg": {"JPEG", "MPO"},
    "png": {"PNG"},
    "gif": {"GIF"},
}
SITE_WATERMARK_FONT_PATH = Path("/Caveat/static/Caveat-Bold.ttf")
SITE_WATERMARK_TEXT = "@syumatsucamera"
SITE_WATERMARK_WIDTH_RATIO = 0.22
SITE_WATERMARK_OPACITY = 1.0

EXIF_DISPLAY_FIELDS = (
    ("ISO", 34855),
    ("F", 33437),
    ("SS", 33434),
    ("WB", 41987),
    ("機種名", 272),
    ("レンズ", 42036),
    ("焦点距離", 37386),
)


class MediaService:
    """
    記事画像の保存と処理を扱う。
    """

    THUMBNAIL_WIDTH = 1200
    THUMBNAIL_HEIGHT = 630

    @staticmethod
    def default_processing_options() -> dict:
        """
        記事画像の既定処理オプションを返す。
        """
        return {
            "exif_watermark": False,
            "site_logo_watermark": False,
        }

    @staticmethod
    def normalize_processing_options(*, processing_options: dict | None) -> dict:
        """
        処理オプションを既定値込みで正規化する。
        """
        normalized = MediaService.default_processing_options()
        if processing_options is None:
            return normalized

        for key in normalized:
            if key in processing_options:
                normalized[key] = bool(processing_options[key])
        return normalized

    @staticmethod
    def validate_uploaded_image(*, uploaded_file, file_name: str) -> None:
        """
        アップロード画像の形式とサイズを検証する。
        """
        if uploaded_file.size > settings.CMS_ARTICLE_IMAGE_UPLOAD_MAX_BYTES:
            raise ValidationError(
                {"file": ["画像サイズは60MB以下である必要があります。"]}
            )

        extension = file_name.rsplit(".", 1)[1].lower()
        allowed_formats = IMAGE_FORMATS_BY_EXTENSION.get(extension)
        if allowed_formats is None:
            raise ValidationError(
                {"file": ["対応していない画像形式です。jpg/jpeg/png/gif を使用してください。"]}
            )

        try:
            image = Image.open(uploaded_file)
            image_format = image.format
            image.verify()
        except Exception as exc:
            raise ValidationError({"file": ["画像ファイルの形式が不正です。"]}) from exc
        finally:
            uploaded_file.seek(0)
        if image_format not in allowed_formats:
            raise ValidationError(
                {"file": ["対応していない画像形式です。jpg/jpeg/png/gif を使用してください。"]}
            )

    @staticmethod
    def validate_temp_file_name(*, file_name: str) -> None:
        """
        一時保存ファイル名が UUID.ext 形式か検証する。
        """
        if "." not in file_name:
            raise ValidationError({"file_name": ["ファイル名の形式が不正です。"]})
        stem, ext = file_name.rsplit(".", 1)
        try:
            uuid.UUID(stem)
        except ValueError as exc:
            raise ValidationError({"file_name": ["ファイル名のUUIDが不正です。"]}) from exc
        if ext.lower() not in IMAGE_EXTENSIONS:
            raise ValidationError(
                {"file_name": ["対応していない画像拡張子です。jpg/jpeg/png/gif を使用してください。"]}
            )

    @staticmethod
    def validate_thumbnail_source_file_name(*, file_name: str) -> None:
        """
        サムネイル用の元画像ファイル名を検証する。
        """
        if "." not in file_name:
            raise ValidationError({"file_name": ["サムネイル画像は jpg/jpeg のみを使用してください。"]})
        extension = file_name.rsplit(".", 1)[1].lower()
        if extension not in THUMBNAIL_IMAGE_EXTENSIONS:
            raise ValidationError({"file_name": ["サムネイル画像は jpg/jpeg のみを使用してください。"]})

    @staticmethod
    def save_temp_upload(*, lock_token: str, uploaded_file) -> dict:
        """
        一時保存領域へ画像を保存する。
        """
        file_name = uploaded_file.name
        MediaService.validate_temp_file_name(file_name=file_name)
        MediaService.validate_uploaded_image(
            uploaded_file=uploaded_file,
            file_name=file_name,
        )

        target_dir = MediaService.build_temp_dir(lock_token=lock_token)
        target_path = target_dir / file_name
        with target_path.open("wb") as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)

        return {
            "file_name": file_name,
            "path": MediaService.build_temp_media_path(lock_token=lock_token, file_name=file_name),
        }

    @staticmethod
    def validate_image_diff(*, body_html: str, image_diff: dict) -> None:
        """
        画像差分JSONと本文HTMLの整合を検証する。
        """
        lock_token = str(image_diff["lock_token"])
        new_images = image_diff["new_images"]
        thumbnail_request = image_diff["thumbnail_request"]
        soup = BeautifulSoup(body_html, "lxml")
        html_tmp_file_names: set[str] = set()
        for image in soup.find_all("img"):
            source = MediaService.normalize_media_source_path(source=str(image.get("src", "")).strip())
            prefix = f"{settings.MEDIA_URL}tmp/{lock_token}/"
            if source.startswith(prefix):
                html_tmp_file_names.add(source.removeprefix(prefix))

        new_image_names = set()
        for new_image in new_images:
            file_name = new_image["file_name"]
            MediaService.validate_temp_file_name(file_name=file_name)
            if not MediaService.temp_file_path(lock_token=lock_token, file_name=file_name).exists():
                raise ValidationError(
                    {"image_diff": [f"一時画像が存在しません: {file_name}"]}
                )
            original_file_path = new_image.get("original_file_path")
            if original_file_path:
                original_file_path = str(original_file_path)
                if not original_file_path.startswith("original/"):
                    raise ValidationError(
                        {"image_diff": [f"original_file_path の形式が不正です: {original_file_path}"]}
                    )
                if not MediaService.resolve_storage_path(storage_key=original_file_path).exists():
                    raise ValidationError(
                        {"image_diff": [f"オリジナル画像が存在しません: {original_file_path}"]}
                    )
            new_image_names.add(file_name)

        if not html_tmp_file_names.issubset(
            new_image_names | MediaService._thumbnail_source_candidates(thumbnail_request)
        ):
            raise ValidationError({"image_diff": ["本文内のtmp画像と差分JSONが一致しません。"]})

        thumbnail_file_name = thumbnail_request.get("file_name")
        if thumbnail_file_name:
            MediaService.validate_temp_file_name(file_name=thumbnail_file_name)
            MediaService.validate_thumbnail_source_file_name(file_name=thumbnail_file_name)
            if not MediaService.temp_file_path(
                lock_token=lock_token,
                file_name=thumbnail_file_name,
            ).exists():
                raise ValidationError(
                    {"image_diff": [f"サムネイル元画像が存在しません: {thumbnail_file_name}"]}
                )

    @staticmethod
    def build_temp_dir(*, lock_token: str) -> Path:
        """
        セッション用 tmp ディレクトリを返す。
        """
        path = Path(settings.MEDIA_ROOT) / "tmp" / str(lock_token)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def temp_file_path(*, lock_token: str, file_name: str) -> Path:
        """
        一時保存画像のパスを返す。
        """
        return MediaService.build_temp_dir(lock_token=lock_token) / file_name

    @staticmethod
    def delete_media_asset_files(*, asset: MediaAsset) -> None:
        """
        アセット実体ファイルを削除する。
        """
        public_path = MediaService.build_public_storage_path(file_name=asset.file_name)
        if public_path.exists():
            public_path.unlink()

        original_file_path = getattr(asset, "original_file_path", None)
        if not original_file_path:
            return

        still_referenced = MediaAsset.objects.exclude(id=asset.id).filter(
            original_file_path=original_file_path,
        ).exists()
        if still_referenced:
            return

        original_path = MediaService.resolve_storage_path(storage_key=original_file_path)
        if original_path.exists():
            original_path.unlink()

    @staticmethod
    def cleanup_temp_dir(*, lock_token: str) -> None:
        """
        セッション tmp ディレクトリを削除する。
        """
        path = Path(settings.MEDIA_ROOT) / "tmp" / str(lock_token)
        if path.exists():
            shutil.rmtree(path)

    @staticmethod
    def create_or_replace_thumbnail_asset(*, article: Article, thumbnail_request: dict) -> MediaAsset | None:
        """
        サムネイル用アセットのプレースホルダを作成する。
        """
        if thumbnail_request["mode"] == "use_default":
            return None
        if thumbnail_request["mode"] == "keep_current":
            return article.thumbnail_asset

        if thumbnail_request["mode"] == "use_uploaded":
            requested_file_name = thumbnail_request.get("file_name")
            if not requested_file_name:
                raise ValidationError({"file_name": ["サムネイル画像ファイル名が不足しています。"]})
            MediaService.validate_thumbnail_source_file_name(file_name=requested_file_name)

        suffix = ".png"
        requested_file_name = thumbnail_request.get("file_name")
        if requested_file_name and "." in requested_file_name:
            suffix = "." + requested_file_name.rsplit(".", 1)[1].lower()
        file_name = f"{uuid.uuid4()}{suffix}"

        asset = MediaAsset.objects.create(
            article=article,
            file_name=file_name,
            original_file_path=MediaService.build_original_storage_key(file_name=file_name),
            processing_options_json={"thumbnail_request": thumbnail_request},
        )
        return asset

    @staticmethod
    def process_uploaded_asset(
        *,
        article: Article,
        source_file_name: str,
        stored_file_name: str,
        processing_options: dict,
        lock_token: str,
        asset: MediaAsset | None = None,
        original_file_path: str | None = None,
    ) -> MediaAsset:
        """
        tmp 画像を最終保存先へ移しアセットを返す。
        """
        source_path = MediaService.temp_file_path(lock_token=lock_token, file_name=source_file_name)
        if not source_path.exists():
            raise ValidationError(f"一時画像が存在しません。: {source_file_name}")
        extension = stored_file_name.rsplit(".", 1)[1].lower()

        resolved_original_file_path = (
            original_file_path
            or (
                asset.original_file_path
                if asset is not None and getattr(asset, "original_file_path", None)
                else None
            )
            or MediaService.build_original_storage_key(file_name=stored_file_name)
        )
        original_path = MediaService.resolve_storage_path(storage_key=resolved_original_file_path)
        public_path = MediaService.build_public_storage_path(file_name=stored_file_name)
        original_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)

        if not original_path.exists():
            shutil.copyfile(source_path, original_path)
        source_size = original_path.stat().st_size

        with Image.open(original_path) as original_image:
            exif_json = MediaService.extract_exif(image=original_image)
            if exif_json is None:
                logger.log(
                    logging.INFO,
                    "原本にEXIF情報がありません: file_name=%s original_path=%s",
                    stored_file_name,
                    original_path,
                )
            else:
                logger.log(
                    logging.INFO,
                    "原本からEXIFを取得しました: file_name=%s original_path=%s exif_keys=%s",
                    stored_file_name,
                    original_path,
                    ",".join(exif_json.keys()),
                )

            if extension == "gif":
                width, height = original_image.size
                shutil.copyfile(original_path, public_path)
                checksum = MediaService.calculate_sha256_from_path(file_path=public_path)
            else:
                public_raw, width, height = MediaService.build_public_image_bytes(
                    source_image=original_image,
                    source_size=source_size,
                    stored_file_name=stored_file_name,
                    processing_options=processing_options,
                    exif_json=exif_json,
                )
                checksum = hashlib.sha256(public_raw).hexdigest()
                with public_path.open("wb") as destination:
                    destination.write(public_raw)

        if asset is None:
            asset, created = MediaAsset.objects.get_or_create(
                file_name=stored_file_name,
                defaults={
                    "article": article,
                    "original_file_path": resolved_original_file_path,
                },
            )
            if not created and asset.article_id != article.id:
                raise RuntimeError("画像アセットの所有記事が一致しません。")
        elif asset.article_id != article.id:
            raise RuntimeError("画像アセットの所有記事が一致しません。")

        if asset.original_file_path != resolved_original_file_path:
            asset.original_file_path = resolved_original_file_path

        asset.width = width
        asset.height = height
        asset.checksum_sha256 = checksum
        asset.exif_json = exif_json
        asset.processing_options_json = MediaService.normalize_processing_options(
            processing_options=processing_options
        )
        asset.save(
            update_fields=[
                "width",
                "height",
                "checksum_sha256",
                "exif_json",
                "processing_options_json",
                "original_file_path",
                "updated_at",
            ]
        )
        return asset

    @staticmethod
    def calculate_sha256_from_path(*, file_path: Path) -> str:
        """
        ファイルパスから SHA-256 を返す。
        """
        hasher = hashlib.sha256()
        with file_path.open("rb") as file_obj:
            for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    @staticmethod
    def build_public_image_bytes(
        *,
        source_image: Image.Image,
        source_size: int,
        stored_file_name: str,
        processing_options: dict,
        exif_json: dict | None,
    ) -> tuple[bytes, int, int]:
        """
        公開用画像 bytes とサイズを返す。
        """
        extension = stored_file_name.rsplit(".", 1)[1].lower()
        logger.log(
            logging.INFO,
            "公開画像処理を開始しました: file_name=%s extension=%s raw_bytes=%s options=%s",
            stored_file_name,
            extension,
            source_size,
            {
                "exif_watermark": bool(processing_options.get("exif_watermark")),
                "site_logo_watermark": bool(processing_options.get("site_logo_watermark")),
            },
        )
        normalized_options = MediaService.normalize_processing_options(processing_options=processing_options)

        if extension in {"jpg", "jpeg"}:
            source_image.draft(
                "RGB",
                (settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE, settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE),
            )
        working_image = ImageOps.exif_transpose(source_image)
        working_image.load()

        working_image = MediaService._convert_image_to_srgb(
            working_image=working_image,
            stored_file_name=stored_file_name,
        )

        width, height = working_image.size
        long_edge = max(width, height)
        if long_edge > settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE:
            logger.log(
                logging.INFO,
                "画像リサイズを実行します: file_name=%s size=%sx%s limit=%s",
                stored_file_name,
                width,
                height,
                settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE,
            )
            working_image = MediaService._resize_image(working_image=working_image)
        else:
            logger.log(
                logging.INFO,
                "画像リサイズをスキップします: file_name=%s size=%sx%s limit=%s",
                stored_file_name,
                width,
                height,
                settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE,
            )

        if normalized_options["exif_watermark"]:
            if exif_json is None:
                logger.log(
                    logging.WARNING,
                    "EXIF透かしが有効ですがEXIFを取得できませんでした: file_name=%s",
                    stored_file_name,
                )
            else:
                logger.log(
                    logging.INFO,
                    "EXIF透かしを描画します: file_name=%s exif_keys=%s",
                    stored_file_name,
                    ",".join(exif_json.keys()),
                )
            working_image = MediaService._apply_exif_watermark(
                working_image=working_image,
                exif_json=exif_json,
                stored_file_name=stored_file_name,
            )
        else:
            logger.log(
                logging.INFO,
                "EXIF透かしをスキップします: file_name=%s",
                stored_file_name,
            )

        if normalized_options["site_logo_watermark"]:
            logger.log(
                logging.INFO,
                "サイトロゴ透かしを描画します: file_name=%s",
                stored_file_name,
            )
            working_image = MediaService._apply_site_logo_watermark(
                working_image=working_image
            )
        else:
            logger.log(
                logging.INFO,
                "サイトロゴ透かしをスキップします: file_name=%s",
                stored_file_name,
            )

        public_raw, width, height = MediaService._serialize_public_image(
            working_image=working_image,
            extension=extension,
        )
        logger.log(
            logging.INFO,
            "公開画像をシリアライズしました: file_name=%s bytes=%s",
            stored_file_name,
            len(public_raw),
        )
        return public_raw, width, height

    def rewrite_temp_paths_to_public(
        *,
        body_html: str,
        lock_token: str,
        public_paths_by_source_file_name: dict[str, str],
    ) -> str:
        """
        本文内の tmp 画像URLを公開URLへ置換する。
        """
        soup = BeautifulSoup(body_html, "lxml")
        prefix = f"{settings.MEDIA_URL}tmp/{lock_token}/"

        for image in soup.find_all("img"):
            source = MediaService.normalize_media_source_path(source=str(image.get("src", "")).strip())
            if not source.startswith(prefix):
                continue
            file_name = source.removeprefix(prefix)
            public_path = public_paths_by_source_file_name.get(file_name)
            if public_path is None:
                raise RuntimeError(f"公開先画像パスが見つかりません: {file_name}")
            image["src"] = public_path

        return MediaService._serialize_html_fragment(soup=soup)

    @staticmethod
    def generate_thumbnail_image(
        *,
        asset: MediaAsset,
        title_text: str,
        author_display_name: str,
        author_icon_path: str | None,
    ) -> MediaAsset:
        """
        文字列ベースのサムネイル画像を生成する。
        """
        title_font = MediaService._load_thumbnail_font(
            font_path=settings.CMS_THUMBNAIL_FONT_BOLD_PATH,
            size=64,
        )
        author_font = MediaService._load_thumbnail_font(
            font_path=settings.CMS_THUMBNAIL_FONT_BOLD_PATH,
            size=34,
        )
        image = MediaService._create_thumbnail_background()
        draw = ImageDraw.Draw(image)

        title_lines = MediaService._wrap_thumbnail_text(
            draw=draw,
            text=title_text.strip() or settings.CMS_THUMBNAIL_BRAND_NAME,
            font=title_font,
            max_width=930,
            max_lines=3,
        )

        current_y = 108
        for line in title_lines:
            draw.text((110, current_y), line, fill=(16, 24, 40), font=title_font)
            line_height = MediaService._measure_text_box(
                draw=draw,
                text=line,
                font=title_font,
            )[3]
            current_y += line_height + 20

        avatar = MediaService._build_author_avatar(
            stored_path=author_icon_path,
            size=74,
            display_name=author_display_name,
        )
        avatar_x = 110
        avatar_y = 474
        image.paste(avatar, (avatar_x, avatar_y), avatar)
        author_name = author_display_name.strip()
        author_text_box = MediaService._measure_text_box(
            draw=draw,
            text=author_name,
            font=author_font,
        )
        author_text_height = author_text_box[3] - author_text_box[1]
        author_text_x = avatar_x + 94
        author_text_y = avatar_y + ((74 - author_text_height) / 2) - author_text_box[1]
        draw.text(
            (author_text_x, author_text_y),
            author_name,
            fill=(28, 41, 61),
            font=author_font,
        )

        MediaService._draw_brand_logo(
            image=image,
            canvas_width=image.width,
            canvas_height=image.height,
        )

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        raw = buffer.getvalue()
        checksum = hashlib.sha256(raw).hexdigest()

        if not getattr(asset, "original_file_path", None):
            asset.original_file_path = MediaService.build_original_storage_key(
                file_name=asset.file_name,
            )

        original_path = MediaService.resolve_storage_path(storage_key=asset.original_file_path)
        public_path = MediaService.build_public_storage_path(file_name=asset.file_name)
        original_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)

        with original_path.open("wb") as destination:
            destination.write(raw)
        with public_path.open("wb") as destination:
            destination.write(raw)

        asset.width = MediaService.THUMBNAIL_WIDTH
        asset.height = MediaService.THUMBNAIL_HEIGHT
        asset.checksum_sha256 = checksum
        asset.exif_json = None
        asset.save(
            update_fields=[
                "width",
                "height",
                "checksum_sha256",
                "exif_json",
                "original_file_path",
                "updated_at",
            ]
        )
        return asset

    @staticmethod
    def _load_thumbnail_font(*, font_path: Path, size: int) -> ImageFont.FreeTypeFont:
        """
        サムネイル生成用フォントを読み込む。
        """
        if not font_path.exists():
            raise RuntimeError(f"サムネイル用フォントが存在しません: {font_path}")
        return ImageFont.truetype(str(font_path), size=size)

    @staticmethod
    def _create_thumbnail_background() -> Image.Image:
        """
        サムネイル背景を生成する。
        """
        image = Image.new(
            "RGBA",
            (MediaService.THUMBNAIL_WIDTH, MediaService.THUMBNAIL_HEIGHT),
        )
        pixels = image.load()

        for y in range(MediaService.THUMBNAIL_HEIGHT):
            vertical_ratio = y / max(1, MediaService.THUMBNAIL_HEIGHT - 1)
            for x in range(MediaService.THUMBNAIL_WIDTH):
                red = int(247 + (234 - 247) * vertical_ratio)
                green = int(250 + (241 - 250) * vertical_ratio)
                blue = int(254 + (250 - 254) * vertical_ratio)
                pixels[x, y] = (red, green, blue, 255)

        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle(
            (50, 34, 1150, 596),
            radius=30,
            fill=(255, 255, 255, 255),
            outline=(211, 221, 237, 255),
            width=3,
        )
        draw.rounded_rectangle(
            (76, 58, 86, 572),
            radius=5,
            fill=(47, 92, 159, 255),
        )
        return image.convert("RGB")

    @staticmethod
    def _measure_text_box(
        *,
        draw: ImageDraw.ImageDraw,
        text: str,
        font: ImageFont.FreeTypeFont,
    ) -> tuple[int, int, int, int]:
        """
        テキスト描画領域を返す。
        """
        return draw.textbbox((0, 0), text, font=font)

    @staticmethod
    def _wrap_thumbnail_text(
        *,
        draw: ImageDraw.ImageDraw,
        text: str,
        font: ImageFont.FreeTypeFont,
        max_width: int,
        max_lines: int,
    ) -> list[str]:
        """
        サムネイル用にテキストを折り返す。
        """
        normalized_text = " ".join(text.replace("\n", " ").split())
        if normalized_text == "":
            return [settings.CMS_THUMBNAIL_BRAND_NAME]

        lines: list[str] = []
        current_line = ""

        for character in normalized_text:
            candidate = f"{current_line}{character}"
            width = MediaService._measure_text_box(
                draw=draw,
                text=candidate,
                font=font,
            )[2]
            if current_line != "" and width > max_width:
                lines.append(current_line)
                current_line = character
            else:
                current_line = candidate

        if current_line != "":
            lines.append(current_line)

        if len(lines) <= max_lines:
            return lines

        clamped_lines = lines[:max_lines]
        while clamped_lines[-1] != "":
            candidate = f"{clamped_lines[-1]}…"
            width = MediaService._measure_text_box(
                draw=draw,
                text=candidate,
                font=font,
            )[2]
            if width <= max_width:
                clamped_lines[-1] = candidate
                return clamped_lines
            clamped_lines[-1] = clamped_lines[-1][:-1]

        clamped_lines[-1] = "…"
        return clamped_lines

    @staticmethod
    def _resolve_media_absolute_path(*, stored_path: str | None) -> Path:
        """
        /media/ 配下の保存パスを絶対パスへ変換する。
        """
        if stored_path is None or not stored_path.startswith(settings.MEDIA_URL):
            raise RuntimeError("執筆者アイコン画像の保存パスが不正です。")

        media_root = Path(settings.MEDIA_ROOT).resolve()
        candidate = (media_root / stored_path.removeprefix(settings.MEDIA_URL)).resolve()
        try:
            candidate.relative_to(media_root)
        except ValueError as exc:
            raise RuntimeError("執筆者アイコン画像の保存パスが media 配下にありません。") from exc
        if not candidate.exists():
            raise RuntimeError(f"執筆者アイコン画像が存在しません: {candidate}")
        return candidate

    @staticmethod
    def _build_author_avatar(
        *,
        stored_path: str | None,
        size: int,
        display_name: str,
    ) -> Image.Image:
        """
        執筆者アイコンを円形アバターへ変換する。
        """
        try:
            source_path = MediaService._resolve_media_absolute_path(stored_path=stored_path)
            with Image.open(source_path) as source_image:
                avatar = ImageOps.fit(
                    source_image.convert("RGBA"),
                    (size, size),
                    centering=(0.5, 0.5),
                )
        except Exception:
            avatar = MediaService._build_placeholder_avatar(
                size=size,
                display_name=display_name,
            )

        mask = Image.new("L", (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.ellipse((0, 0, size - 1, size - 1), fill=255)

        ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ring_draw = ImageDraw.Draw(ring)
        ring_draw.ellipse(
            (1, 1, size - 2, size - 2),
            outline=(255, 255, 255, 255),
            width=4,
        )

        avatar.putalpha(mask)
        avatar.alpha_composite(ring)
        return avatar

    @staticmethod
    def _build_placeholder_avatar(*, size: int, display_name: str) -> Image.Image:
        """
        アイコン未設定時のプレースホルダーアバターを生成する。
        """
        avatar = Image.new("RGBA", (size, size), (223, 235, 252, 255))
        draw = ImageDraw.Draw(avatar)
        draw.ellipse((0, 0, size - 1, size - 1), fill=(223, 235, 252, 255))

        marker = (display_name.strip()[:1] or "週").upper()
        font = MediaService._load_thumbnail_font(
            font_path=settings.CMS_THUMBNAIL_FONT_BOLD_PATH,
            size=max(26, size // 2),
        )
        text_box = MediaService._measure_text_box(
            draw=draw,
            text=marker,
            font=font,
        )
        text_width = text_box[2] - text_box[0]
        text_height = text_box[3] - text_box[1]
        draw.text(
            ((size - text_width) / 2, (size - text_height) / 2 - 4),
            marker,
            fill=(47, 95, 177),
            font=font,
        )
        return avatar

    @staticmethod
    def _draw_brand_logo(
        *,
        image: Image.Image,
        canvas_width: int,
        canvas_height: int,
    ) -> None:
        """
        週末カメラのロゴを描画する。
        """
        brand_logo_path = settings.CMS_THUMBNAIL_BRAND_IMAGE_PATH
        if not brand_logo_path.exists():
            raise RuntimeError(f"ブランドロゴPNGが存在しません: {brand_logo_path}")

        with Image.open(brand_logo_path) as source_logo:
            brand_logo = source_logo.convert("RGBA")

        target_width = 300
        source_width, source_height = brand_logo.size
        target_height = max(1, round(source_height * (target_width / source_width)))
        resized_logo = brand_logo.resize((target_width, target_height), Image.Resampling.LANCZOS)

        margin_right = 92
        margin_bottom = 70
        paste_x = canvas_width - margin_right - target_width
        paste_y = canvas_height - margin_bottom - target_height
        image.paste(resized_logo, (paste_x, paste_y), resized_logo)

    @staticmethod
    def build_final_paths(*, file_name: str) -> tuple[Path, Path]:
        """
        file_name から原本と公開用の保存パスを導出する。
        """
        original_path = MediaService.build_original_storage_path(file_name=file_name)
        public_path = MediaService.build_public_storage_path(file_name=file_name)
        return original_path, public_path

    @staticmethod
    def build_original_storage_key(*, file_name: str) -> str:
        """
        原本ファイルの相対ストレージキーを返す。
        """
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        return f"original/{shard_a}/{shard_b}/{file_name}"

    @staticmethod
    def build_public_storage_key(*, file_name: str) -> str:
        """
        公開ファイルの相対ストレージキーを返す。
        """
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        return f"images/{shard_a}/{shard_b}/{file_name}"

    @staticmethod
    def build_original_storage_path(*, file_name: str) -> Path:
        """
        原本ファイルの絶対パスを返す。
        """
        return MediaService.resolve_storage_path(
            storage_key=MediaService.build_original_storage_key(file_name=file_name),
        )

    @staticmethod
    def build_public_storage_path(*, file_name: str) -> Path:
        """
        公開ファイルの絶対パスを返す。
        """
        return MediaService.resolve_storage_path(
            storage_key=MediaService.build_public_storage_key(file_name=file_name),
        )

    @staticmethod
    def resolve_storage_path(*, storage_key: str) -> Path:
        """
        相対ストレージキーを絶対パスへ変換する。
        """
        return Path(settings.MEDIA_ROOT) / storage_key

    @staticmethod
    def build_public_media_path(*, file_name: str) -> str:
        """
        公開メディアの絶対URLを返す。
        """
        public_path = f"{settings.MEDIA_URL}{MediaService.build_public_storage_key(file_name=file_name)}"
        cdn_url = build_cdn_media_url(public_path)
        if cdn_url is None:
            raise RuntimeError("公開メディアURLを生成できません。")
        return cdn_url

    @staticmethod
    def build_temp_media_path(*, lock_token: str, file_name: str) -> str:
        """
        一時保存メディアの絶対URLを返す。
        """
        temp_path = f"{settings.MEDIA_URL}tmp/{lock_token}/{file_name}"
        cdn_url = build_cdn_media_url(temp_path)
        if cdn_url is None:
            raise RuntimeError("一時保存メディアURLを生成できません。")
        return cdn_url

    @staticmethod
    def normalize_media_source_path(*, source: str) -> str:
        """
        メディアソースURLをパスへ正規化する。
        """
        normalized = source.strip()
        if normalized == "":
            return ""
        parsed = urlparse(normalized)
        if parsed.scheme in {"http", "https"}:
            return parsed.path
        return normalized.split("?")[0].split("#")[0]

    @staticmethod
    def rewrite_media_sources_to_cdn(*, body_html: str) -> str:
        """
        本文内のメディアURLをCDN URLへ置換する。
        """
        soup = BeautifulSoup(body_html, "lxml")
        for image in soup.find_all("img"):
            source = MediaService.normalize_media_source_path(
                source=str(image.get("src", "")).strip(),
            )
            if not source.startswith(f"{settings.MEDIA_URL}"):
                continue
            cdn_url = build_cdn_media_url(source)
            if cdn_url is None:
                continue
            image["src"] = cdn_url
        return MediaService._serialize_html_fragment(soup=soup)

    @staticmethod
    def extract_exif(*, image: Image.Image) -> dict[str, object | None] | None:
        """
        取得可能な範囲でEXIFメタ情報を抽出する。
        """
        try:
            exif = image.getexif()
        except Exception:
            return None

        if not exif:
            return None

        try:
            exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        except Exception:
            exif_ifd = {}

        payload: dict[str, object | None] = {}
        has_real_value = False
        for label, key in EXIF_DISPLAY_FIELDS:
            value = exif.get(key)
            if value is None:
                value = exif_ifd.get(key)
            normalized_value = MediaService.normalize_exif_storage_value(
                label=label,
                value=value,
            )
            if normalized_value is None:
                payload[label] = None
                continue

            has_real_value = True
            payload[label] = normalized_value
        if not has_real_value:
            return None
        return payload or None

    @staticmethod
    def normalize_exif_storage_value(*, label: str, value: object | None) -> object | None:
        """
        EXIF値を保存用に正規化する。
        """
        if value is None:
            return None

        if label in {"ISO", "F", "SS", "WB", "焦点距離"}:
            numeric_value = MediaService.coerce_numeric_value(value=value)
            if numeric_value is not None:
                if numeric_value.is_integer():
                    return int(numeric_value)
                return numeric_value

        normalized_text = MediaService.normalize_exif_text_value(value=value)
        return None if normalized_text == "-" else normalized_text

    @staticmethod
    def format_exif_value(*, label: str, value: object | None) -> str:
        """
        EXIF値を表示用に正規化する。
        """
        if value is None:
            return "-"

        normalized_text = MediaService.normalize_exif_text_value(value=value)
        if normalized_text == "-":
            return "-"

        if label == "SS":
            if re.fullmatch(r"\d+/\d+", normalized_text):
                return normalized_text
            if normalized_text.endswith("秒"):
                return normalized_text
            numeric_value = MediaService.coerce_numeric_value(value=value)
            if numeric_value is None:
                return normalized_text
            if numeric_value <= 0:
                return "-"
            if numeric_value < 1:
                fraction = Fraction(str(numeric_value)).limit_denominator(1_000_000)
                if fraction.numerator == 0:
                    return "-"
                if fraction.denominator == 1:
                    return f"{fraction.numerator}秒"
                return f"{fraction.numerator}/{fraction.denominator}"
            return f"{MediaService.truncate_numeric_value(value=numeric_value)}秒"

        if label == "F":
            if re.fullmatch(r"\d+", normalized_text):
                return normalized_text
            numeric_value = MediaService.coerce_numeric_value(value=value)
            if numeric_value is None:
                return normalized_text
            return str(MediaService.truncate_numeric_value(value=numeric_value))

        if label == "焦点距離":
            if normalized_text.endswith("mm") and re.fullmatch(r"\d+(?:\.\d+)?mm", normalized_text):
                return normalized_text
            numeric_value = MediaService.coerce_numeric_value(value=value)
            if numeric_value is None:
                return normalized_text
            return f"{MediaService.truncate_numeric_value(value=numeric_value)}mm"

        if label == "ISO":
            if re.fullmatch(r"\d+", normalized_text):
                return normalized_text
            numeric_value = MediaService.coerce_numeric_value(value=value)
            if numeric_value is None:
                return normalized_text
            return str(MediaService.truncate_numeric_value(value=numeric_value))

        return normalized_text

    @staticmethod
    def normalize_exif_text_value(*, value: object) -> str:
        """
        EXIF値を文字列として正規化する。
        """
        if value is None:
            return "-"

        if isinstance(value, bytes):
            normalized = value.decode("utf-8", errors="ignore")
        elif isinstance(value, tuple):
            normalized_items = [
                MediaService.normalize_exif_text_value(value=item)
                for item in value
            ]
            normalized = ", ".join(
                item for item in normalized_items if item != "-"
            )
        else:
            normalized = str(value)

        normalized = normalized.replace("\x00", "").strip()
        return normalized if normalized != "" else "-"

    @staticmethod
    def coerce_numeric_value(*, value: object) -> float | None:
        """
        EXIF値を数値へ変換する。
        """
        if value is None:
            return None

        if isinstance(value, (int, float)):
            return float(value)

        normalized_text = MediaService.normalize_exif_text_value(value=value)
        if normalized_text in {"", "-"}:
            return None

        try:
            return float(normalized_text)
        except ValueError:
            return None

    @staticmethod
    def truncate_numeric_value(*, value: float) -> int:
        """
        数値を小数点以下切り捨てで整数化する。
        """
        return int(value)

    @staticmethod
    def _resize_image(*, working_image: Image.Image) -> Image.Image:
        """
        長辺上限に合わせて画像を縮小する。
        """
        width, height = working_image.size
        long_edge = max(width, height)
        if long_edge <= settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE:
            return working_image

        working_image.thumbnail(
            (settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE, settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE),
            Image.Resampling.LANCZOS,
        )
        return working_image

    @staticmethod
    def _convert_image_to_srgb(*, working_image: Image.Image, stored_file_name: str) -> Image.Image:
        """
        ICCプロファイル付き画像をsRGBへ変換する。
        """
        icc_profile = working_image.info.get("icc_profile")
        if not icc_profile:
            logger.log(
                logging.INFO,
                "ICCプロファイルがないためsRGBとして扱います: file_name=%s mode=%s",
                stored_file_name,
                working_image.mode,
            )
            return working_image

        logger.log(
            logging.INFO,
            "ICCプロファイル付き画像をsRGBへ変換します: file_name=%s mode=%s",
            stored_file_name,
            working_image.mode,
        )
        try:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
            target_profile = ImageCms.createProfile("sRGB")
            if working_image.mode == "RGBA":
                rgb_image = working_image.convert("RGB")
                alpha = working_image.getchannel("A")
                converted = ImageCms.profileToProfile(
                    rgb_image,
                    source_profile,
                    target_profile,
                    outputMode="RGB",
                )
                converted.putalpha(alpha)
                return converted
            return ImageCms.profileToProfile(
                working_image,
                source_profile,
                target_profile,
                outputMode="RGB",
            )
        except Exception as exc:
            raise RuntimeError(f"sRGB変換に失敗しました: {stored_file_name}") from exc

    @staticmethod
    def _apply_exif_watermark(
        *,
        working_image: Image.Image,
        exif_json: dict | None,
        stored_file_name: str,
    ) -> Image.Image:
        """
        EXIF透かしを左下へ描画する。
        """
        if not exif_json:
            logger.log(
                logging.WARNING,
                "EXIF透かしをスキップします: file_name=%s reason=EXIF情報が空です",
                stored_file_name,
            )
            return working_image

        lines = MediaService.build_visible_exif_lines(exif_json=exif_json)
        if not lines:
            logger.log(
                logging.WARNING,
                "EXIF透かしをスキップします: file_name=%s reason=表示可能なEXIF項目がありません",
                stored_file_name,
            )
            return working_image

        if working_image.mode != "RGBA":
            working_image = working_image.convert("RGBA")

        font_size = max(16, round(max(working_image.size) * 0.018))
        logger.log(
            logging.INFO,
            "EXIF透かしを描画します: file_name=%s lines=%s font_size=%s",
            stored_file_name,
            len(lines),
            font_size,
        )
        font = MediaService._load_thumbnail_font(
            font_path=settings.CMS_THUMBNAIL_FONT_REGULAR_PATH,
            size=font_size,
        )
        padding_x = max(12, round(max(working_image.size) * 0.012))
        padding_y = max(10, round(max(working_image.size) * 0.01))
        margin = max(16, round(max(working_image.size) * 0.016))
        line_gap = max(4, round(font_size * 0.3))

        draw = ImageDraw.Draw(working_image, "RGBA")
        text_boxes = [
            MediaService._measure_text_box(draw=draw, text=line, font=font)
            for line in lines
        ]
        text_width = max((box[2] - box[0]) for box in text_boxes)
        text_heights = [box[3] - box[1] for box in text_boxes]
        box_width = text_width + (padding_x * 2)
        box_height = sum(text_heights) + (padding_y * 2) + (line_gap * (len(lines) - 1))
        x0 = margin
        y0 = working_image.height - margin - box_height
        x1 = x0 + box_width
        y1 = y0 + box_height

        draw.rounded_rectangle(
            (x0, y0, x1, y1),
            radius=max(8, round(font_size * 0.55)),
            fill=(0, 0, 0, 148),
        )

        current_y = y0 + padding_y
        for line, text_box, text_height in zip(lines, text_boxes, text_heights):
            draw.text(
                (x0 + padding_x, current_y - text_box[1]),
                line,
                fill=(255, 255, 255, 255),
                font=font,
            )
            current_y += text_height + line_gap

        return working_image

    @staticmethod
    def build_visible_exif_lines(*, exif_json: dict | None) -> list[str]:
        """
        透かしに表示可能なEXIF行を返す。
        """
        if not exif_json:
            return []

        lines: list[str] = []
        for label, _ in EXIF_DISPLAY_FIELDS:
            value = MediaService.format_exif_value(
                label=label,
                value=exif_json.get(label),
            )
            if value != "":
                lines.append(f"{label}: {value}")
        return lines

    @staticmethod
    def _apply_site_logo_watermark(*, working_image: Image.Image) -> Image.Image:
        """
        サイト名テキスト透かしを右下へ描画する。
        """
        if working_image.mode != "RGBA":
            working_image = working_image.convert("RGBA")

        long_edge = max(working_image.size)
        target_width = max(
            1,
            round(long_edge * SITE_WATERMARK_WIDTH_RATIO),
        )
        font = MediaService._load_site_watermark_font(
            target_width=target_width,
            text=SITE_WATERMARK_TEXT,
            long_edge=long_edge,
        )
        draw = ImageDraw.Draw(working_image, "RGBA")
        text_box = draw.textbbox(
            (0, 0),
            SITE_WATERMARK_TEXT,
            font=font,
        )
        margin = max(18, round(long_edge * 0.018))
        text_x = working_image.width - margin - text_box[2]
        text_y = working_image.height - margin - text_box[3]
        contrast_box = (
            max(0, text_x + text_box[0]),
            max(0, text_y + text_box[1]),
            min(working_image.width, text_x + text_box[2]),
            min(working_image.height, text_y + text_box[3]),
        )
        fill = MediaService._site_watermark_color(
            working_image=working_image,
            contrast_box=contrast_box,
        )
        draw.text(
            (text_x, text_y),
            SITE_WATERMARK_TEXT,
            font=font,
            fill=fill,
        )
        return working_image

    @staticmethod
    @lru_cache(maxsize=64)
    def _load_site_watermark_font(
        *,
        target_width: int,
        text: str,
        long_edge: int,
    ) -> ImageFont.FreeTypeFont:
        """
        透かし文字列が目標幅に収まるCaveatフォントを読み込む。
        """
        size = max(18, round(long_edge * 0.055))
        dummy_image = Image.new("RGBA", (1, 1))
        draw = ImageDraw.Draw(dummy_image)
        while size >= 12:
            font = MediaService._load_site_watermark_font_by_size(size=size)
            text_box = draw.textbbox(
                (0, 0),
                text,
                font=font,
            )
            if text_box[2] - text_box[0] <= target_width:
                return font
            size -= 2

        return MediaService._load_site_watermark_font_by_size(size=12)

    @staticmethod
    @lru_cache(maxsize=64)
    def _load_site_watermark_font_by_size(*, size: int) -> ImageFont.FreeTypeFont:
        """
        Caveatフォントをサイズ単位で読み込んで再利用する。
        """
        return ImageFont.truetype(str(SITE_WATERMARK_FONT_PATH), size=size)

    @staticmethod
    def _site_watermark_color(
        *,
        working_image: Image.Image,
        contrast_box: tuple[int, int, int, int],
    ) -> tuple[int, int, int, int]:
        """
        背景の明るさに応じた透かし文字色を返す。
        """
        alpha = round(255 * SITE_WATERMARK_OPACITY)
        crop = working_image.crop(contrast_box).convert("L")
        histogram = crop.histogram()
        pixel_count = max(1, sum(histogram))
        luminance = sum(value * count for value, count in enumerate(histogram)) / pixel_count

        if luminance >= 132:
            return (0, 0, 0, alpha)
        return (255, 255, 255, alpha)

    @staticmethod
    def _serialize_public_image(
        *,
        working_image: Image.Image,
        extension: str,
    ) -> tuple[bytes, int, int]:
        """
        公開用画像を拡張子に応じた形式でシリアライズする。
        """
        width, height = working_image.size

        if extension in {"jpg", "jpeg"}:
            jpeg_image = MediaService._build_metadata_free_jpeg_image(
                working_image=working_image,
            )
            public_raw = MediaService._encode_public_jpeg_image(
                jpeg_image=jpeg_image,
                quality=settings.CMS_ARTICLE_IMAGE_QUALITY_HIGH,
                optimize=True,
                progressive=True,
            )
            if len(public_raw) <= settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES:
                return public_raw, width, height

            public_raw = MediaService._encode_public_jpeg_image_at_target_size(
                jpeg_image=jpeg_image,
            )
            return public_raw, width, height

        if extension == "png":
            public_raw = MediaService._encode_public_png_image(
                working_image=working_image,
            )
            if len(public_raw) > settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES:
                logger.log(
                    logging.WARNING,
                    "PNG画像は品質調整できないためそのまま保存します: bytes=%s limit=%s",
                    len(public_raw),
                    settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES,
                )
            return public_raw, width, height

        raise RuntimeError(f"対応していない公開画像形式です: {extension}")

    @staticmethod
    def _encode_public_jpeg_image(
        *,
        jpeg_image: Image.Image,
        quality: int,
        optimize: bool,
        progressive: bool,
    ) -> bytes:
        """
        公開用JPEG画像を指定品質でエンコードする。
        """
        buffer = io.BytesIO()
        jpeg_image.save(
            buffer,
            format="JPEG",
            quality=quality,
            optimize=optimize,
            progressive=progressive,
        )
        return buffer.getvalue()

    @staticmethod
    def _encode_public_png_image(*, working_image: Image.Image) -> bytes:
        """
        公開用PNG画像をエンコードする。
        """
        buffer = io.BytesIO()
        MediaService._build_metadata_free_png_image(
            working_image=working_image,
        ).save(
            buffer,
            format="PNG",
            optimize=True,
            compress_level=9,
        )
        return buffer.getvalue()

    @staticmethod
    def _build_metadata_free_jpeg_image(*, working_image: Image.Image) -> Image.Image:
        """
        公開用JPEGのためにメタデータを持たない画像へ変換する。
        """
        if working_image.mode == "RGB":
            return working_image
        return working_image.convert("RGB")

    @staticmethod
    def _build_metadata_free_png_image(*, working_image: Image.Image) -> Image.Image:
        """
        公開用PNGのためにメタデータを持たない画像へ変換する。
        """
        if working_image.mode == "RGBA":
            return working_image
        return working_image.convert("RGBA")

    @staticmethod
    def _encode_public_jpeg_image_at_target_size(
        *,
        jpeg_image: Image.Image,
    ) -> bytes:
        """
        上限サイズ以下を満たす最大品質のJPEG bytesを二分探索で返す。
        """
        low = settings.CMS_ARTICLE_IMAGE_QUALITY_LOW
        high = settings.CMS_ARTICLE_IMAGE_QUALITY_HIGH - 1
        target_size = settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES
        best_quality: int | None = None

        while low <= high:
            quality = (low + high) // 2
            candidate_raw = MediaService._encode_public_jpeg_image(
                jpeg_image=jpeg_image,
                quality=quality,
                optimize=False,
                progressive=False,
            )
            if len(candidate_raw) <= target_size:
                best_quality = quality
                low = quality + 1
            else:
                high = quality - 1

        if best_quality is not None:
            return MediaService._encode_public_jpeg_image(
                jpeg_image=jpeg_image,
                quality=best_quality,
                optimize=True,
                progressive=True,
            )

        return MediaService._encode_public_jpeg_image(
            jpeg_image=jpeg_image,
            quality=settings.CMS_ARTICLE_IMAGE_QUALITY_LOW,
            optimize=True,
            progressive=True,
        )

    @staticmethod
    def _serialize_html_fragment(*, soup: BeautifulSoup) -> str:
        """
        BeautifulSoup から本文HTML断片を返す。
        """
        if soup.body is not None:
            return soup.body.decode_contents()
        return str(soup)

    @staticmethod
    def build_toc(*, body_html: str) -> list[dict]:
        """
        本文HTMLから h1-h3 のTOCを生成する。
        """
        soup = BeautifulSoup(body_html, "lxml")
        headings: list[dict] = []
        seen_ids: dict[str, int] = {}
        current_h1 = ""
        current_h2 = ""

        for heading in soup.find_all(["h1", "h2", "h3"]):
            level = int(heading.name[1])
            text = heading.get_text(" ", strip=True)
            if text == "":
                continue
            normalized = slugify(text, allow_unicode=True).strip("-") or "heading"
            if level == 1:
                current_h1 = normalized
                current_h2 = ""
                breadcrumb = current_h1
            elif level == 2:
                current_h2 = normalized
                breadcrumb = ">".join([value for value in [current_h1, current_h2] if value])
            else:
                breadcrumb = ">".join(
                    [value for value in [current_h1, current_h2, normalized] if value]
                )

            base_id = f"h-{hashlib.sha1(breadcrumb.encode('utf-8')).hexdigest()[:12]}"
            sequence = seen_ids.get(base_id, 0) + 1
            seen_ids[base_id] = sequence
            if sequence > 1:
                base_id = f"{base_id}-{sequence}"

            headings.append({"level": level, "id": base_id, "text": text})

        toc: list[dict] = []
        h1_stack: dict | None = None
        h2_stack: dict | None = None
        for item in headings:
            node = {
                "level": item["level"],
                "id": item["id"],
                "text": item["text"],
                "children": [],
            }
            if item["level"] == 1:
                toc.append(node)
                h1_stack = node
                h2_stack = None
            elif item["level"] == 2:
                if h1_stack is None:
                    toc.append(node)
                else:
                    h1_stack["children"].append(node)
                h2_stack = node
            else:
                if h2_stack is not None:
                    h2_stack["children"].append(node)
                elif h1_stack is not None:
                    h1_stack["children"].append(node)
                else:
                    toc.append(node)
        return toc

    @staticmethod
    def _thumbnail_source_candidates(thumbnail_request: dict) -> set[str]:
        """
        サムネイル参照元候補ファイル名集合を返す。
        """
        file_name = thumbnail_request.get("file_name")
        if file_name:
            return {file_name}
        return set()
