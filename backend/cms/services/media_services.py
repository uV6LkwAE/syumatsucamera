"""
メディア操作サービスを定義する。
"""
import hashlib
import io
import shutil
import uuid
from pathlib import Path

from bs4 import BeautifulSoup
from django.conf import settings
from django.utils.text import slugify
from PIL import Image, ImageDraw
from rest_framework.exceptions import ValidationError

from cms.models import (
    Article,
    MediaAsset,
)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}


class MediaService:
    """
    記事画像の保存と処理を扱う。
    """

    @staticmethod
    def validate_uploaded_image(*, uploaded_file) -> None:
        """
        アップロード画像の形式とサイズを検証する。
        """
        if uploaded_file.size > settings.CMS_ARTICLE_IMAGE_UPLOAD_MAX_BYTES:
            raise ValidationError(
                {"file": ["画像サイズは50MB以下である必要があります。"]}
            )

        try:
            image = Image.open(uploaded_file)
            image.verify()
        except Exception as exc:
            raise ValidationError({"file": ["画像ファイルの形式が不正です。"]}) from exc
        finally:
            uploaded_file.seek(0)

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
            raise ValidationError({"file_name": ["対応していない画像拡張子です。"]})

    @staticmethod
    def save_temp_upload(*, lock_token: str, uploaded_file) -> dict:
        """
        一時保存領域へ画像を保存する。
        """
        file_name = uploaded_file.name
        MediaService.validate_temp_file_name(file_name=file_name)
        MediaService.validate_uploaded_image(uploaded_file=uploaded_file)

        target_dir = MediaService.build_temp_dir(lock_token=lock_token)
        target_path = target_dir / file_name
        with target_path.open("wb") as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)

        return {
            "file_name": file_name,
            "path": f"{settings.MEDIA_URL}tmp/{lock_token}/{file_name}",
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
            source = str(image.get("src", "")).strip()
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
            new_image_names.add(file_name)

        if not html_tmp_file_names.issubset(
            new_image_names | MediaService._thumbnail_source_candidates(thumbnail_request)
        ):
            raise ValidationError({"image_diff": ["本文内のtmp画像と差分JSONが一致しません。"]})

        for new_image in new_images:
            options = new_image["options"]
            if options["custom_text_overlay"] and not options.get("custom_text", "").strip():
                raise ValidationError(
                    {"image_diff": ["カスタムテキスト挿入時は custom_text が必須です。"]}
                )

        thumbnail_file_name = thumbnail_request.get("file_name")
        if thumbnail_file_name:
            MediaService.validate_temp_file_name(file_name=thumbnail_file_name)
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
        original_path, public_path = MediaService.build_final_paths(file_name=asset.file_name)
        for absolute_path in [original_path, public_path]:
            if absolute_path.exists():
                absolute_path.unlink()

    @staticmethod
    def cleanup_temp_dir(*, lock_token: str) -> None:
        """
        セッション tmp ディレクトリを削除する。
        """
        path = Path(settings.MEDIA_ROOT) / "tmp" / str(lock_token)
        if path.exists():
            shutil.rmtree(path)

    @staticmethod
    def create_or_replace_thumbnail_asset(*, article: Article, thumbnail_request: dict) -> MediaAsset:
        """
        サムネイル用アセットのプレースホルダを作成する。
        """
        suffix = ".png"
        requested_file_name = thumbnail_request.get("file_name")
        if requested_file_name and "." in requested_file_name:
            suffix = "." + requested_file_name.rsplit(".", 1)[1].lower()

        asset = MediaAsset.objects.create(
            article=article,
            file_name=f"{uuid.uuid4()}{suffix}",
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
    ) -> MediaAsset:
        """
        tmp 画像を最終保存先へ移しアセットを返す。
        """
        source_path = MediaService.temp_file_path(lock_token=lock_token, file_name=source_file_name)
        if not source_path.exists():
            raise ValidationError(f"一時画像が存在しません。: {source_file_name}")

        with source_path.open("rb") as file_obj:
            raw = file_obj.read()

        image = Image.open(io.BytesIO(raw))
        width, height = image.size
        checksum = hashlib.sha256(raw).hexdigest()
        exif_json = MediaService.extract_exif(image=image)

        original_path, public_path = MediaService.build_final_paths(file_name=stored_file_name)
        original_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)

        with original_path.open("wb") as destination:
            destination.write(raw)
        with public_path.open("wb") as destination:
            destination.write(raw)

        if asset is None:
            asset = MediaAsset.objects.create(
                article=article,
                file_name=stored_file_name,
            )

        asset.width = width
        asset.height = height
        asset.checksum_sha256 = checksum
        asset.exif_json = exif_json
        asset.processing_options_json = processing_options
        asset.save(
            update_fields=[
                "width",
                "height",
                "checksum_sha256",
                "exif_json",
                "processing_options_json",
                "updated_at",
            ]
        )
        return asset

    @staticmethod
    def generate_thumbnail_image(*, asset: MediaAsset, title_text: str) -> MediaAsset:
        """
        文字列ベースのサムネイル画像を生成する。
        """
        image = Image.new("RGB", (1200, 630), color=(245, 240, 232))
        draw = ImageDraw.Draw(image)
        draw.text((48, 280), title_text[:60], fill=(35, 35, 35))

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        raw = buffer.getvalue()
        checksum = hashlib.sha256(raw).hexdigest()

        original_path, public_path = MediaService.build_final_paths(file_name=asset.file_name)
        original_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)

        with original_path.open("wb") as destination:
            destination.write(raw)
        with public_path.open("wb") as destination:
            destination.write(raw)

        asset.width = 1200
        asset.height = 630
        asset.checksum_sha256 = checksum
        asset.exif_json = None
        asset.save(
            update_fields=[
                "width",
                "height",
                "checksum_sha256",
                "exif_json",
                "updated_at",
            ]
        )
        return asset

    @staticmethod
    def build_final_paths(*, file_name: str) -> tuple[Path, Path]:
        """
        file_name から原本と公開用の保存パスを導出する。
        """
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        original_path = Path(settings.MEDIA_ROOT) / "original" / shard_a / shard_b / file_name
        public_path = Path(settings.MEDIA_ROOT) / "images" / shard_a / shard_b / file_name
        return original_path, public_path

    @staticmethod
    def extract_exif(*, image: Image.Image) -> dict | None:
        """
        取得可能な範囲でEXIFメタ情報を抽出する。
        """
        try:
            exif = image.getexif()
        except Exception:
            return None

        if not exif:
            return None

        payload: dict[str, str] = {}
        mapped_keys = {
            34855: "ISO",
            33437: "F",
            33434: "SS",
            37384: "WB",
            272: "機種名",
            42036: "レンズ",
            37386: "焦点距離",
        }
        for key, label in mapped_keys.items():
            value = exif.get(key)
            if value is not None:
                payload[label] = str(value)
        return payload or None

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
