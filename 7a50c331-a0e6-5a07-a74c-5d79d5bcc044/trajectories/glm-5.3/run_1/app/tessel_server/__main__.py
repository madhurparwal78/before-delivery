"""The Tessel server: PostgreSQL holds every record, Mailpit carries every notice."""
import asyncio
import json
import os
import signal
import sys

import asyncpg
from aiohttp import web

from . import api, routing, routes, pages
from .config import (DATABASE_URL, BIND_HOST, BIND_PORT, SQL, PUBLIC_URL,
                     FIXTURE_REPO)
from .envelope import NO_STORE, SECURITY_HEADERS
from . import seed


async def connect_pool():
    while True:
        try:
            return await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=16)
        except Exception as e:
            print("waiting for postgres:", e, flush=True)
            await asyncio.sleep(1)


async def apply_schema(pool):
    while True:
        try:
            async with pool.acquire() as conn:
                await conn.execute(SQL)
            await seed.seed_all(pool)
            return
        except Exception as e:
            print("waiting for schema:", e, flush=True)
            await asyncio.sleep(1)


async def api_dispatch(request):
    return await api.dispatch(request)


async def page_404(request):
    return web.Response(status=404, text=pages.render_404(request),
                        content_type="text/html")


def make_app():
    routes.register_all()
    app = web.Application(client_max_size=4 * 1024 * 1024)
    app["db"] = {"pool": None}
    app.router.add_route("*", "/api/{tail:.*}", api_dispatch)
    for method, pattern, fn in pages.page_routes():
        app.router.add_route(method, pattern, fn)
    app.router.add_route("*", "/{tail:.*}", page_404)
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(static_dir):
        app.router.add_static("/static/", static_dir)
    return app


def main():
    app = make_app()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    runner = web.AppRunner(app, access_log=None)
    loop.run_until_complete(runner.setup())

    async def connect_and_seed():
        pool = await connect_pool()
        app["db"]["pool"] = pool
        await apply_schema(pool)

    # start serving at once; the database connects and seeds in the background
    loop.create_task(connect_and_seed())
    site = web.TCPSite(runner, BIND_HOST, BIND_PORT)
    loop.run_until_complete(site.start())
    print("tessel serving on %s:%d" % (BIND_HOST, BIND_PORT), flush=True)
    try:
        loop.run_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
