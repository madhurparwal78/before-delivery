"""Sign-in binding, provisioning, return paths, scope updates and request isolation."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys

import asyncpg
import httpx
from concurrency_check import Stream
from signin import BASE, client, prepare, sign_in

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    (PASSED if condition else FAILED).append(name)
    print(("ok   " if condition else "FAIL ") + name + ("" if condition else f"  {detail}"))


async def admin_token(session: httpx.AsyncClient) -> str:
    token = await session.post(
        f"{os.environ['KEYCLOAK_URL']}/realms/{os.environ['KEYCLOAK_REALM']}"
        "/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["AUTH_CLIENT_ID"],
            "client_secret": os.environ["AUTH_CLIENT_SECRET"],
        },
    )
    return token.json()["access_token"]


async def make_realm_person(email: str, password: str, name: str) -> None:
    async with httpx.AsyncClient(timeout=20) as session:
        token = await admin_token(session)
        first, _, last = name.partition(" ")
        await session.post(
            f"{os.environ['KEYCLOAK_URL']}/admin/realms/{os.environ['KEYCLOAK_REALM']}/users",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": first,
                "lastName": last or first,
                "credentials": [{"type": "password", "value": password, "temporary": False}],
            },
        )


async def main() -> int:
    # -- DP-02, DP-03: the sign-in is bound to the browser that started it ----
    async with client() as browser, client() as other:
        callback = await prepare(browser, "ada.marsh@example.com", "Strongroom-Owner-1")

        pending_only = await browser.get("/api/holdings")
        check(
            "a pending sign-in reaches nothing",
            pending_only.status_code == 401
            and pending_only.json()["error"]["code"] == "signed_out",
            pending_only.text,
        )
        screen = await browser.get("/vault")
        check(
            "a pending sign-in sees no vault screen",
            screen.status_code == 302 and screen.headers["location"].startswith("/?next="),
            screen.status_code,
        )

        foreign = await other.get(callback)
        check(
            "a callback from another browser fails",
            foreign.status_code == 400 and "Sign-in failed" in foreign.text,
            foreign.status_code,
        )
        check(
            "the failed callback sets no session",
            "strongroom_session" not in other.cookies,
            dict(other.cookies),
        )

        done = await browser.get(callback)
        check("the right browser signs in", done.status_code == 303, done.status_code)
        replay = await browser.get(callback)
        check(
            "a reused state fails",
            replay.status_code == 400 and "Sign-in failed" in replay.text,
            replay.status_code,
        )
        missing_state = await browser.get("/auth/callback?code=abc")
        check("a callback with no state fails", missing_state.status_code == 400, missing_state.status_code)

    # -- DP-61: only a safe return path is honoured --------------------------
    for raw, landing in [
        ("%2Fvault%2Frules", "/vault/rules"),
        ("%2Fvault%3Fq%3Dcop", "/vault?q=cop"),
        ("%2F%2Fevil.example", "/vault"),
        ("%2F%5Cevil", "/vault"),
        ("%2Fshared", "/vault"),
        ("%2Fnot-a-screen", "/vault"),
        ("https%3A%2F%2Fevil.example", "/vault"),
        ("%2Fvault%2F" + "x" * 600, "/vault"),
    ]:
        async with client() as session:
            callback = await prepare(session, "ada.marsh@example.com", "Strongroom-Owner-1", raw)
            answer = await session.get(callback)
            check(
                f"next={raw[:24]} lands on {landing}",
                answer.headers.get("location") == landing,
                answer.headers.get("location"),
            )

    # -- DP-04, DP-75: one vault per account, under simultaneous first sign-ins
    newcomer = f"new-{secrets.token_hex(4)}@example.com"
    await make_realm_person(newcomer, "Newcomer-Password-1", "Nell Harrow")
    async with client() as first, client() as second:
        one = await prepare(first, newcomer, "Newcomer-Password-1")
        two = await prepare(second, newcomer, "Newcomer-Password-1")
        answers = await asyncio.gather(first.get(one), second.get(two))
        check(
            "both callbacks succeed",
            all(answer.status_code == 303 for answer in answers),
            [answer.status_code for answer in answers],
        )
        ledger = await first.get("/api/holdings")
        check(
            "the new account gets an empty vault",
            ledger.status_code == 200 and ledger.json()["total"] == 0,
            ledger.text[:200],
        )
        check(
            "its exposure is Clear",
            ledger.json()["exposure"] == {"score": 0, "band": "Clear"},
            ledger.json()["exposure"],
        )
        rules_one = await first.get("/api/rules")
        rules_two = await second.get("/api/rules")
        check(
            "exactly twelve default rules, the same for both sessions",
            len(rules_one.json()["rules"]) == 12
            and [rule["id"] for rule in rules_one.json()["rules"]]
            == [rule["id"] for rule in rules_two.json()["rules"]],
            len(rules_one.json()["rules"]),
        )
        check(
            "the default order is the published one",
            [rule["label"] for rule in rules_one.json()["rules"]]
            == [
                "Passport is Critical",
                "National ID is Critical",
                "Tax ID is Critical",
                "Health record is High",
                "Bank account is High",
                "Payment card is High",
                "Driving licence is High",
                "Password is High",
                "Date of birth is Moderate",
                "Home address is Moderate",
                "Phone number is Low",
                "Email address is Low",
            ],
            [rule["label"] for rule in rules_one.json()["rules"]],
        )
        connection = await asyncpg.connect(os.environ["DATABASE_URL"])
        vaults = await connection.fetchval(
            """select count(*) from vaults join accounts on accounts.id = vaults.owner_account_id
               where accounts.email = $1""",
            newcomer,
        )
        check("exactly one vault was created", vaults == 1, vaults)
        await connection.close()

    async with client() as ada, client() as ines, client() as teodor:
        await sign_in(ada, "ada.marsh@example.com", "Strongroom-Owner-1")
        await sign_in(ines, "ines.marsh@example.com", "Strongroom-Contact-1")
        await sign_in(teodor, "teodor.vance@example.com", "Strongroom-Owner-2")

        # -- DP-27: editing a breach's kinds clears the marks it no longer touches
        breach = (await ada.get("/api/breaches")).json()["breaches"][0]
        steps = (await ada.get("/api/exposure")).json()["steps"]
        passport_first = next(step for step in steps if step["data_kind"] == "passport")
        await ada.post(f"/api/steps/{passport_first['id']}/done")
        narrowed = await ada.patch(
            f"/api/breaches/{breach['id']}",
            json={"version": breach["version"], "data_kinds": ["date_of_birth"]},
        )
        check("editing the kinds answers 200", narrowed.status_code == 200, narrowed.text)
        after = narrowed.json()["exposure"]
        check(
            "the passport steps are gone and the score follows",
            all(step["data_kind"] != "passport" for step in after["steps"]) and after["score"] == 8,
            after,
        )
        back = await ada.patch(
            f"/api/breaches/{breach['id']}",
            json={
                "version": narrowed.json()["breach"]["version"],
                "data_kinds": ["passport", "date_of_birth"],
            },
        )
        restored = back.json()["exposure"]
        check(
            "the cleared done mark does not come back",
            restored["score"] == 48
            and all(step["status"] == "open" for step in restored["steps"]),
            restored["score"],
        )

        # -- DP-36: a deleted holding leaves every surface --------------------
        created = await ada.post(
            "/api/holdings",
            json={"company": "Brightway Air", "data_kind": "password", "value": "hunter2"},
        )
        holding_id = created.json()["holding"]["id"]
        await ada.post(
            "/api/breaches",
            json={
                "company": "Brightway Air",
                "announced_on": "2026-10-20",
                "data_kinds": ["passport", "date_of_birth", "password"],
            },
        )
        touched = (await ada.get("/api/breaches")).json()["breaches"]
        check(
            "the new holding is affected at once",
            any(holding_id in entry["affected_holding_ids"] for entry in touched),
            touched,
        )
        await ada.delete(f"/api/holdings/{holding_id}")
        gone = await ada.get("/api/holdings")
        exposure = (await ada.get("/api/exposure")).json()
        breaches = (await ada.get("/api/breaches")).json()["breaches"]
        contact_view = (await ines.get("/api/holdings")).json()
        check(
            "it is gone from the list, facets, totals, steps, breaches and the contact's view",
            all(item["id"] != holding_id for item in gone.json()["items"])
            and gone.json()["total"] == 12
            and all(step["holding_id"] != holding_id for step in exposure["steps"])
            and all(
                holding_id not in entry["affected_holding_ids"] for entry in breaches
            )
            and all(item["id"] != holding_id for item in contact_view["items"]),
            gone.json()["total"],
        )
        for entry in breaches:
            if entry["company"] == "Brightway Air" and entry["data_kinds"] == [
                "passport",
                "date_of_birth",
                "password",
            ]:
                await ada.delete(f"/api/breaches/{entry['id']}")

        # -- DP-77: a rule edit moves a holding into the contact's view -------
        await ada.patch("/api/grant", json={"levels": ["moderate", "low"]})
        before = (await ines.get("/api/holdings")).json()
        check(
            "the clinic rows start outside the narrowed scope",
            all(item["company"] != "Larchfield Clinic" for item in before["items"]),
            [item["company"] for item in before["items"]],
        )
        async with Stream(ines) as watching:
            clinic_rule = next(
                rule
                for rule in (await ada.get("/api/rules")).json()["rules"]
                if rule["company_contains"] == "clinic"
            )
            await ada.patch(
                f"/api/rules/{clinic_rule['id']}",
                json={"version": clinic_rule["version"], "level": "moderate"},
            )
            pushed = await watching.wait_for("change", seconds=2)
            check("the contact's screen is told within two seconds", pushed is not None, watching.events)
            inside = (await ines.get("/api/holdings")).json()
            clinic = [item for item in inside["items"] if item["company"] == "Larchfield Clinic"]
            check(
                "both clinic rows arrive unmasked at Moderate",
                len(clinic) == 2
                and all(item["level"] == "moderate" for item in clinic)
                and any(item["value"] == "Patient LC-208113" for item in clinic),
                clinic,
            )
            updated = (await ada.get("/api/rules")).json()["rules"]
            moved = next(rule for rule in updated if rule["company_contains"] == "clinic")
            await ada.patch(
                f"/api/rules/{moved['id']}",
                json={"version": moved["version"], "level": "high"},
            )
            outside = (await ines.get("/api/holdings")).json()
            check(
                "raising the rule to High removes them again",
                all(item["company"] != "Larchfield Clinic" for item in outside["items"]),
                [item["company"] for item in outside["items"]],
            )
            hidden = await ines.get(f"/api/holdings/{clinic[0]['id']}")
            check("their ids then answer 404", hidden.status_code == 404, hidden.status_code)

        # -- DP-76: answers belong to their caller ----------------------------
        async def ask(session: httpx.AsyncClient, path: str) -> httpx.Response:
            return await session.get(path)

        work = []
        for _ in range(40):
            work.append(ask(ada, "/api/me"))
            work.append(ask(ines, "/api/me"))
            work.append(ask(teodor, "/api/me"))
            work.append(ask(ada, "/api/holdings"))
            work.append(ask(teodor, "/api/holdings"))
            work.append(ask(ines, "/api/holdings"))
        answers = await asyncio.gather(*work)
        mine = {"ada.marsh@example.com": 0, "ines.marsh@example.com": 0, "teodor.vance@example.com": 0}
        wrong = []
        for index, answer in enumerate(answers):
            payload = answer.json()
            if "email" in payload:
                mine[payload["email"]] += 1
            else:
                companies = {item["company"] for item in payload["items"]}
                owner = index % 6
                if owner == 3 and not companies <= {
                    "Brightway Air",
                    "Copperleaf Bank",
                    "Larchfield Clinic",
                    "Parcelwise",
                    "Tally Rent",
                }:
                    wrong.append(companies)
                if owner == 4 and not companies <= {"Quayside Mobile", "Harbor Gym"}:
                    wrong.append(companies)
        check(
            "every answer carries only its own caller's identity and vault",
            wrong == [] and all(count == 40 for count in mine.values()),
            (wrong[:2], mine),
        )
        masked = (await ines.get("/api/holdings")).json()["items"]
        check(
            "the contact's answers stay masked and scoped under load",
            all(set(item) == {"id", "company", "data_kind", "level", "value", "affected"} for item in masked),
            masked[:1],
        )

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    for name in FAILED:
        print("  failed:", name)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
