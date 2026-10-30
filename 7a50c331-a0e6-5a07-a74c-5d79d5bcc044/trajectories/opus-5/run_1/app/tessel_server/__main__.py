"""Start the production server: apply the schema and seed, then serve."""
from gunicorn.app.base import BaseApplication

from . import config, db, schema, seed, worker
from .app import application


class TesselServer(BaseApplication):
    def load_config(self):
        self.cfg.set("bind", "%s:%d" % (config.BIND_HOST, config.BIND_PORT))
        self.cfg.set("workers", 1)
        self.cfg.set("threads", 32)
        self.cfg.set("worker_class", "gthread")
        self.cfg.set("timeout", 120)
        self.cfg.set("graceful_timeout", 10)
        self.cfg.set("keepalive", 5)
        self.cfg.set("accesslog", None)
        self.cfg.set("post_worker_init", lambda _worker: worker.start())

    def load(self):
        return application


def main():
    db.wait_until_reachable()
    schema.apply()
    seed.apply()
    db.close_idle()
    TesselServer().run()


if __name__ == "__main__":
    main()
