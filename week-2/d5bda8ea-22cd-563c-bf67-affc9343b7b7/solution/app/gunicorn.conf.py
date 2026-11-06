"""Production WSGI settings; the bind address comes from run.json's serve command."""
workers = 3
worker_class = "gthread"
threads = 8
timeout = 30
graceful_timeout = 10
# The app module is imported once in the master, so every worker shares one start time.
preload_app = True


def post_worker_init(worker):
    from mela import db
    db.prepare_in_background()
