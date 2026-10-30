"""Production server settings: bind 0.0.0.0 on APP_PUBLIC_PORT, prepare the database before serving."""

import os

bind = f"0.0.0.0:{os.environ.get('APP_PUBLIC_PORT', '4173')}"
workers = 2
worker_class = "gthread"
threads = 16
timeout = 120
accesslog = "-"
control_socket_disable = True
wsgi_app = "clearhouse:create_app()"


def on_starting(server):
    from clearhouse.boot import prepare_database
    prepare_database()


def post_worker_init(worker):
    from clearhouse.identity import watcher
    watcher.start()
