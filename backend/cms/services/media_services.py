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
from PIL import Image, ImageDraw, ImageFont, ImageOps
from rest_framework.exceptions import ValidationError

from cms.models import (
    Article,
    MediaAsset,
)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "gif"}
IMAGE_FORMATS_BY_EXTENSION = {
    "jpg": {"JPEG", "MPO"},
    "jpeg": {"JPEG", "MPO"},
    "gif": {"GIF"},
}


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
            "resize": True,
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
                {"file": ["画像サイズは50MB以下である必要があります。"]}
            )

        extension = file_name.rsplit(".", 1)[1].lower()
        allowed_formats = IMAGE_FORMATS_BY_EXTENSION.get(extension)
        if allowed_formats is None:
            raise ValidationError(
                {"file": ["対応していない画像形式です。jpg/jpeg/gif を使用してください。"]}
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
                {"file": ["対応していない画像形式です。jpg/jpeg/gif を使用してください。"]}
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
                {"file_name": ["対応していない画像拡張子です。jpg/jpeg/gif を使用してください。"]}
            )

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
    def create_or_replace_thumbnail_asset(*, article: Article, thumbnail_request: dict) -> MediaAsset | None:
        """
        サムネイル用アセットのプレースホルダを作成する。
        """
        if thumbnail_request["mode"] == "use_default":
            return None
        if thumbnail_request["mode"] == "keep_current":
            return article.thumbnail_asset

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
        exif_json = MediaService.extract_exif(image=image)
        public_raw, width, height = MediaService.build_public_image_bytes(
            image=image,
            raw=raw,
            stored_file_name=stored_file_name,
            processing_options=processing_options,
            exif_json=exif_json,
        )
        checksum = hashlib.sha256(public_raw).hexdigest()

        original_path, public_path = MediaService.build_final_paths(file_name=stored_file_name)
        original_path.parent.mkdir(parents=True, exist_ok=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)

        with original_path.open("wb") as destination:
            destination.write(raw)
        with public_path.open("wb") as destination:
            destination.write(public_raw)

        if asset is None:
            asset = MediaAsset.objects.create(
                article=article,
                file_name=stored_file_name,
            )

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
                "updated_at",
            ]
        )
        return asset

    @staticmethod
    def build_public_image_bytes(
        *,
        image: Image.Image,
        raw: bytes,
        stored_file_name: str,
        processing_options: dict,
        exif_json: dict | None,
    ) -> tuple[bytes, int, int]:
        """
        公開用画像 bytes とサイズを返す。
        """
        extension = stored_file_name.rsplit(".", 1)[1].lower()
        if extension == "gif":
            width, height = image.size
            return raw, width, height

        normalized_options = MediaService.normalize_processing_options(
            processing_options=processing_options
        )
        working_image = ImageOps.exif_transpose(image).convert("RGBA")

        if (
            normalized_options["resize"]
            and len(raw) > settings.CMS_ARTICLE_IMAGE_RESIZE_SKIP_MAX_BYTES
        ):
            working_image = MediaService._resize_image(working_image=working_image)

        if normalized_options["exif_watermark"]:
            working_image = MediaService._apply_exif_watermark(
                working_image=working_image,
                exif_json=exif_json,
            )

        if normalized_options["site_logo_watermark"]:
            working_image = MediaService._apply_site_logo_watermark(
                working_image=working_image
            )

        return MediaService._serialize_public_image(
            working_image=working_image,
            extension=extension,
        )

    @staticmethod
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
            source = str(image.get("src", "")).strip()
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

        original_path, public_path = MediaService.build_final_paths(file_name=asset.file_name)
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
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        original_path = Path(settings.MEDIA_ROOT) / "original" / shard_a / shard_b / file_name
        public_path = Path(settings.MEDIA_ROOT) / "images" / shard_a / shard_b / file_name
        return original_path, public_path

    @staticmethod
    def build_public_media_path(*, file_name: str) -> str:
        """
        公開メディアの相対パスを返す。
        """
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        return f"{settings.MEDIA_URL}images/{shard_a}/{shard_b}/{file_name}"

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
    def _resize_image(*, working_image: Image.Image) -> Image.Image:
        """
        長辺上限に合わせて画像を縮小する。
        """
        width, height = working_image.size
        long_edge = max(width, height)
        if long_edge <= settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE:
            return working_image

        resize_ratio = settings.CMS_ARTICLE_IMAGE_MAX_LONG_EDGE / long_edge
        resized_width = max(1, round(width * resize_ratio))
        resized_height = max(1, round(height * resize_ratio))
        return working_image.resize(
            (resized_width, resized_height),
            Image.Resampling.LANCZOS,
        )

    @staticmethod
    def _apply_exif_watermark(
        *,
        working_image: Image.Image,
        exif_json: dict | None,
    ) -> Image.Image:
        """
        EXIF透かしを左下へ描画する。
        """
        if not exif_json:
            return working_image

        lines = [
            f"{label}: {value}"
            for label, value in exif_json.items()
            if str(value).strip() != ""
        ]
        if not lines:
            return working_image

        font_size = max(16, round(max(working_image.size) * 0.018))
        font = MediaService._load_thumbnail_font(
            font_path=settings.CMS_THUMBNAIL_FONT_REGULAR_PATH,
            size=font_size,
        )
        padding_x = max(12, round(max(working_image.size) * 0.012))
        padding_y = max(10, round(max(working_image.size) * 0.01))
        margin = max(16, round(max(working_image.size) * 0.016))
        line_gap = max(4, round(font_size * 0.3))

        overlay = Image.new("RGBA", working_image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
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

        return Image.alpha_composite(working_image, overlay)

    @staticmethod
    def _apply_site_logo_watermark(*, working_image: Image.Image) -> Image.Image:
        """
        サイトロゴ透かしを右下へ描画する。
        """
        brand_logo_path = settings.CMS_THUMBNAIL_BRAND_IMAGE_PATH
        if not brand_logo_path.exists():
            raise RuntimeError(f"ブランドロゴPNGが存在しません: {brand_logo_path}")

        with Image.open(brand_logo_path) as source_logo:
            brand_logo = source_logo.convert("RGBA")

        long_edge = max(working_image.size)
        target_width = max(
            1,
            round(long_edge * settings.CMS_ARTICLE_SITE_LOGO_WATERMARK_WIDTH_RATIO),
        )
        source_width, source_height = brand_logo.size
        target_height = max(1, round(source_height * (target_width / source_width)))
        resized_logo = brand_logo.resize(
            (target_width, target_height),
            Image.Resampling.LANCZOS,
        )

        alpha_channel = resized_logo.getchannel("A")
        alpha_channel = alpha_channel.point(
            lambda alpha: int(alpha * settings.CMS_ARTICLE_SITE_LOGO_WATERMARK_OPACITY)
        )
        resized_logo.putalpha(alpha_channel)

        margin = max(18, round(long_edge * 0.018))
        paste_x = working_image.width - target_width - margin
        paste_y = working_image.height - target_height - margin
        overlay = Image.new("RGBA", working_image.size, (0, 0, 0, 0))
        overlay.paste(resized_logo, (paste_x, paste_y), resized_logo)
        return Image.alpha_composite(working_image, overlay)

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

        if extension not in {"jpg", "jpeg"}:
            raise RuntimeError(f"対応していない公開画像形式です: {extension}")

        public_raw = MediaService._encode_public_image(
            working_image=working_image,
            extension=extension,
            quality=settings.CMS_ARTICLE_IMAGE_QUALITY_HIGH,
        )
        if len(public_raw) <= settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES:
            return public_raw, width, height

        public_raw = MediaService._encode_public_image_at_target_size(
            working_image=working_image,
            extension=extension,
        )
        return public_raw, width, height

    @staticmethod
    def _encode_public_image(
        *,
        working_image: Image.Image,
        extension: str,
        quality: int | None,
    ) -> bytes:
        """
        公開用画像を指定品質でエンコードする。
        """
        buffer = io.BytesIO()

        if extension in {"jpg", "jpeg"}:
            if quality is None:
                raise RuntimeError("JPEG品質が指定されていません。")
            working_image.convert("RGB").save(
                buffer,
                format="JPEG",
                quality=quality,
                optimize=True,
                progressive=True,
            )
        else:
            raise RuntimeError(f"対応していない公開画像形式です: {extension}")

        return buffer.getvalue()

    @staticmethod
    def _encode_public_image_at_target_size(
        *,
        working_image: Image.Image,
        extension: str,
    ) -> bytes:
        """
        上限サイズ以下を満たす最大品質の画像bytesを二分探索で返す。
        """
        low = settings.CMS_ARTICLE_IMAGE_QUALITY_LOW
        high = settings.CMS_ARTICLE_IMAGE_QUALITY_HIGH - 1
        target_size = settings.CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES
        best_raw: bytes | None = None

        while low <= high:
            quality = (low + high) // 2
            candidate_raw = MediaService._encode_public_image(
                working_image=working_image,
                extension=extension,
                quality=quality,
            )
            if len(candidate_raw) <= target_size:
                best_raw = candidate_raw
                low = quality + 1
            else:
                high = quality - 1

        if best_raw is not None:
            return best_raw

        return MediaService._encode_public_image(
            working_image=working_image,
            extension=extension,
            quality=settings.CMS_ARTICLE_IMAGE_QUALITY_LOW,
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
