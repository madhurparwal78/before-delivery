"""Production server settings: one port per instance, taken from PORT, then APP_PUBLIC_PORT."""

import os

_port = os.environ.get("PORT") or os.environ.get("APP_PUBLIC_PORT") or "4173"
bind = f"0.0.0.0:{_port}"
workers = 2
worker_class = "gthread"
threads = 64
timeout = 120
graceful_timeout = 3
# Each request gets its own connection: with gthread keep-alive, a browser reusing an idle socket while the
# worker is busy with live streams could wait seconds for its page modules.
keepalive = 0
accesslog = None
errorlog = "-"
limit_request_line = 8190
