"""Concurrency test (DP-06): simultaneous hold requests that share a cell —
exactly one wins, the rest answer slot_taken. Also concurrent cancels and
concurrent confirms."""
import asyncio
import json
import urllib.request
import http.cookiejar

BASE = "http://127.0.0.1:4173"
PASSWORD = "prep-shift-2026"


class Api:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(req) as res:
                text = res.read().decode()
                return res.status, json.loads(text) if text else None
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                return err.code, json.loads(text)
            except json.JSONDecodeError:
                return err.code, None

    def sign_in(self, email):
        return self.request("POST", "/api/session", {"email": email, "password": PASSWORD})


async def post_async(loop, api, path, body):
    return await loop.run_in_executor(None, lambda: api.request("POST", path, body))


async def main():
    rosa = Api()
    rosa.sign_in("rosa@tamalcart.test")
    owen = Api()
    owen.sign_in("owen@crumbco.test")

    # Release leftover live holds from earlier runs so the test is repeatable.
    for api in (rosa, owen):
        kitchen = api.request("GET", "/api/kitchen")[1]
        today = kitchen["today"]
        from datetime import date, timedelta

        tomorrow = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
        for d in (today, tomorrow):
            board = api.request("GET", f"/api/board?date={d}")[1]
            for station in board["stations"]:
                for seg in station["segments"]:
                    if seg["kind"] == "hold" and seg["status"] == "live":
                        api.request("DELETE", f"/api/holds/{seg['id']}")

    loop = asyncio.get_event_loop()
    kitchen = rosa.request("GET", "/api/kitchen")[1]
    today = kitchen["today"]

    # Two members paint Deck Oven from 05:00 at the same moment, on tomorrow
    # (today's 05:00 is in the past).
    kitchen = rosa.request("GET", "/api/kitchen")[1]
    today = kitchen["today"]
    from datetime import date, timedelta

    tomorrow = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
    hold_body = lambda: {"station_id": "oven-2", "date": tomorrow, "start": "05:00", "end": "07:00"}
    (s1, r1), (s2, r2) = await asyncio.gather(
        post_async(loop, rosa, "/api/holds", hold_body()),
        post_async(loop, owen, "/api/holds", hold_body()),
    )
    statuses = sorted([s1, s2])
    print("hold statuses:", statuses)
    assert statuses == [201, 409], f"exactly one hold wins: {statuses}"
    winner, loser = (r1, r2) if s1 == 201 else (r2, r1)
    assert loser["error"] == "slot_taken"
    hold_id = winner["hold"]["id"]
    print("one winner per cell OK; loser got slot_taken")

    # Confirm the winner's hold; then two concurrent cancels by the owner —
    # exactly one wins.
    s, confirmed = await post_async(loop, rosa, f"/api/holds/{hold_id}/confirm", {})
    assert s == 201, confirmed
    booking_id = confirmed["booking"]["id"]

    rosa2 = Api()
    rosa2.sign_in("rosa@tamalcart.test")
    c1, c2 = await asyncio.gather(
        post_async(loop, rosa, f"/api/bookings/{booking_id}/cancel", {}),
        post_async(loop, rosa2, f"/api/bookings/{booking_id}/cancel", {}),
    )
    statuses = sorted([c1[0], c2[0]])
    print("cancel statuses:", statuses)
    ok = [x for x in (c1, c2) if x[0] == 200]
    lost = [x for x in (c1, c2) if x[0] != 200]
    assert len(ok) == 1 and len(lost) == 1 and lost[0][1]["error"] == "invalid_transition", statuses
    print("concurrent cancellation: exactly one wins OK")

    # A second confirm of the same hold answers invalid_transition.
    s, r = rosa.request("POST", f"/api/holds/{hold_id}/confirm", {})
    assert s == 409 and r["error"] == "invalid_transition", (s, r)
    print("second confirm answers invalid_transition OK")

    # After cancellation the cells are free for a new hold.
    s, r = owen.request("POST", "/api/holds", hold_body())
    assert s == 201, (s, r)
    print("cancelled cells are free again OK")

    # Two concurrent holds sharing only a cleaning tail cell.
    body_a = {"station_id": "kettle-1", "date": today, "start": "13:00", "end": "14:00"}
    body_b = {"station_id": "kettle-1", "date": today, "start": "14:45", "end": "16:00"}
    # a's tail runs to 14:45; b starts at 14:45 — cells 13:00..14:45 inclusive of tail:
    # a covers 13:00-15:00? tail 45min: a end 14:00, tail until 14:45. b 14:45-16:00 + tail.
    # They share no cell: a tail ends AT 14:45 (exclusive), b starts 14:45. Both should win.
    (s1, r1), (s2, r2) = await asyncio.gather(
        post_async(loop, rosa, "/api/holds", body_a),
        post_async(loop, owen, "/api/holds", body_b),
    )
    print("tail-adjacent holds:", s1, s2)
    assert s1 == 201 and s2 == 201, (s1, s2)
    print("adjacent-but-not-overlapping holds both place OK")

    # A clash through the tail: a ends 14:00 with tail to 14:45; c starts 14:30.
    body_c = {"station_id": "kettle-1", "date": today, "start": "14:30", "end": "15:30"}
    s3, r3 = owen.request("POST", "/api/holds", body_c)
    print("tail clash:", s3, r3 if s3 != 201 else "")
    assert s3 == 409 and r3["error"] == "slot_taken"
    print("cleaning tail counts in collisions OK")

    print("ALL CONCURRENCY CHECKS PASSED")


asyncio.run(main())
