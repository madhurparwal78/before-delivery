"""Checks that need a shortened clock.

Run with the server started as:
    GRANT_HOUR_SECONDS=1 SESSION_IDLE_SECONDS=20 ./tests/reset.sh
"""
from __future__ import annotations

import asyncio
import os
import secrets
import sys
import time

from concurrency_check import Stream, check, PASSED, FAILED
from signin import choose_password, client, sign_in


async def main() -> int:
    assert os.environ.get("GRANT_HOUR_SECONDS") == "1", "start the server with GRANT_HOUR_SECONDS=1"
    async with client() as ada:
        await sign_in(ada, "ada.marsh@example.com", "Strongroom-Owner-1")

        # A fresh grant of 24 grant hours lasts 24 seconds.
        await ada.delete("/api/grant")
        email = f"kin-{secrets.token_hex(4)}@example.com"
        answer = await ada.post(
            "/api/grant",
            json={
                "contact_name": "Kin Watcher",
                "contact_email": email,
                "duration": "24h",
                "levels": ["critical", "high", "moderate", "low"],
            },
        )
        check("a 24h grant is created", answer.status_code == 201, answer.text)
        grant = answer.json()["grant"]
        check(
            "the server sets the end instant from the duration",
            20 <= grant["remaining_seconds"] <= 24,
            grant["remaining_seconds"],
        )

        async with client() as kin:
            await choose_password(kin, email, answer.json()["temporary_password"], "Kin-Password-99")
            started = time.monotonic()
            async with Stream(kin) as watching:
                before = await kin.get("/api/holdings")
                check("a request before the end succeeds", before.status_code == 200, before.status_code)

                # The open screen keeps its session alive while it waits.
                async def poll() -> None:
                    while True:
                        await asyncio.sleep(5)
                        await kin.get("/api/contact/grant")

                keeping = asyncio.create_task(poll())
                ended = await watching.wait_for("access-ended", seconds=40)
                keeping.cancel()
                elapsed = time.monotonic() - started
                check(
                    "access-ended is pushed within two seconds of the end instant",
                    ended is not None and 20 <= elapsed <= 27,
                    (ended, round(elapsed, 2)),
                )
            after = await kin.get("/api/holdings")
            check(
                "a request at or after the end instant is access_ended",
                after.status_code == 403 and after.json()["error"]["code"] == "access_ended",
                after.text,
            )
            still_me = await kin.get("/api/me")
            check("the contact can still read /api/me", still_me.status_code == 200, still_me.status_code)
            contact_grant = await kin.get("/api/contact/grant")
            check(
                "the contact can still read their grant",
                contact_grant.status_code == 200
                and contact_grant.json()["status"] == "expired"
                and contact_grant.json()["remaining_seconds"] == 0,
                contact_grant.text,
            )

    # An idle session expires by the database clock.
    async with client() as idle:
        await sign_in(idle, "teodor.vance@example.com", "Strongroom-Owner-2")
        check("the new session works", (await idle.get("/api/me")).status_code == 200)
        async with Stream(idle) as stream:
            await asyncio.sleep(22)
            expired = await idle.get("/api/me")
            check(
                "an idle session answers 401",
                expired.status_code == 401 and expired.json()["error"]["code"] == "signed_out",
                expired.text,
            )
            for _ in range(40):
                if stream.closed:
                    break
                await asyncio.sleep(0.5)
            check("its live stream closes by the next keep-alive", stream.closed, stream.events)

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    for name in FAILED:
        print("  failed:", name)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
