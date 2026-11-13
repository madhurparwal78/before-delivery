"""The three settings the app reads, and the only place it reads them."""
import os

DATABASE_URL = os.environ["DATABASE_URL"]
PUBLIC_URL = os.environ["APP_PUBLIC_URL"].rstrip("/")
