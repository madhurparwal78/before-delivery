import os

bind = f"0.0.0.0:{os.environ.get('APP_PUBLIC_PORT') or '4173'}"
workers = 2
threads = 8
worker_class = "gthread"
timeout = 60
graceful_timeout = 20
accesslog = "-"
errorlog = "-"
