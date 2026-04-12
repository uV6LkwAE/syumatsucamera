import logging
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent.parent
CI_SKIP_REQUIRED_ENV_CHECK = os.getenv("CI_SKIP_REQUIRED_ENV_CHECK") == "True"


class ExactLevelFilter(logging.Filter):
    def __init__(self, level: int):
        super().__init__()
        self.level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno == self.level


def _log_missing_env_to_bootstrap_file(missing: list[str]) -> None:
    """Write missing env details before Django logging is fully configured."""
    bootstrap_log = BASE_DIR / "logger.log"
    bootstrap_logger = logging.getLogger("bootstrap_env_check")
    bootstrap_logger.setLevel(logging.ERROR)

    if not bootstrap_logger.handlers:
        handler = logging.FileHandler(bootstrap_log, encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        handler.setFormatter(formatter)
        bootstrap_logger.addHandler(handler)

    for key in missing:
        bootstrap_logger.log(logging.ERROR, "Missing required environment variable: %s", key)


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        raise KeyError(name)
    return value


def _env_or_empty(name: str) -> str:
    value = os.getenv(name)
    return "" if value is None else value


def _resolve_log_file_path(filename_env_key: str, log_dir: Path) -> str:
    raw = os.getenv(filename_env_key)
    if raw is None or raw.strip() == "":
        if CI_SKIP_REQUIRED_ENV_CHECK:
            default_map = {
                "LOG_FILE_INFO": "info.log",
                "LOG_FILE_CRITICAL": "critical.log",
            }
            raw = default_map.get(filename_env_key, "app.log")
        else:
            raise KeyError(filename_env_key)
    candidate = Path(raw)
    if candidate.is_absolute():
        return str(candidate)
    return str(log_dir / candidate)


_REQUIRED_ENV_VARS = [
    "SECRET_KEY",
    "DEBUG",
    "ALLOWED_HOSTS",
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "REDIS_URL",
    "REDIS_CONNECT_TIMEOUT",
    "REDIS_SOCKET_TIMEOUT",
    "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
    "CLOUDFLARE_ACCESS_AUD",
    "CLOUDFLARE_ACCESS_SUB_HASH_SECRET",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_HOST_USER",
    "EMAIL_HOST_PASSWORD",
    "LOG_DIR",
    "LOG_RETENTION_DAYS",
    "APP_LOG_LEVEL",
    "LOG_FILE_INFO",
    "LOG_FILE_CRITICAL",
    "CDN_BASE_URL",
    "DEFAULT_OG_IMAGE_PATH",
    "CMS_ARTICLE_IMAGE_QUALITY_LOW",
    "CMS_ARTICLE_IMAGE_QUALITY_HIGH",
]

if not CI_SKIP_REQUIRED_ENV_CHECK:
    _missing = [k for k in _REQUIRED_ENV_VARS if not os.getenv(k)]
    if _missing:
        _log_missing_env_to_bootstrap_file(_missing)
        raise RuntimeError(
            "Missing required environment variables: " + ", ".join(sorted(_missing))
        )

_env = _env_or_empty if CI_SKIP_REQUIRED_ENV_CHECK else required_env


def _env_int(name: str, ci_default: int) -> int:
    raw = _env(name)
    if raw == "":
        raw = str(ci_default)
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable must be an integer: {name}") from exc


SECRET_KEY = _env("SECRET_KEY")
DEBUG = _env("DEBUG").strip().lower() in {"1", "true", "yes", "on"}
ALLOWED_HOSTS = [v.strip() for v in _env("ALLOWED_HOSTS").split(",") if v.strip()]
CSRF_TRUSTED_ORIGINS = [
    v.strip()
    for v in _env("DJANGO_CSRF_TRUSTED_ORIGINS").split(",")
    if v.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sitemaps",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.postgres",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "mptt",
    "cms",
    "public",
    "ogp",
    "users",
    "contacts",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.cloudflare_access.CloudflareAccessMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "syumatsucamera.urls"
WSGI_APPLICATION = "syumatsucamera.wsgi.application"
ASGI_APPLICATION = "syumatsucamera.asgi.application"
AUTH_USER_MODEL = "users.User"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _env("POSTGRES_DB"),
        "USER": _env("POSTGRES_USER"),
        "PASSWORD": _env("POSTGRES_PASSWORD"),
        "HOST": _env("POSTGRES_HOST"),
        "PORT": _env("POSTGRES_PORT"),
    }
}

REDIS_URL = _env("REDIS_URL")
REDIS_CONNECT_TIMEOUT = _env("REDIS_CONNECT_TIMEOUT")
REDIS_SOCKET_TIMEOUT = _env("REDIS_SOCKET_TIMEOUT")
CLOUDFLARE_ACCESS_TEAM_DOMAIN = _env("CLOUDFLARE_ACCESS_TEAM_DOMAIN").strip()
CLOUDFLARE_ACCESS_AUD = _env("CLOUDFLARE_ACCESS_AUD").strip()
CLOUDFLARE_ACCESS_SUB_HASH_SECRET = _env("CLOUDFLARE_ACCESS_SUB_HASH_SECRET").strip()
CLOUDFLARE_ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion"
CLOUDFLARE_ACCESS_ISSUER = f"https://{CLOUDFLARE_ACCESS_TEAM_DOMAIN}"
CLOUDFLARE_ACCESS_CERTS_URL = f"{CLOUDFLARE_ACCESS_ISSUER}/cdn-cgi/access/certs"
CLOUDFLARE_ACCESS_PROTECTED_PATH_PREFIXES = (
    "/api/cms/",
    "/api/users/",
    "/api/ogp",
)
TURNSTILE_SITE_KEY = _env("TURNSTILE_SITE_KEY")
TURNSTILE_SECRET_KEY = _env("TURNSTILE_SECRET_KEY")

EMAIL_HOST = _env("EMAIL_HOST")
EMAIL_PORT = int(_env("EMAIL_PORT") or "25")
EMAIL_USE_TLS = True
EMAIL_HOST_USER = _env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = _env("EMAIL_HOST_PASSWORD")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ja"
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
CDN_BASE_URL = _env("CDN_BASE_URL").strip()
DEFAULT_OG_IMAGE_PATH = _env("DEFAULT_OG_IMAGE_PATH").strip()
CMS_THUMBNAIL_FONT_REGULAR_PATH = BASE_DIR / "cms" / "assets" / "fonts" / "NotoSansJP-Regular.otf"
CMS_THUMBNAIL_FONT_BOLD_PATH = BASE_DIR / "cms" / "assets" / "fonts" / "NotoSansJP-Bold.otf"
CMS_THUMBNAIL_BRAND_NAME = "週末カメラ"
CMS_THUMBNAIL_BRAND_IMAGE_PATH = BASE_DIR / "cms" / "assets" / "brand" / "syumatsucamera-logo.png"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CORS_ALLOW_ALL_ORIGINS = True
CMS_ARTICLE_SESSION_TTL_SECONDS = 300
CMS_ARTICLE_PENDING_SNAPSHOT_TTL_SECONDS = 24 * 60 * 60
CMS_ARTICLE_IMAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
CMS_ARTICLE_IMAGE_RESIZE_SKIP_MAX_BYTES = 500_000
CMS_ARTICLE_IMAGE_PUBLIC_MAX_BYTES = CMS_ARTICLE_IMAGE_RESIZE_SKIP_MAX_BYTES
CMS_ARTICLE_IMAGE_MAX_LONG_EDGE = 2048
CMS_ARTICLE_IMAGE_QUALITY_LOW = _env_int("CMS_ARTICLE_IMAGE_QUALITY_LOW", 50)
CMS_ARTICLE_IMAGE_QUALITY_HIGH = _env_int("CMS_ARTICLE_IMAGE_QUALITY_HIGH", 90)
if not 1 <= CMS_ARTICLE_IMAGE_QUALITY_LOW <= 100:
    raise RuntimeError("CMS_ARTICLE_IMAGE_QUALITY_LOW must be between 1 and 100")
if not 1 <= CMS_ARTICLE_IMAGE_QUALITY_HIGH <= 100:
    raise RuntimeError("CMS_ARTICLE_IMAGE_QUALITY_HIGH must be between 1 and 100")
if CMS_ARTICLE_IMAGE_QUALITY_LOW > CMS_ARTICLE_IMAGE_QUALITY_HIGH:
    raise RuntimeError("CMS_ARTICLE_IMAGE_QUALITY_LOW must be <= CMS_ARTICLE_IMAGE_QUALITY_HIGH")
CMS_ARTICLE_SITE_LOGO_WATERMARK_WIDTH_RATIO = 0.12
CMS_ARTICLE_SITE_LOGO_WATERMARK_OPACITY = 1.0

_renderer_classes = [
    "rest_framework.renderers.JSONRenderer",
]
if DEBUG:
    _renderer_classes.append("rest_framework.renderers.BrowsableAPIRenderer")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.auth.authentication.MiddlewareUserAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_RENDERER_CLASSES": _renderer_classes,
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.exception_handler.api_exception_handler",
}

LOG_DIR = Path(_env("LOG_DIR") or "/tmp/syumatsucamera/log")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_RETENTION_DAYS = int(_env("LOG_RETENTION_DAYS") or "1")
APP_LOG_LEVEL = (_env("APP_LOG_LEVEL") or "INFO").upper()
LOG_FILE_INFO = _resolve_log_file_path("LOG_FILE_INFO", LOG_DIR)
LOG_FILE_CRITICAL = _resolve_log_file_path("LOG_FILE_CRITICAL", LOG_DIR)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "info_only": {"()": ExactLevelFilter, "level": logging.INFO},
        "critical_only": {"()": ExactLevelFilter, "level": logging.CRITICAL},
    },
    "formatters": {
        "verbose": {
            "format": "%(asctime)s %(levelname)s %(name)s [%(process)d]: %(message)s"
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "level": APP_LOG_LEVEL,
        },
        "info_file": {
            "class": "logging.handlers.TimedRotatingFileHandler",
            "filename": LOG_FILE_INFO,
            "when": "midnight",
            "backupCount": LOG_RETENTION_DAYS,
            "formatter": "verbose",
            "encoding": "utf-8",
            "level": "INFO",
            "filters": ["info_only"],
        },
        "critical_file": {
            "class": "logging.handlers.TimedRotatingFileHandler",
            "filename": LOG_FILE_CRITICAL,
            "when": "midnight",
            "backupCount": LOG_RETENTION_DAYS,
            "formatter": "verbose",
            "encoding": "utf-8",
            "level": "CRITICAL",
            "filters": ["critical_only"],
        },
    },
    "root": {
        "handlers": ["console", "info_file", "critical_file"],
        "level": APP_LOG_LEVEL,
    },
    "loggers": {
        "app": {
            "handlers": [
                "console",
                "info_file",
                "critical_file",
            ],
            "level": "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": [
                "console",
                "info_file",
                "critical_file",
            ],
            "level": "INFO",
            "propagate": False,
        },
    },
}
