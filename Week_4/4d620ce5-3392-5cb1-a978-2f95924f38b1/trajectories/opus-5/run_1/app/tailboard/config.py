"""Runtime configuration, read from the environment at start."""

import os

BASE_TZ_NAME = "Europe/London"
OPERATOR_NAME = "Fenwick Regional Airways"
AUTHORITY_MAILBOX = "continuing-airworthiness@caa-oversight.test"

JSON_BODY_LIMIT = 65_536
OBJECT_BODY_LIMIT = 5_000_000
IMPORT_BODY_LIMIT = 1_000_000

SESSION_COOKIE = "tb_session"


def _env(name, default=None):
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


class Config:
    def __init__(self):
        self.database_url = _env("DATABASE_URL")
        self.s3_endpoint = _env("S3_ENDPOINT")
        self.s3_region = _env("S3_REGION", "us-east-1")
        self.s3_bucket = _env("S3_BUCKET")
        self.s3_force_path_style = str(_env("S3_FORCE_PATH_STYLE", "true")).lower() in (
            "1",
            "true",
            "yes",
        )
        self.s3_access_key_id = _env("S3_ACCESS_KEY_ID")
        self.s3_secret_access_key = _env("S3_SECRET_ACCESS_KEY")
        self.smtp_host = _env("SMTP_HOST")
        self.smtp_port = int(_env("SMTP_PORT", "1025"))
        self.mail_from = _env("MAIL_FROM", "tailboard@fenwick-regional.test")
        self.public_port = int(_env("APP_PUBLIC_PORT", "4173"))
        self.public_url = _env("APP_PUBLIC_URL", "http://127.0.0.1:4173")
        self.notice_hold_seconds = max(0, min(600, int(_env("NOTICE_HOLD_SECONDS", "30"))))
        self.clock_start = _env("TAILBOARD_CLOCK_START")


config = Config()
