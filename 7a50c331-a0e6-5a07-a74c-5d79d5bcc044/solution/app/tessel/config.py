"""Every setting the app reads, taken from the environment variables the brief names."""
import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent

DATABASE_URL = os.environ["DATABASE_URL"]
APP_PUBLIC_URL = os.environ["APP_PUBLIC_URL"].rstrip("/")
PORT = int(os.environ.get("APP_PUBLIC_PORT") or 4173)
SMTP_HOST = os.environ["SMTP_HOST"]
SMTP_PORT = int(os.environ["SMTP_PORT"])
MAIL_FROM = os.environ["MAIL_FROM"]

CODE_HOST_FIXTURE = APP_ROOT / "fixtures" / "code-host-repo.json"
