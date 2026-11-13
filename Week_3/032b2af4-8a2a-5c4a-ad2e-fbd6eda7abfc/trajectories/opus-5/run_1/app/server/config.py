"""Runtime configuration read from the environment."""
import os

DATABASE_URL = os.environ["DATABASE_URL"]
PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))
PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", f"http://127.0.0.1:{PUBLIC_PORT}")

MAX_BODY_BYTES = 5_000_000
SEED_PASSWORD = "deku-demo-pw-2026"
