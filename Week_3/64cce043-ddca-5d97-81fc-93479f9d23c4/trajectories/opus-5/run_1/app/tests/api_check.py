"""End-to-end API checks against a running server, seeded database and realm."""
from __future__ import annotations

import asyncio
import json
import sys

from signin import client, sign_in

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    (PASSED if condition else FAILED).append(name)
    print(("ok   " if condition else "FAIL ") + name + ("" if condition else f"  {detail}"))


async def main() -> int:
    async with client() as ada, client() as teodor, client() as ines, client() as outsider:
        landing = await ada.get("/vault")
        check(
            "signed-out /vault redirects with next",
            landing.status_code == 302 and landing.headers["location"] == "/?next=%2Fvault",
            landing.headers.get("location"),
        )
        api = await ada.get("/api/holdings")
        check(
            "signed-out api is signed_out",
            api.status_code == 401 and api.json()["error"]["code"] == "signed_out",
            api.text,
        )

        back = await sign_in(ada, "ada.marsh@example.com", "Strongroom-Owner-1", "%2Fvault%2Frules")
        check("sign-in returns to next", back.headers.get("location") in (None, "/vault/rules") or back.status_code == 200)

        me = (await ada.get("/api/me")).json()
        check("me is the owner", me == {"role": "owner", "name": "Ada Marsh", "email": "ada.marsh@example.com"}, me)

        exposure = (await ada.get("/api/exposure")).json()
        check("Ada's score is 48 Exposed", (exposure["score"], exposure["band"]) == (48, "Exposed"), exposure)
        texts = [(step["text"], step["points"], step["company"]) for step in exposure["steps"]]
        check(
            "step order matches the worked example",
            texts
            == [
                ("Report the passport to the issuing office as compromised", 20, "Brightway Air"),
                ("Apply for a replacement passport", 20, "Brightway Air"),
                ("Add a spoken passphrase to key accounts", 4, "Brightway Air"),
                ("Treat messages that quote your birth date with suspicion", 4, "Brightway Air"),
            ],
            texts,
        )

        holdings = (await ada.get("/api/holdings")).json()
        check("twelve holdings", holdings["total"] == 12, holdings["total"])
        first = holdings["items"][0]
        check(
            "ledger order starts at Brightway Air passport",
            (first["company"], first["data_kind"], first["level"], first["affected"])
            == ("Brightway Air", "passport", "critical", True),
            first,
        )
        check(
            "owner holding keys",
            set(first) == {"id", "company", "data_kind", "value", "notes", "level", "rule_id",
                           "affected", "version", "created_at", "updated_at"},
            sorted(first),
        )
        clinic = next(h for h in holdings["items"] if h["company"] == "Larchfield Clinic")
        check("clinic rule grades phone Critical", clinic["level"] == "critical", clinic)
        check(
            "facets count by company",
            holdings["facets"]["company"]
            == {"Brightway Air": 3, "Copperleaf Bank": 3, "Larchfield Clinic": 2,
                "Parcelwise": 2, "Tally Rent": 2},
            holdings["facets"]["company"],
        )

        parcel = (await ada.get("/api/holdings?q=parcel")).json()
        check("search parcel shows 2", parcel["total"] == 2, parcel["total"])
        cop = (await ada.get("/api/holdings?q=cop")).json()
        check(
            "search cop shows the 3 Copperleaf rows",
            cop["total"] == 3 and {item["company"] for item in cop["items"]} == {"Copperleaf Bank"},
            cop["total"],
        )
        check("search keeps whole-vault exposure", cop["exposure"]["score"] == 48, cop["exposure"])
        bad = await ada.get("/api/holdings?level=nope")
        check(
            "unknown level is a field error",
            bad.status_code == 422
            and bad.json()["error"]["fields"] == {"level": "Choose a level from the list."},
            bad.text,
        )
        long_q = await ada.get("/api/holdings?q=" + "x" * 101)
        check("q over 100 characters is 422", long_q.status_code == 422, long_q.status_code)

        preview = await ada.post(
            "/api/breaches/preview",
            json={"company": "Copperleaf Bank", "data_kinds": ["bank_account"]},
        )
        check("Copperleaf bank-account preview is 68", preview.json()["score"] == 68, preview.json())
        preview2 = await ada.post(
            "/api/breaches/preview",
            json={"company": "copperleaf  bank", "data_kinds": ["bank_account", "payment_card"]},
        )
        check("with payment card the preview is 88", preview2.json()["score"] == 88, preview2.json())
        check(
            "preview reports the current score",
            preview2.json()["current_score"] == 48,
            preview2.json(),
        )

        rules = (await ada.get("/api/rules")).json()["rules"]
        check("thirteen rules in order", len(rules) == 13, len(rules))
        check(
            "first rule is the clinic rule",
            (rules[0]["priority"], rules[0]["label"]) == (1, "Any kind at clinic is Critical"),
            rules[0],
        )
        check(
            "rule keys",
            set(rules[0]) == {"id", "priority", "data_kind", "company_contains", "level",
                              "label", "version"},
            sorted(rules[0]),
        )

        order = [rule["id"] for rule in rules]
        moved = [order[1], order[0], *order[2:]]
        rule_preview = (await ada.post("/api/rules/preview", json={"rule_ids": moved})).json()
        saved = await ada.put("/api/rules/order", json={"rule_ids": moved})
        after = (await ada.get("/api/holdings")).json()
        check(
            "rule preview equals the saved grading",
            rule_preview["score"] == saved.json()["exposure"]["score"]
            and {entry["holding_id"]: entry["level"] for entry in rule_preview["levels"]}
            == {item["id"]: item["level"] for item in after["items"]},
            (rule_preview["score"], saved.json()["exposure"]["score"]),
        )
        await ada.put("/api/rules/order", json={"rule_ids": order})
        short = await ada.put("/api/rules/order", json={"rule_ids": order[:-1]})
        check(
            "an incomplete order is 422 rule_ids",
            short.status_code == 422
            and short.json()["error"]["fields"] == {"rule_ids": "List every rule exactly once."},
            short.text,
        )
        unknown_rule = await ada.post("/api/rules/preview", json={"rule_ids": [*order, "nope"]})
        check("an unknown rule id previews 422", unknown_rule.status_code == 422, unknown_rule.status_code)

        created = await ada.post(
            "/api/holdings",
            json={"company": "  Larchfield   Clinic ", "data_kind": "date_of_birth",
                  "value": "1986-03-14", "notes": ""},
        )
        check("adding a holding answers 201", created.status_code == 201, created.text)
        clinic_dob = created.json()["holding"]
        check("the clinic rule grades it Critical", clinic_dob["level"] == "critical", clinic_dob)
        check("company whitespace is collapsed", clinic_dob["company"] == "Larchfield Clinic", clinic_dob)
        duplicate = await ada.post(
            "/api/holdings",
            json={"company": "larchfield clinic", "data_kind": "date_of_birth", "value": "x"},
        )
        check(
            "the same company and kind is 409 holding_exists",
            duplicate.status_code == 409
            and duplicate.json()["error"]["code"] == "holding_exists",
            duplicate.text,
        )
        unsettable = await ada.post(
            "/api/holdings",
            json={"company": "X", "data_kind": "passport", "value": "y", "level": "low"},
        )
        check(
            "a client-set level is refused",
            unsettable.status_code == 422
            and unsettable.json()["error"]["fields"] == {"level": "This field cannot be set."},
            unsettable.text,
        )

        logged = await ada.post(
            "/api/breaches",
            json={"company": "Larchfield Clinic", "announced_on": "2026-10-21",
                  "data_kinds": ["date_of_birth"]},
            headers={"Idempotency-Key": "check-1"},
        )
        check("logging a breach answers 201", logged.status_code == 201, logged.text)
        check("the Larchfield example scores 84", logged.json()["exposure"]["score"] == 84, logged.json()["exposure"])
        steps = [(step["text"], step["points"]) for step in logged.json()["exposure"]["steps"]]
        check(
            "the passphrase step rises to Critical and stays single",
            steps
            == [
                ("Report the passport to the issuing office as compromised", 20),
                ("Apply for a replacement passport", 20),
                ("Add a spoken passphrase to key accounts", 20),
                ("Treat messages that quote your birth date with suspicion", 20),
                ("Treat messages that quote your birth date with suspicion", 4),
            ],
            steps,
        )
        replay = await ada.post(
            "/api/breaches",
            json={"company": "Larchfield Clinic", "announced_on": "2026-10-21",
                  "data_kinds": ["date_of_birth"]},
            headers={"Idempotency-Key": "check-1"},
        )
        check(
            "a replayed Idempotency-Key returns the stored 201",
            replay.status_code == 201 and replay.json() == logged.json(),
            replay.status_code,
        )
        conflict = await ada.post(
            "/api/breaches",
            json={"company": "Larchfield Clinic", "announced_on": "2026-10-22",
                  "data_kinds": ["date_of_birth"]},
            headers={"Idempotency-Key": "check-1"},
        )
        check(
            "the same key with another body is 409",
            conflict.status_code == 409
            and conflict.json()["error"]["code"] == "idempotency_conflict",
            conflict.text,
        )
        future = await ada.post(
            "/api/breaches",
            json={"company": "X", "announced_on": "2099-01-01", "data_kinds": ["passport"]},
        )
        check(
            "a future date is refused",
            future.status_code == 422
            and future.json()["error"]["fields"] == {"announced_on": "Date cannot be in the future."},
            future.text,
        )
        repeated = await ada.post(
            "/api/breaches",
            json={"company": "X", "announced_on": "2026-10-01",
                  "data_kinds": ["passport", "passport"]},
        )
        check(
            "a repeated kind is refused",
            repeated.json()["error"]["fields"] == {"data_kinds": "Each data kind can appear once."},
            repeated.text,
        )

        gone = await ada.delete(f"/api/holdings/{clinic_dob['id']}")
        check("deleting the holding answers 204", gone.status_code == 204, gone.status_code)
        after_delete = (await ada.get("/api/exposure")).json()
        check("deleting it returns the score to 48", after_delete["score"] == 48, after_delete["score"])
        replayed_delete = await ada.delete(f"/api/holdings/{clinic_dob['id']}")
        check("a replayed delete is 404", replayed_delete.status_code == 404, replayed_delete.status_code)

        # steps and their order within a holding
        exposure = (await ada.get("/api/exposure")).json()
        passport_steps = [s for s in exposure["steps"] if s["data_kind"] == "passport"]
        second = await ada.post(f"/api/steps/{passport_steps[1]['id']}/done")
        check(
            "step 2 before step 1 is step_out_of_order",
            second.status_code == 409
            and second.json()["error"]["code"] == "step_out_of_order",
            second.text,
        )
        first_done = await ada.post(f"/api/steps/{passport_steps[0]['id']}/done")
        check(
            "marking step 1 done lowers the score by its points",
            first_done.json()["exposure"]["score"] == 28,
            first_done.json()["exposure"]["score"],
        )
        again = await ada.post(f"/api/steps/{passport_steps[0]['id']}/done")
        check("done twice is step_already_done", again.status_code == 409 and again.json()["error"]["code"] == "step_already_done", again.text)
        await ada.post(f"/api/steps/{passport_steps[1]['id']}/done")
        cascade = await ada.post(f"/api/steps/{passport_steps[0]['id']}/reopen")
        reopened = {s["id"]: s["status"] for s in cascade.json()["exposure"]["steps"]}
        check(
            "reopening step 1 reopens step 2",
            reopened[passport_steps[0]["id"]] == "open"
            and reopened[passport_steps[1]["id"]] == "open",
            reopened,
        )
        check("the score is back to 48", cascade.json()["exposure"]["score"] == 48, cascade.json()["exposure"]["score"])

        # outsider isolation
        await sign_in(teodor, "teodor.vance@example.com", "Strongroom-Owner-2")
        teodor_exposure = (await teodor.get("/api/exposure")).json()
        check("Teodor's score is 2 Contained", (teodor_exposure["score"], teodor_exposure["band"]) == (2, "Contained"), teodor_exposure)
        foreign = await teodor.get(f"/api/holdings/{first['id']}")
        check(
            "another vault's id is 404",
            foreign.status_code == 404 and foreign.json()["error"]["code"] == "not_found",
            foreign.text,
        )
        foreign_page = await teodor.get(f"/vault/holdings/{first['id']}")
        check("its screen renders the not-found page", foreign_page.status_code == 404, foreign_page.status_code)

        # the trusted contact
        await sign_in(ines, "ines.marsh@example.com", "Strongroom-Contact-1")
        ines_me = (await ines.get("/api/me")).json()
        check("Ines signs in as the contact", ines_me["role"] == "contact", ines_me)
        shared = (await ines.get("/api/holdings")).json()
        check("the contact sees every level", shared["total"] == 12, shared["total"])
        passport = next(item for item in shared["items"] if item["data_kind"] == "passport")
        check(
            "contact holding keys",
            set(passport) == {"id", "company", "data_kind", "level", "value", "affected"},
            sorted(passport),
        )
        check("the passport value is masked", passport["value"] == "* **** *471 8", passport["value"])
        card = next(item for item in shared["items"] if item["data_kind"] == "payment_card")
        check("the card value is masked", card["value"] == "**** **** **** 6604", card["value"])
        address = next(item for item in shared["items"] if item["data_kind"] == "home_address")
        check("a Moderate value shows in full", address["value"] == "14 Wren Row, Aldmoor", address["value"])
        contact_rules = await ines.get("/api/rules")
        check("the contact cannot read rules", contact_rules.status_code == 403 and contact_rules.json()["error"]["code"] == "owner_only", contact_rules.text)
        contact_write = await ines.post("/api/holdings", json={"company": "X", "data_kind": "passport", "value": "y"})
        check("the contact cannot write", contact_write.status_code == 403, contact_write.status_code)
        contact_step = await ines.post(f"/api/steps/{passport_steps[0]['id']}/done")
        check("a step in scope is owner_only for the contact", contact_step.status_code == 403, contact_step.status_code)
        contact_grant = (await ines.get("/api/contact/grant")).json()
        check(
            "contact-grant keys",
            set(contact_grant) == {"status", "ends_at", "remaining_seconds", "levels", "owner_name"},
            sorted(contact_grant),
        )
        check("the owner's name reaches the contact", contact_grant["owner_name"] == "Ada Marsh", contact_grant)
        owner_contact_grant = await ada.get("/api/contact/grant")
        check("owners get 404 there", owner_contact_grant.status_code == 404, owner_contact_grant.status_code)

        narrow = await ada.patch("/api/grant", json={"levels": ["moderate", "low"]})
        check("narrowing answers 200", narrow.status_code == 200, narrow.text)
        narrowed = (await ines.get("/api/holdings")).json()
        check(
            "the contact loses the removed levels",
            narrowed["total"] == 6
            and {item["level"] for item in narrowed["items"]} == {"moderate", "low"},
            narrowed["total"],
        )
        hidden = await ines.get(f"/api/holdings/{passport['id']}")
        check("an out-of-scope id is 404", hidden.status_code == 404, hidden.status_code)
        widen = await ada.patch("/api/grant", json={"levels": ["critical", "high", "moderate", "low"]})
        check(
            "widening is refused",
            widen.status_code == 422
            and widen.json()["error"]["fields"]["levels"].startswith("Scope can only be narrowed"),
            widen.text,
        )
        grant_again = await ada.post(
            "/api/grant",
            json={"contact_name": "Ines Marsh", "contact_email": "ines.marsh@example.com",
                  "duration": "24h", "levels": ["critical", "low"]},
        )
        check(
            "a second grant while one is active is 409",
            grant_again.status_code == 409
            and grant_again.json()["error"]["code"] == "grant_active",
            grant_again.text,
        )
        revoked = await ada.delete("/api/grant")
        check(
            "revoking answers 200 revoked",
            revoked.status_code == 200 and revoked.json()["grant"]["status"] == "revoked",
            revoked.text,
        )
        after_revoke = await ines.get("/api/holdings")
        check("the contact's session is gone", after_revoke.status_code == 401, after_revoke.status_code)
        revoke_again = await ada.delete("/api/grant")
        check(
            "revoking twice is no_active_grant",
            revoke_again.status_code == 409
            and revoke_again.json()["error"]["code"] == "no_active_grant",
            revoke_again.text,
        )

        # boundary
        too_big = await ada.post(
            "/api/holdings",
            content=json.dumps({"company": "x" * 70000}),
            headers={"content-type": "application/json"},
        )
        check("a body over 64 KiB is 413", too_big.status_code == 413, too_big.status_code)
        wrong_type = await ada.post(
            "/api/holdings", content="company=x", headers={"content-type": "text/plain"}
        )
        check("a non-JSON content type is 415", wrong_type.status_code == 415, wrong_type.status_code)
        foreign_origin = await ada.post(
            "/api/holdings", json={"company": "x"}, headers={"origin": "http://evil.example"}
        )
        check(
            "a foreign origin is 403 cross_origin",
            foreign_origin.status_code == 403
            and foreign_origin.json()["error"]["code"] == "cross_origin",
            foreign_origin.text,
        )
        secrets = await outsider.get("/run.json")
        check("the manifest is never served", secrets.status_code == 404, secrets.status_code)
        source = await outsider.get("/app/web.py")
        check("source is never served", source.status_code == 404, source.status_code)
        unknown = await outsider.get("/api/nope")
        check("an unknown api path is 404 not_found", unknown.status_code == 404 and unknown.json()["error"]["code"] == "not_found", unknown.text)

    print()
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    for name in FAILED:
        print("  failed:", name)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
