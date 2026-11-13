"""What the app does while the realm is unreachable.

The server is restarted against a dead realm address, with the database untouched,
so the sessions and vault data from before the outage are still there.
"""
from __future__ import annotations

import asyncio
import os
import secrets
import subprocess
import sys

import httpx
from signin import BASE, client, sign_in

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    (PASSED if condition else FAILED).append(name)
    print(("ok   " if condition else "FAIL ") + name + ("" if condition else f"  {detail}"))


def restart(keycloak_url: str) -> None:
    environment = {**os.environ, "KEYCLOAK_URL": keycloak_url}
    subprocess.run(["/app/devserver.sh"], env=environment, check=True, capture_output=True)


async def main() -> int:
    async with client() as ada:
        await sign_in(ada, "ada.marsh@example.com", "Strongroom-Owner-1")
        cookies = dict(ada.cookies)

    # A dead address stands in for a stopped realm.
    restart("http://127.0.0.1:9")
    await asyncio.sleep(4)

    async with httpx.AsyncClient(base_url=BASE, follow_redirects=False, timeout=20) as owner:
        for name, value in cookies.items():
            owner.cookies.set(name, value)

        status = await owner.get("/api/status")
        check("the status route reports the outage", status.json() == {"identity": "down"}, status.text)

        ledger = await owner.get("/api/holdings")
        check(
            "an existing session still reads the vault",
            ledger.status_code == 200 and ledger.json()["total"] >= 1,
            ledger.status_code,
        )
        written = await owner.post(
            "/api/holdings",
            json={"company": "Outage Supplies", "data_kind": "email", "value": "a@b.com"},
        )
        check("an existing session still writes", written.status_code == 201, written.text)
        await owner.delete(f"/api/holdings/{written.json()['holding']['id']}")

        async with httpx.AsyncClient(base_url=BASE, timeout=20) as visitor:
            landing = await visitor.get("/")
        check(
            "the landing page still serves a signed-out visitor",
            landing.status_code == 200 and "Strongroom Ledger" in landing.text,
            landing.status_code,
        )

        login = await owner.get("/auth/login")
        check(
            "sign-in shows the unavailable page with 503",
            login.status_code == 503
            and "Sign-in unavailable" in login.text
            and "Sign-in service unavailable. Try again in a few minutes." in login.text,
            login.status_code,
        )

        narrowed = await owner.patch("/api/grant", json={"levels": ["critical", "high", "moderate"]})
        check("narrowing still works", narrowed.status_code == 200, narrowed.text)

        granted = await owner.post(
            "/api/grant",
            json={
                "contact_name": "Kin",
                "contact_email": f"kin-{secrets.token_hex(3)}@example.com",
                "duration": "24h",
                "levels": ["low"],
            },
        )
        check(
            "a new grant answers 409 before the realm is needed",
            granted.status_code == 409,
            granted.text,
        )

        password = await owner.post(
            "/api/account/password",
            json={"current_password": "Strongroom-Owner-1", "new_password": "Strongroom-Owner-9"},
        )
        check(
            "changing the password answers 503",
            password.status_code == 503
            and password.json()["error"]["code"] == "identity_unavailable",
            password.text,
        )
        bad_body = await owner.post("/api/account/password", json={})
        check("503 wins over an invalid body", bad_body.status_code == 503, bad_body.text)

        revoked = await owner.delete("/api/grant")
        check("revoking still ends access", revoked.status_code == 200, revoked.text)

        fresh_grant = await owner.post(
            "/api/grant",
            json={
                "contact_name": "Kin",
                "contact_email": f"kin-{secrets.token_hex(3)}@example.com",
                "duration": "24h",
                "levels": ["low"],
            },
        )
        check(
            "granting answers 503 while the realm is unreachable",
            fresh_grant.status_code == 503
            and fresh_grant.json()["error"]["code"] == "identity_unavailable",
            fresh_grant.text,
        )
        stored = await owner.get("/api/grant")
        check(
            "the refused grant stored nothing",
            stored.json()["grant"]["status"] == "revoked",
            stored.text,
        )

    restart(os.environ["KEYCLOAK_URL"])
    await asyncio.sleep(2)
    async with httpx.AsyncClient(base_url=BASE, timeout=20) as back:
        for _ in range(20):
            status = await back.get("/api/status")
            if status.json() == {"identity": "ok"}:
                break
            await asyncio.sleep(1)
        check("the banner clears once the realm is back", status.json() == {"identity": "ok"}, status.text)

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    for name in FAILED:
        print("  failed:", name)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
