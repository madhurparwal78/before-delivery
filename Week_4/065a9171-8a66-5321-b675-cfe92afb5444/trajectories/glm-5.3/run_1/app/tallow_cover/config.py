"""Environment configuration. Values are read once at start; none reach the browser."""
import os

INT_DEFAULTS = {
    "APP_PUBLIC_PORT": 4173,
    "ESCALATION_AFTER_SECONDS": 172800,
    "SESSION_TTL_SECONDS": 43200,
    "IDEMPOTENCY_TTL_SECONDS": 86400,
    "SMTP_PORT": 1025,
}


class Config:
    def __init__(self, env=None):
        env = env if env is not None else os.environ
        self.database_url = env["DATABASE_URL"]
        self.smtp_host = env.get("SMTP_HOST", "")
        self.smtp_port = self._int(env, "SMTP_PORT")
        self.mail_from = env.get("MAIL_FROM", "Tallow Cover <cover@tallow.example>")
        self.s3_endpoint = env.get("S3_ENDPOINT", "")
        self.s3_region = env.get("S3_REGION", "us-east-1")
        self.s3_bucket = env.get("S3_BUCKET", "")
        self.s3_force_path_style = env.get("S3_FORCE_PATH_STYLE", "true").lower() != "false"
        self.s3_access_key_id = env.get("S3_ACCESS_KEY_ID", "")
        self.s3_secret_access_key = env.get("S3_SECRET_ACCESS_KEY", "")
        self.public_port = self._int(env, "APP_PUBLIC_PORT")
        self.escalation_after_seconds = self._int(env, "ESCALATION_AFTER_SECONDS")
        self.session_ttl_seconds = self._int(env, "SESSION_TTL_SECONDS")
        self.idempotency_ttl_seconds = self._int(env, "IDEMPOTENCY_TTL_SECONDS")

    @staticmethod
    def _int(env, name):
        raw = env.get(name)
        if raw is None or raw == "":
            return INT_DEFAULTS[name]
        try:
            return int(raw)
        except ValueError:
            return INT_DEFAULTS[name]

    @property
    def pg_parts(self):
        """Split DATABASE_URL into connection pieces."""
        from urllib.parse import urlparse, unquote
        u = urlparse(self.database_url)
        return {
            "host": u.hostname or "localhost",
            "port": u.port or 5432,
            "user": unquote(u.username or ""),
            "password": unquote(u.password or ""),
            "database": (u.path or "/").lstrip("/"),
        }
