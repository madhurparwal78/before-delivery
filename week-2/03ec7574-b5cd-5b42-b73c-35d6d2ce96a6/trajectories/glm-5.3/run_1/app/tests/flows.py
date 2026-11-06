"""Second-pass flow tests: expiry, roles, removal, races, quorum snapshot, cursors."""
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import concurrent.futures

from smoke import call, check, login, BASE, PW, APP_NW, APP_ACME


def login_pw(email, password):
    s, b, _ = call("POST", "/api/v1/auth/login", {"email": email, "password": password})
    check(f"login {email}", s == 200, b.get("error"))
    return b["data"]["token"]


def main():
    owner_tok, _, _ = login("nw.owner@example.com")
    op_tok, operator, _ = login("nw.operator@example.com")
    ada_tok, ada, _ = login("nw.approver1@example.com")
    ben_tok, ben, _ = login("nw.approver2@example.com")
    aud_tok, _, _ = login("nw.auditor@example.com")

    # --- a wallet and short-expiry quorum for the expiry test
    s, b, _ = call("POST", "/api/v1/quorums",
                   {"name": "Short quorum 2", "member_ids": [ben["id"], ada["id"]], "authorization_threshold": 1,
                    "expiry_seconds": 60}, token=owner_tok, app=APP_NW)
    check("short quorum", s == 201, b.get("error"))
    short_q = b["data"]["id"]
    s, b, _ = call("POST", "/api/v1/wallets",
                   {"name": "Expiry test 2", "chain": "base", "asset": "usdc", "quorum_id": short_q,
                    "approval_floor": "1"}, token=owner_tok, app=APP_NW)
    check("expiry wallet", s == 201, b.get("error"))
    exp_wallet = b["data"]["id"]
    s, b, _ = call("POST", f"/api/v1/wallets/{exp_wallet}/deposits",
                   {"amount": "100", "reference": "expiry-dep"}, token=op_tok, app=APP_NW)
    check("expiry deposit", s == 201, b.get("error"))

    # quorum threshold validation
    s, b, _ = call("POST", "/api/v1/quorums",
                   {"name": "Bad", "member_ids": [ben["id"]], "authorization_threshold": 2, "expiry_seconds": 60},
                   token=owner_tok, app=APP_NW)
    check("threshold beyond count", s == 422 and b["error"]["code"] == "INVALID_THRESHOLD", b)
    s, b, _ = call("POST", "/api/v1/quorums",
                   {"name": "Bad", "member_ids": [operator["id"]], "authorization_threshold": 1, "expiry_seconds": 60},
                   token=owner_tok, app=APP_NW)
    check("operator in quorum", s == 422 and b["error"]["code"] == "INVALID_QUORUM_MEMBER", b)

    s, b, _ = call("POST", f"/api/v1/wallets/{exp_wallet}/transfers",
                   {"destination_address": "0x1111111111111111111111111111111111111111", "amount": "50"},
                   token=op_tok, app=APP_NW)
    check("expiry transfer pending", b.get("data", {}).get("status") == "pending_approval", b.get("error"))
    exp_intent = b["data"]["id"]
    expires_at = b["data"]["expires_at"]
    check("expiry about a minute", expires_at is not None)

    # --- quorum snapshot: edit the quorum while the intent waits
    s, b, _ = call("PATCH", f"/api/v1/quorums/{short_q}",
                   {"member_ids": ["mem_nw_owner"], "authorization_threshold": 1},
                   token=owner_tok, app=APP_NW)
    check("quorum edit", s == 200, b.get("error"))
    s, b, _ = call("GET", f"/api/v1/intents/{exp_intent}", token=aud_tok, app=APP_NW)
    check("snapshot members kept", set(b["data"]["quorum_member_ids"]) == {"mem_nw_approver1", "mem_nw_approver2"}, b["data"]["quorum_member_ids"])
    check("snapshot threshold kept", b["data"]["required_approvals"] == 1)

    # --- approvals race: approve vs reject on one intent -> one winner
    s, b, _ = call("PATCH", f"/api/v1/quorums/{short_q}",
                   {"member_ids": [ben["id"], ada["id"]], "authorization_threshold": 1},
                   token=owner_tok, app=APP_NW)
    check("quorum restored", s == 200, b.get("error"))
    s, b, _ = call("POST", f"/api/v1/wallets/{exp_wallet}/transfers",
                   {"destination_address": "0x2222222222222222222222222222222222222222", "amount": "5"},
                   token=op_tok, app=APP_NW)
    race_intent = b["data"]["id"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        f1 = ex.submit(call, "POST", f"/api/v1/intents/{race_intent}/approve", {}, ada_tok, APP_NW)
        f2 = ex.submit(call, "POST", f"/api/v1/intents/{race_intent}/reject", {"reason": "no"}, ben_tok, APP_NW)
        r1, r2 = f1.result(), f2.result()
    codes = sorted([r1[0], r2[0]])
    check("approve/reject race one winner", codes == [200, 409], f"{r1[0]} {r2[0]}")
    s, b, _ = call("GET", f"/api/v1/intents/{race_intent}", token=aud_tok, app=APP_NW)
    final_status = b["data"]["status"]
    check("race single outcome", final_status in ("executed", "rejected"), final_status)

    # --- cancel: creator cancels own pending intent
    s, b, _ = call("POST", f"/api/v1/wallets/{exp_wallet}/transfers",
                   {"destination_address": "0x3333333333333333333333333333333333333333", "amount": "6"},
                   token=op_tok, app=APP_NW)
    cancel_intent = b["data"]["id"]
    s, b, _ = call("POST", f"/api/v1/intents/{cancel_intent}/cancel", {}, token=op_tok, app=APP_NW)
    check("creator cancels", s == 200 and b["data"]["status"] == "cancelled", b.get("error"))
    # non-creator operator refused
    s, b, _ = call("POST", f"/api/v1/intents/{exp_intent}/cancel", {}, token=ada_tok, app=APP_NW)
    check("approver cannot cancel", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)
    # owner cancels someone else's
    s, b, _ = call("POST", f"/api/v1/intents/{exp_intent}/cancel", {}, token=owner_tok, app=APP_NW)
    check("owner cancels", s == 200 and b["data"]["status"] == "cancelled", b.get("error"))
    # cancellation releases the reservation
    s, b, _ = call("GET", f"/api/v1/wallets/{exp_wallet}", token=aud_tok, app=APP_NW)
    check("reservation released", b["data"]["reserved"] == "0", b["data"]["reserved"])

    # --- cursor bound to filters
    s, b, _ = call("GET", "/api/v1/intents?limit=1&status=executed", token=aud_tok, app=APP_NW)
    cursor = b["data"]["next_cursor"]
    check("cursor issued", cursor is not None)
    s, b, _ = call("GET", f"/api/v1/intents?limit=1&status=rejected&cursor={urllib.parse.quote(cursor)}",
                   token=aud_tok, app=APP_NW)
    check("cursor different filter", s == 422 and b["error"]["code"] == "INVALID_CURSOR", b)
    s, b, _ = call("GET", f"/api/v1/intents?limit=1&cursor={urllib.parse.quote(cursor + 'x')}", token=aud_tok, app=APP_NW)
    check("cursor altered", s == 422 and b["error"]["code"] == "INVALID_CURSOR", b)
    s, b, _ = call("GET", f"/api/v1/intents?limit=1&status=executed&cursor={urllib.parse.quote(cursor)}",
                   token=aud_tok, app=APP_NW)
    check("cursor same filter ok", s == 200, b.get("error"))

    # --- destination-grouped aggregation
    s, b, _ = call("POST", "/api/v1/aggregations",
                   {"name": "Vendor 2222 count", "metric": "count", "window_seconds": 86400,
                    "asset": "usdc", "group_by": "destination"}, token=owner_tok, app=APP_NW)
    check("aggregation created", s == 201, b.get("error"))
    dest_agg = b["data"]["id"]
    s, b, _ = call("GET", "/api/v1/aggregations", token=aud_tok, app=APP_NW)
    check("aggregations list", s == 200 and any(a["id"] == dest_agg for a in b["data"]["aggregations"]), None)
    # use it in a policy
    s, b, _ = call("POST", "/api/v1/policies",
                   {"version": "1.0", "name": "Vendor count cap", "chain_type": "ethereum", "rules": [
                       {"name": "Count to 2222", "method": "transfer", "action": "ALLOW", "conditions": [
                           {"field_source": "request_body", "field": "destination.address", "operator": "eq",
                            "value": "0x2222222222222222222222222222222222222222"},
                           {"field_source": "reference", "field": f"aggregation.{dest_agg}", "operator": "lte", "value": 3},
                       ]}]}, token=owner_tok, app=APP_NW)
    check("policy with count agg", s == 201, b.get("error"))
    # evaluate it: transfers to 2222 from wal_operating so far
    s, b, _ = call("POST", f"/api/v1/policies/{b['data']['id']}/evaluate",
                   {"method": "transfer", "wallet_id": "wal_operating",
                    "destination_address": "0x2222222222222222222222222222222222222222", "amount": "1"},
                   token=aud_tok, app=APP_NW)
    check("count aggregation value", s == 200 and b["data"]["aggregations"][dest_agg] is not None, b.get("error"))
    check("count allows under 3", b["data"]["action"] == "ALLOW", b["data"])

    # --- members: add, role change applies next request, removal kills sessions and keys
    s, b, _ = call("POST", "/api/v1/members",
                   {"name": "Priya Chen", "email": "priya.chen@example.com", "role": "operator", "password": "a-very-long-pw-123"},
                   token=owner_tok, app=APP_NW)
    check("member added", s == 201 and b["data"]["role"] == "operator", b.get("error"))
    priya_id = b["data"]["id"]
    priya_tok = login_pw("priya.chen@example.com", "a-very-long-pw-123")
    s, b, _ = call("GET", "/api/v1/wallets", token=priya_tok, app=APP_NW)
    check("priya reads", s == 200)
    # duplicate email across organizations
    s, b, _ = call("POST", "/api/v1/members",
                   {"name": "Dup", "email": "priya.chen@example.com", "role": "operator", "password": "a-very-long-pw-123"},
                   token=owner_tok, app=APP_NW)
    check("duplicate member", s == 409 and b["error"]["code"] == "MEMBER_EXISTS", b)
    # role change applies on next request
    s, b, _ = call("PATCH", f"/api/v1/members/{priya_id}", {"role": "auditor"}, token=owner_tok, app=APP_NW)
    check("member updated", s == 200 and b["data"]["role"] == "auditor", b.get("error"))
    s, b, _ = call("GET", "/api/v1/audit", token=priya_tok, app=APP_NW)
    check("fresh role auditor reads audit", s == 200, b.get("error"))
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/deposits",
                   {"amount": "1", "reference": "priya-dep"}, token=priya_tok, app=APP_NW)
    check("fresh role blocks operator action", s == 403 and b["error"]["code"] == "FORBIDDEN_ROLE", b)

    # an owner who creates keys, then is removed: keys revoked, sessions killed
    s, b, _ = call("POST", "/api/v1/members",
                   {"name": "Quinn Ford", "email": "quinn.ford@example.com", "role": "owner", "password": "a-very-long-pw-456"},
                   token=owner_tok, app=APP_NW)
    check("second owner added", s == 201, b.get("error"))
    quinn_id = b["data"]["id"]
    quinn_tok = login_pw("quinn.ford@example.com", "a-very-long-pw-456")
    s, b, _ = call("POST", "/api/v1/api-keys", {"name": "Quinn key", "role": "auditor"}, token=quinn_tok, app=APP_NW)
    check("quinn key", s == 201, b.get("error"))
    quinn_key = b["data"]["secret"]
    quinn_key_id = b["data"]["id"]
    s, b, _ = call("GET", "/api/v1/wallets", token=quinn_key, app=APP_NW)
    check("quinn key reads", s == 200)
    s, b, _ = call("DELETE", f"/api/v1/members/{quinn_id}", token=owner_tok, app=APP_NW)
    check("quinn removed", s == 200 and b["data"]["removed"] is True, b.get("error"))
    s, b, _ = call("GET", "/api/v1/wallets", token=quinn_tok, app=APP_NW)
    check("quinn session dead", s == 401 and b["error"]["code"] == "INVALID_CREDENTIAL", b)
    s, b, _ = call("GET", "/api/v1/wallets", token=quinn_key, app=APP_NW)
    check("quinn key revoked by removal", s == 401 and b["error"]["code"] == "INVALID_CREDENTIAL", b)
    s, b, _ = call("POST", "/api/v1/auth/login", {"email": "quinn.ford@example.com", "password": "a-very-long-pw-456"})
    check("removed member cannot log in", s == 401 and b["error"]["code"] == "BAD_CREDENTIALS", b)
    # removal events: api_key.revoked then member.removed, in order
    s, b, _ = call("GET", "/api/v1/audit?limit=500", token=owner_tok, app=APP_NW)
    events = [e for e in b["data"]["events"] if e["type"] in ("api_key.revoked", "member.removed")]
    revoked_ix = [i for i, e in enumerate(events) if e["subject_id"] == quinn_key_id]
    removed_ix = [i for i, e in enumerate(events) if e["type"] == "member.removed" and e["data"].get("member_id") == quinn_id]
    check("key revoked before member removed", revoked_ix and removed_ix and revoked_ix[0] < removed_ix[0], events[-3:])

    # last owner protection
    s, b, _ = call("DELETE", "/api/v1/members/mem_nw_owner", token=owner_tok, app=APP_NW)
    check("last owner in quorum checked first", s == 409 and b["error"]["code"] == "MEMBER_IN_QUORUM", b)


    # --- PATCH wallet: null detaches policy and quorum
    s, b, _ = call("POST", "/api/v1/wallets",
                   {"name": "Detach test", "chain": "base", "asset": "usdc",
                    "policy_id": "pol_operating", "quorum_id": short_q, "approval_floor": "1"},
                   token=owner_tok, app=APP_NW)
    check("detach wallet created", s == 201, b.get("error"))
    detach_id = b["data"]["id"]
    s, b, _ = call("PATCH", f"/api/v1/wallets/{detach_id}",
                   {"policy_id": None, "quorum_id": None}, token=owner_tok, app=APP_NW)
    check("detach policy and quorum", s == 200 and b["data"]["policy_id"] is None and b["data"]["quorum_id"] is None, b.get("error"))

    # --- evaluate with batch_payout method
    s, b, _ = call("POST", "/api/v1/policies/pol_operating/evaluate",
                   {"method": "batch_payout", "wallet_id": "wal_operating",
                    "destination_address": "0x4444444444444444444444444444444444444444", "amount": "4800"},
                   token=aud_tok, app=APP_NW)
    check("evaluate batch_payout allow", s == 200 and b["data"]["action"] == "ALLOW"
          and b["data"]["rule"] == "Payroll lines under 5000", b.get("error"))
    s, b, _ = call("POST", "/api/v1/policies/pol_operating/evaluate",
                   {"method": "batch_payout", "wallet_id": "wal_operating",
                    "destination_address": "0x4444444444444444444444444444444444444444", "amount": "5001"},
                   token=aud_tok, app=APP_NW)
    check("evaluate batch over cap denies", b.get("data", {}).get("action") == "DENY", b.get("error"))

    # --- batch line errors carry the index
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": [
                       {"destination_address": "0x4444444444444444444444444444444444444444", "amount": "1", "memo": ""},
                       {"destination_address": "0x4444444444444444444444444444444444444444", "amount": "0", "memo": ""},
                   ]}, token=op_tok, app=APP_NW)
    check("batch line index on zero amount", s == 422 and b["error"]["details"].get("index") == 1
          and b["error"]["details"].get("field") == "items.1.amount", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": [{"destination_address": "0x3333", "amount": "1", "memo": ""}]},
                   token=op_tok, app=APP_NW)
    check("batch line bad address", s == 422 and b["error"]["details"].get("field") == "items.0.destination_address", b)
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": []}, token=op_tok, app=APP_NW)
    check("batch empty items", s == 422 and b["error"]["details"].get("field") == "items", b)
    s, b, _ = call("GET", "/api/v1/wallets/wal_gas", token=op_tok, app=APP_NW)
    gas_addr = b["data"]["address"]
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": [
                       {"destination_address": "0x4444444444444444444444444444444444444444", "amount": "1", "memo": ""},
                       {"destination_address": gas_addr, "amount": "1", "memo": ""},
                   ]}, token=op_tok, app=APP_NW)
    check("batch asset mismatch index", s == 422 and b["error"]["code"] == "ASSET_MISMATCH"
          and b["error"]["details"].get("index") == 1, b)
    # unknown nested field in a batch line
    s, b, _ = call("POST", "/api/v1/wallets/wal_operating/batches",
                   {"items": [{"destination_address": "0x4444444444444444444444444444444444444444", "amount": "1", "extra": 1}]},
                   token=op_tok, app=APP_NW)
    check("batch unknown nested field", s == 422 and b["error"]["code"] == "UNKNOWN_FIELD"
          and b["error"]["details"].get("field") == "items.0.extra", b)

    # --- expiry: wait for the sweep (min expiry is 60 seconds)
    s, b, _ = call("POST", f"/api/v1/wallets/{exp_wallet}/transfers",
                   {"destination_address": "0x1111111111111111111111111111111111111111", "amount": "7"},
                   token=op_tok, app=APP_NW)
    wait_intent = b["data"]["id"]
    deadline = time.time() + 95
    status = None
    while time.time() < deadline:
        s, b, _ = call("GET", f"/api/v1/intents/{wait_intent}", token=aud_tok, app=APP_NW)
        status = b["data"]["status"]
        if status != "pending_approval":
            break
        time.sleep(4)
    check("intent expired", status == "expired", status)
    s, b, _ = call("GET", f"/api/v1/wallets/{exp_wallet}", token=aud_tok, app=APP_NW)
    check("expiry released reservation", b["data"]["reserved"] == "0", b["data"]["reserved"])
    # decisions on an expired intent refused
    s, b, _ = call("POST", f"/api/v1/intents/{wait_intent}/approve", {}, token=ada_tok, app=APP_NW)
    check("approve expired refused", s == 409 and b["error"]["code"] == "INTENT_NOT_PENDING", b)
    # exactly one intent.expired event
    s, b, _ = call("GET", "/api/v1/audit?limit=500", token=aud_tok, app=APP_NW)
    expired_events = [e for e in b["data"]["events"] if e["type"] == "intent.expired" and e["data"].get("intent_id") == wait_intent]
    check("exactly one expired event", len(expired_events) == 1, expired_events)
    s, b, _ = call("GET", "/api/v1/webhooks/events?limit=500", token=aud_tok, app=APP_NW)
    signed_expired = [e for e in b["data"]["events"] if e["type"] == "intent.expired" and wait_intent in e["body"]]
    check("exactly one expired signed event", len(signed_expired) == 1, len(signed_expired))

    import smoke
    print(f"\nflows PASS {smoke.PASS} FAIL {smoke.FAIL}")
    sys.exit(1 if smoke.FAIL else 0)


if __name__ == "__main__":
    main()
