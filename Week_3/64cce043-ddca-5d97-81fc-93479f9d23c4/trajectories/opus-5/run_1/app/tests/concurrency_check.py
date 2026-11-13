"""Races, live streams and session endings, against a running server."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys

import asyncpg
import httpx
from signin import client, sign_in

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    (PASSED if condition else FAILED).append(name)
    print(("ok   " if condition else "FAIL ") + name + ("" if condition else f"  {detail}"))


class Stream:
    """A live stream held open the way a screen holds one."""

    def __init__(self, session: httpx.AsyncClient) -> None:
        self._session = session
        self.events: list[tuple[str, dict[str, object]]] = []
        self._task: asyncio.Task[None] | None = None
        self.status = 0
        self.closed = False

    async def __aenter__(self) -> "Stream":
        ready = asyncio.Event()
        self._task = asyncio.create_task(self._read(ready))
        await asyncio.wait_for(ready.wait(), 10)
        return self

    async def __aexit__(self, *_: object) -> None:
        assert self._task is not None
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass

    async def _read(self, ready: asyncio.Event) -> None:
        async with self._session.stream("GET", "/api/events") as response:
            self.status = response.status_code
            ready.set()
            if response.status_code != 200:
                return
            name = ""
            async for line in response.aiter_lines():
                if line.startswith("event: "):
                    name = line[7:].strip()
                elif line.startswith("data: "):
                    self.events.append((name, json.loads(line[6:])))
            self.closed = True

    async def wait_for(self, name: str, seconds: float = 3.0) -> tuple[str, dict[str, object]] | None:
        for _ in range(int(seconds * 20)):
            for event in self.events:
                if event[0] == name:
                    return event
            await asyncio.sleep(0.05)
        return None


async def db() -> asyncpg.Connection:
    return await asyncpg.connect(os.environ["DATABASE_URL"])


async def main() -> int:
    async with client() as ada, client() as ines:
        await sign_in(ada, "ada.marsh@example.com", "Strongroom-Owner-1")

        # DP-62: simultaneous holdings that differ only in company spelling
        spellings = ["Acme  Bank", "acme bank", " ACME Bank ", "ACME  BANK", "Acme Bank"]
        async with Stream(ada) as owner_stream:
            answers = await asyncio.gather(
                *[
                    ada.post(
                        "/api/holdings",
                        json={"company": name, "data_kind": "bank_account", "value": "1"},
                    )
                    for name in spellings
                ]
            )
            codes = sorted(answer.status_code for answer in answers)
            check("one holding wins, the rest are 409", codes == [201, 409, 409, 409, 409], codes)
            check(
                "every loser says holding_exists",
                all(
                    answer.json()["error"]["code"] == "holding_exists"
                    for answer in answers
                    if answer.status_code == 409
                ),
                [a.text for a in answers if a.status_code == 409][:1],
            )
            created = next(a for a in answers if a.status_code == 201).json()["holding"]
            await asyncio.sleep(0.6)
            creations = [e for e in owner_stream.events if e[1].get("type") == "holding.created"]
            check("exactly one change event was sent", len(creations) == 1, creations)
            check(
                "events carry only a type and an id",
                all(set(data) == {"type", "id"} for name, data in owner_stream.events if name == "change"),
                owner_stream.events[:2],
            )

            # DP-64: simultaneous edits of one record
            edits = await asyncio.gather(
                *[
                    ada.patch(
                        f"/api/holdings/{created['id']}",
                        json={"version": created["version"], "value": f"v{index}"},
                    )
                    for index in range(2)
                ]
            )
            codes = sorted(edit.status_code for edit in edits)
            check("one edit wins, one is stale", codes == [200, 409], codes)
            check(
                "the loser says stale_version",
                next(e for e in edits if e.status_code == 409).json()["error"]["code"]
                == "stale_version",
                next(e for e in edits if e.status_code == 409).text,
            )

            # DP-25: the same Idempotency-Key at the same moment
            key = secrets.token_hex(8)
            logs = await asyncio.gather(
                *[
                    ada.post(
                        "/api/breaches",
                        json={
                            "company": created["company"],
                            "announced_on": "2026-10-30",
                            "data_kinds": ["bank_account"],
                        },
                        headers={"Idempotency-Key": key},
                    )
                    for _ in range(4)
                ]
            )
            bodies = {json.dumps(log.json(), sort_keys=True) for log in logs}
            check(
                "every repeat answers the same 201 body",
                all(log.status_code == 201 for log in logs) and len(bodies) == 1,
                [log.status_code for log in logs],
            )
            connection = await db()
            stored = await connection.fetchval(
                "select count(*) from breaches where company_key = 'acme bank'"
            )
            check("exactly one breach was stored", stored == 1, stored)

            # DP-32: simultaneous identical step toggles
            steps = (await ada.get("/api/exposure")).json()["steps"]
            bank_step = next(
                s for s in steps if s["holding_id"] == created["id"] and s["number"] == 1
            )
            toggles = await asyncio.gather(
                *[ada.post(f"/api/steps/{bank_step['id']}/done") for _ in range(4)]
            )
            codes = sorted(toggle.status_code for toggle in toggles)
            check("one toggle wins, the rest are 409", codes == [200, 409, 409, 409], codes)
            await ada.post(f"/api/steps/{bank_step['id']}/reopen")

            # DP-65: the rule limit under load
            rules = (await ada.get("/api/rules")).json()["rules"]
            for _ in range(49 - len(rules)):
                await ada.post("/api/rules", json={"data_kind": "email", "level": "low"})
            count = len((await ada.get("/api/rules")).json()["rules"])
            check("the vault now holds 49 rules", count == 49, count)
            adds = await asyncio.gather(
                *[
                    ada.post("/api/rules", json={"data_kind": "phone", "level": "high"})
                    for _ in range(5)
                ]
            )
            codes = sorted(add.status_code for add in adds)
            check("one rule add wins at the limit", codes == [201, 409, 409, 409, 409], codes)
            check(
                "the losers say rule_limit",
                all(
                    add.json()["error"]["code"] == "rule_limit"
                    for add in adds
                    if add.status_code == 409
                ),
                [a.text for a in adds if a.status_code == 409][:1],
            )
            fiftieth = len((await ada.get("/api/rules")).json()["rules"])
            check("fifty rules are allowed", fiftieth == 50, fiftieth)

            # DP-65: a reorder built before a concurrent add
            before = [rule["id"] for rule in (await ada.get("/api/rules")).json()["rules"]]
            await ada.delete(f"/api/rules/{before[-1]}")
            stale_order = await ada.put("/api/rules/order", json={"rule_ids": before})
            check(
                "an order naming a deleted rule is 422",
                stale_order.status_code == 422
                and stale_order.json()["error"]["fields"] == {"rule_ids": "List every rule exactly once."},
                stale_order.text,
            )

            # tidy up the extra rules so later checks read a normal vault
            for rule_id in before[13:-1]:
                await ada.delete(f"/api/rules/{rule_id}")
            await ada.delete(f"/api/holdings/{created['id']}")
            breach_id = await connection.fetchval(
                "select id from breaches where company_key = 'acme bank'"
            )
            await ada.delete(f"/api/breaches/{breach_id}")

        # DP-37/DP-46: the contact's stream never carries record types or ids
        await sign_in(ines, "ines.marsh@example.com", "Strongroom-Contact-1")
        async with Stream(ines) as contact_stream, Stream(ada) as owner_stream:
            holding = await ada.post(
                "/api/holdings",
                json={"company": "Northgate Telecom", "data_kind": "phone", "value": "+44 700 1"},
            )
            seen = await contact_stream.wait_for("change")
            check(
                "the contact sees view.changed with no id",
                seen is not None and seen[1] == {"type": "view.changed", "id": None},
                seen,
            )
            narrowed = await ada.patch("/api/grant", json={"levels": ["critical", "high", "moderate"]})
            check("narrowing answers 200", narrowed.status_code == 200, narrowed.text)
            grant_event = None
            for _ in range(60):
                grant_event = next(
                    (e for e in contact_stream.events if e[1].get("type") == "grant.updated"), None
                )
                if grant_event:
                    break
                await asyncio.sleep(0.05)
            check("a narrow arrives as grant.updated", grant_event is not None, contact_stream.events)
            low_gone = (await ines.get("/api/holdings")).json()
            check(
                "the narrowed scope drops Low rows",
                all(item["level"] != "low" for item in low_gone["items"]),
                low_gone["total"],
            )

            # DP-80: simultaneous revokes
            revokes = await asyncio.gather(*[ada.delete("/api/grant") for _ in range(3)])
            codes = sorted(revoke.status_code for revoke in revokes)
            check("exactly one revoke wins", codes == [200, 409, 409], codes)
            ended = await contact_stream.wait_for("access-ended")
            check("the contact's stream receives access-ended", ended is not None, contact_stream.events)
            check(
                "exactly one access-ended arrives",
                sum(1 for name, _ in contact_stream.events if name == "access-ended") == 1,
                contact_stream.events,
            )
            check(
                "no grant.updated follows the revoke",
                [name for name, _ in contact_stream.events].count("grant.updated") <= 1,
                contact_stream.events,
            )
            await ada.delete(f"/api/holdings/{holding.json()['holding']['id']}")

        # DP-39/DP-79: simultaneous grants
        fresh = f"kin-{secrets.token_hex(4)}@example.com"
        other = f"kin-{secrets.token_hex(4)}@example.com"
        grants = await asyncio.gather(
            ada.post(
                "/api/grant",
                json={"contact_name": "Kin One", "contact_email": fresh,
                      "duration": "24h", "levels": ["critical", "high", "moderate", "low"]},
            ),
            ada.post(
                "/api/grant",
                json={"contact_name": "Kin Two", "contact_email": other,
                      "duration": "7d", "levels": ["low"]},
            ),
        )
        codes = sorted(grant.status_code for grant in grants)
        check("exactly one grant is created", codes == [201, 409], codes)
        winner = next(grant for grant in grants if grant.status_code == 201).json()
        check(
            "the winner's dialog shows a 16-character password",
            len(winner["temporary_password"]) == 16 and winner["temporary_password"].isalnum(),
            winner["temporary_password"],
        )
        loser_email = other if winner["grant"]["contact_email"] == fresh else fresh
        realm_users = await _realm_users(loser_email)
        check("the loser's email has no realm account", realm_users == [], realm_users)

        # DP-41: the new contact chooses a password and sees the scoped view
        async with client() as kin:
            from signin import choose_password

            await choose_password(
                kin, winner["grant"]["contact_email"], winner["temporary_password"], "Kin-Password-99"
            )
            kin_me = await kin.get("/api/me")
            check(
                "the new contact reaches their shared view",
                kin_me.status_code == 200 and kin_me.json()["role"] == "contact",
                kin_me.text,
            )
            scoped = await kin.get("/api/holdings")
            check("the new contact reads the ledger", scoped.status_code == 200, scoped.status_code)

        # DP-52: a password change ends every other session
        async with client() as second_window:
            await sign_in(second_window, "ada.marsh@example.com", "Strongroom-Owner-1")
            check(
                "the second window works before the change",
                (await second_window.get("/api/me")).status_code == 200,
            )
            changed = await ada.post(
                "/api/account/password",
                json={"current_password": "Strongroom-Owner-1", "new_password": "Strongroom-Owner-1b"},
            )
            check("the password change answers 200", changed.status_code == 200, changed.text)
            check(
                "the changing session stays signed in",
                (await ada.get("/api/me")).status_code == 200,
            )
            check(
                "the other window is signed out",
                (await second_window.get("/api/me")).status_code == 401,
            )
            owner_sessions = await _realm_sessions("ada.marsh@example.com")
            check("the realm lists no session for the owner", owner_sessions == [], owner_sessions)
            # put the seeded password back
            await ada.post(
                "/api/account/password",
                json={"current_password": "Strongroom-Owner-1b", "new_password": "Strongroom-Owner-1"},
            )

        # DP-67: streams release their database resources
        connection = await db()
        before_streams = await connection.fetchval(
            "select count(*) from pg_stat_activity where application_name = 'strongroom'"
        )
        for _ in range(60):
            async with Stream(ada):
                pass
        await asyncio.sleep(20)
        after_streams = await connection.fetchval(
            "select count(*) from pg_stat_activity where application_name = 'strongroom'"
        )
        check(
            "sixty opened and closed streams release everything",
            after_streams <= before_streams + 2,
            (before_streams, after_streams),
        )
        busy = await connection.fetch(
            """select state, count(*) from pg_stat_activity
               where application_name = 'strongroom' and state in ('active', 'idle in transaction')
               group by state"""
        )
        check("no strongroom session is left busy", [dict(row) for row in busy] == [], [dict(r) for r in busy])
        await connection.close()

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    for name in FAILED:
        print("  failed:", name)
    return 1 if FAILED else 0


async def _admin_token(session: httpx.AsyncClient) -> str:
    response = await session.post(
        f"{os.environ['KEYCLOAK_URL']}/realms/{os.environ['KEYCLOAK_REALM']}/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["AUTH_CLIENT_ID"],
            "client_secret": os.environ["AUTH_CLIENT_SECRET"],
        },
    )
    return response.json()["access_token"]


async def _realm_users(email: str) -> list[dict[str, object]]:
    async with httpx.AsyncClient(timeout=20) as session:
        token = await _admin_token(session)
        found = await session.get(
            f"{os.environ['KEYCLOAK_URL']}/admin/realms/{os.environ['KEYCLOAK_REALM']}/users",
            params={"email": email, "exact": "true"},
            headers={"Authorization": f"Bearer {token}"},
        )
        return found.json()


async def _realm_sessions(email: str) -> list[dict[str, object]]:
    async with httpx.AsyncClient(timeout=20) as session:
        token = await _admin_token(session)
        users = await _realm_users(email)
        if not users:
            return []
        sessions = await session.get(
            f"{os.environ['KEYCLOAK_URL']}/admin/realms/{os.environ['KEYCLOAK_REALM']}"
            f"/users/{users[0]['id']}/sessions",
            headers={"Authorization": f"Bearer {token}"},
        )
        return sessions.json()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
