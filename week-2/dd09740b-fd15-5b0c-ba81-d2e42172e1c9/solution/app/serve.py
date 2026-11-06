"""Foreground entrypoint: replace this process with gunicorn on 0.0.0.0:$APP_PUBLIC_PORT.

The schema, seed and outbox sender start inside each worker (northpier.wsgi), so the server answers health
and outage refusals even while PostgreSQL is still unreachable.
"""
import os
import sys

from northpier.config import SETTINGS

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.execv(sys.executable, [
    sys.executable, "-m", "gunicorn", "northpier.wsgi:application",
    "--bind", f"0.0.0.0:{SETTINGS.port}",
    "--worker-class", "gthread", "--workers", "2", "--threads", "12",
    "--timeout", "60", "--graceful-timeout", "5", "--access-logfile", "-",
])
