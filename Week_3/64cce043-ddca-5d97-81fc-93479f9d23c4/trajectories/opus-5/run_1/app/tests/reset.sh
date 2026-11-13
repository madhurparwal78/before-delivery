#!/bin/sh
# Development helper: empty the database and the realm's test users, then restart the
# server so the seed and the seeded accounts are applied again.
/app/.venv/bin/python - <<'PY'
import asyncio, os, asyncpg, httpx


async def main() -> None:
    connection = await asyncpg.connect(os.environ["DATABASE_URL"])
    await connection.execute("drop schema public cascade; create schema public;")
    await connection.close()

    realm = os.environ["KEYCLOAK_REALM"]
    base = os.environ["KEYCLOAK_URL"]
    async with httpx.AsyncClient(timeout=20) as session:
        token = await session.post(
            f"{base}/realms/{realm}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": os.environ["AUTH_CLIENT_ID"],
                "client_secret": os.environ["AUTH_CLIENT_SECRET"],
            },
        )
        headers = {"Authorization": f"Bearer {token.json()['access_token']}"}
        people = await session.get(
            f"{base}/admin/realms/{realm}/users", params={"max": "500"}, headers=headers
        )
        for person in people.json():
            if person["username"].startswith("service-account"):
                continue
            await session.delete(
                f"{base}/admin/realms/{realm}/users/{person['id']}", headers=headers
            )


asyncio.run(main())
PY
exec /app/devserver.sh
