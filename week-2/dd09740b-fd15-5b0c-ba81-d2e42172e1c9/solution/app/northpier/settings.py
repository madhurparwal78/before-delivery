"""Django settings: templates and routing only; data lives in PostgreSQL through northpier.db."""
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SECRET_KEY = secrets.token_urlsafe(48)
DEBUG = False
ALLOWED_HOSTS = ["*"]
ROOT_URLCONF = "northpier.urls"
WSGI_APPLICATION = "northpier.wsgi.application"
INSTALLED_APPS: list[str] = []
DATABASES: dict = {}
MIDDLEWARE = ["northpier.middleware.Boundary"]
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "OPTIONS": {"builtins": ["northpier.templatetags"]},
}]
USE_TZ = True
TIME_ZONE = "UTC"
USE_I18N = False
DATA_UPLOAD_MAX_MEMORY_SIZE = None
DEFAULT_CHARSET = "utf-8"
LOGGING_CONFIG = None
