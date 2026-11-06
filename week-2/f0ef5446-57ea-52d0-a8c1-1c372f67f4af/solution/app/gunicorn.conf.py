"""Production server settings: one process (it also runs the email deliverer), many threads."""

from relayo.config import settings

bind = f"0.0.0.0:{settings.app_public_port}"
workers = 1
worker_class = "gthread"
threads = 32
timeout = 60
graceful_timeout = 5
accesslog = "-"
errorlog = "-"


def post_worker_init(worker: object) -> None:
    from relayo.app import start

    start()
