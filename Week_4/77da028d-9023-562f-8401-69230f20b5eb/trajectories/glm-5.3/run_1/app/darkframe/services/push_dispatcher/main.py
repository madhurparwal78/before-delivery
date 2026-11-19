"""Push dispatcher service: routes on 127.0.0.1:<public port + 300>."""
from __future__ import annotations

from contextlib import asynccontextmanager

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from darkframe.common.http import build_app
from darkframe.services.push_dispatcher import dispatcher

VERSION = "1.0.0"


async def health(request: Request):
    return JSONResponse({"name": "push-dispatcher", "version": VERSION, "status": "ok"})


async def list_pushes(request: Request):
    ident = request.headers.get("x-imager-id", "")
    with dispatcher.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM pushes WHERE imager_id=%s ORDER BY created_at DESC, id DESC LIMIT 100",
            (ident,),
        ).fetchall()
        pushes = [
            {
                "id": r["id"],
                "kind": r["kind"],
                "date": r["date"],
                "title": r["title"],
                "message": r["message"],
                "status": r["status"],
                "attempts": int(r["attempts"]),
                "last_attempt_at": r["last_attempt_at"].isoformat().replace("+00:00", "Z") if r["last_attempt_at"] else None,
                "sent_at": r["sent_at"].isoformat().replace("+00:00", "Z") if r["sent_at"] else None,
            }
            for r in rows
        ]
    return JSONResponse({"pushes": pushes})


def routes() -> list[Route]:
    return [
        Route("/internal/health", health, methods=["GET"]),
        Route("/pushes", list_pushes, methods=["GET"]),
    ]


def create_app():
    from darkframe.config import load_config

    config = load_config()
    dispatcher.DB_URL = config.database_url
    dispatcher.NTFY_URL = config.ntfy_url
    dispatcher.NTFY_USERNAME = config.ntfy_username
    dispatcher.NTFY_PASSWORD = config.ntfy_password

    @asynccontextmanager
    async def lifespan(app):
        import threading

        stop = threading.Event()
        thread = threading.Thread(target=dispatcher.dispatch_loop, args=(stop,), daemon=True)
        thread.start()
        yield
        stop.set()

    return build_app(routes(), "push-dispatcher", lifespan=lifespan)


def serve() -> None:
    import uvicorn

    from darkframe.config import load_config

    config = load_config()
    uvicorn.run(create_app(), host="127.0.0.1", port=config.push_dispatcher_port, log_level="warning")
