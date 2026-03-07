import logging
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent.parent


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


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        raise KeyError(name)
    return value


def _required_bool(name: str) -> bool:
    value = _required_env(name).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"Environment variable '{name}' must be boolean-like")


def _required_int(name: str) -> int:
    raw = _required_env(name)
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable '{name}' must be integer") from exc
    if value < 1:
        raise RuntimeError(f"Environment variable '{name}' must be >= 1")
    return value


def _resolve_log_file_path(filename_env_key: str, log_dir: Path) -> str:
    raw = _required_env(filename_env_key)
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
]

_missing = [k for k in _REQUIRED_ENV_VARS if not os.getenv(k)]
if _missing:
    _log_missing_env_to_bootstrap_file(_missing)
    raise RuntimeError(
        "Missing required environment variables: " + ", ".join(sorted(_missing))
    )

SECRET_KEY = _required_env("SECRET_KEY")
DEBUG = _required_bool("DEBUG")
ALLOWED_HOSTS = [v.strip() for v in _required_env("ALLOWED_HOSTS").split(",") if v.strip()]
CSRF_TRUSTED_ORIGINS = [
    v.strip()
    for v in _required_env("DJANGO_CSRF_TRUSTED_ORIGINS").split(",")
    if v.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "syumatsucamera.urls"
WSGI_APPLICATION = "syumatsucamera.wsgi.application"
ASGI_APPLICATION = "syumatsucamera.asgi.application"

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
        "NAME": _required_env("POSTGRES_DB"),
        "USER": _required_env("POSTGRES_USER"),
        "PASSWORD": _required_env("POSTGRES_PASSWORD"),
        "HOST": _required_env("POSTGRES_HOST"),
        "PORT": _required_env("POSTGRES_PORT"),
    }
}

REDIS_URL = _required_env("REDIS_URL")
REDIS_CONNECT_TIMEOUT = _required_env("REDIS_CONNECT_TIMEOUT")
REDIS_SOCKET_TIMEOUT = _required_env("REDIS_SOCKET_TIMEOUT")
TURNSTILE_SITE_KEY = _required_env("TURNSTILE_SITE_KEY")
TURNSTILE_SECRET_KEY = _required_env("TURNSTILE_SECRET_KEY")

EMAIL_HOST = _required_env("EMAIL_HOST")
EMAIL_PORT = _required_int("EMAIL_PORT")
EMAIL_USE_TLS = True
EMAIL_HOST_USER = _required_env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = _required_env("EMAIL_HOST_PASSWORD")

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

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CORS_ALLOW_ALL_ORIGINS = True

LOG_DIR = Path(_required_env("LOG_DIR"))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_RETENTION_DAYS = _required_int("LOG_RETENTION_DAYS")
APP_LOG_LEVEL = _required_env("APP_LOG_LEVEL").upper()
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
