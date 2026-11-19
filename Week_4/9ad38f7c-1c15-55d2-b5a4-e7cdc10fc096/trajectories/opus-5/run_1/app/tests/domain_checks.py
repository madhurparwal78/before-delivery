"""Team, flag, leaderboard, stream and certificate checks against a live instance."""

from __future__ import annotations

import hashlib
import json
import sys
import threading
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ElementTree
from concurrent.futures import ThreadPoolExecutor

from support import BASE, SEED_PASSWORD, call, check, login, report, signup

FLAGS = {
    "repossessed": "flag{nine_alerts_one_build}",
    "quiet-as-the-grave": "flag{hypothesis_held}",
    "deadmen-tell-no-logs": "flag{irregularities_logged}",
    "handbook-for-the-recently-compromised": "flag{timeline_rebuilt}",
    "the-waiting-room": "flag{payment_run_traced}",
    "day-o": "flag{payload_unpacked}",
    "strange-and-unusual-activity": "flag{dns_whispers}",
    "dead-endpoint": "flag{gallery_restored}",
}
WEBINAR_FLAG = "flag{comfort_zone_exit}"


def email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


def name(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:6]}"


def player(label: str) -> str:
    return signup(email(label), label.title())


def make_team(token: str, label: str = "crew") -> dict:
    answer = call("POST", "/api/teams", {"name": name(label)}, token=token)
    assert answer.status == 201, answer
    return answer.json["team"]


def join(token: str, code: str):
    return call("POST", "/api/teams/join", {"invite_code": code}, token=token)


def submit(token: str, slug: str, flag: str):
    return call("POST", f"/api/scenarios/{slug}/flag", {"flag": flag}, token=token)


def room(token: str):
    return call("GET", "/api/teams/mine", token=token)


# -- teams ---------------------------------------------------------------
def team_checks() -> None:
    captain = player("captain")
    chosen = f"Moth Crew {uuid.uuid4().hex[:4]}"
    answer = call("POST", "/api/teams", {"name": f"  {chosen}  "}, token=captain)
    check(
        "create team",
        answer.status == 201
        and set(answer.json["team"]) == {"id", "name", "invite_code", "captain_id"}
        and answer.json["team"]["name"] == chosen
        and len(answer.json["team"]["invite_code"]) == 8,
        answer,
    )
    team = answer.json["team"]

    check(
        "one team at a time",
        call("POST", "/api/teams", {"name": name("second")}, token=captain).json
        == {"error": "already_in_team"},
    )
    other = player("other")
    check(
        "name taken in any case",
        call("POST", "/api/teams", {"name": chosen.upper()}, token=other).json
        == {"error": "name_taken"},
    )
    for label, value in (
        ("too short", "ab"),
        ("too long", "x" * 25),
        ("bad character", "moth!crew"),
    ):
        answer = call("POST", "/api/teams", {"name": value}, token=other)
        check(
            f"team name {label}",
            answer.status == 400 and "name" in answer.json.get("fields", {}),
            answer,
        )
    for label, payload in (
        ("missing", {}),
        ("blank", {"name": "   "}),
        ("nul", {"name": "moth\u0000crew"}),
        ("not a string", {"name": 7}),
    ):
        answer = call("POST", "/api/teams", payload, token=other)
        check(f"team name {label}", answer.status == 400, answer)

    answer = join(other, team["invite_code"].lower())
    check("join with a lower-case code", answer.status == 200, answer)
    check(
        "join refuses a second team",
        join(other, "COLDLEDG").json == {"error": "already_in_team"},
    )
    stranger = player("stranger")
    check(
        "unknown invite code",
        join(stranger, "ZZZZZZZZ").json == {"error": "unknown_invite_code"},
    )
    answer = call("POST", "/api/teams/join", {"invite_code": "   "}, token=stranger)
    check(
        "blank invite code is a validation error",
        answer.status == 400 and answer.json["error"] == "validation",
        answer,
    )
    answer = call("POST", "/api/teams/join", {}, token=stranger)
    check("missing invite code", answer.status == 400, answer)
    check(
        "a full team refuses the next join",
        join(stranger, "GREYSTAT").json == {"error": "team_full"},
    )

    answer = room(captain)
    body = answer.json
    check(
        "team room shape",
        answer.status == 200
        and set(body) == {"team", "members", "score", "scenarios"}
        and len(body["members"]) == 2
        and set(body["members"][0])
        == {"user_id", "display_name", "joined_at", "is_captain", "tickets"}
        and body["members"][0]["is_captain"] is True
        and body["members"][1]["is_captain"] is False
        and body["score"] == 0
        and len(body["scenarios"]) == 8
        and set(body["scenarios"][0])
        == {"slug", "team_solved", "solved_by_me", "attempted_by_me"},
        body,
    )
    check(
        "team room carries no email",
        "@example.com" not in answer.text,
        answer.text[:200],
    )
    check("team room no-store", answer.header("Cache-Control") == "no-store")
    check(
        "a teamless player has no room",
        room(stranger).status == 404
        and room(stranger).json == {"error": "not_in_team"},
    )
    check("the room needs a session", room(None).status == 401)


def captain_checks() -> None:
    captain = player("boss")
    team = make_team(captain, "boss")
    member = player("member")
    join(member, team["invite_code"])
    member_id = [
        entry["user_id"]
        for entry in room(captain).json["members"]
        if not entry["is_captain"]
    ][0]
    captain_id = team["captain_id"]

    check(
        "only the captain removes",
        call("POST", f"/api/teams/mine/members/{captain_id}/remove", token=member).json
        == {"error": "not_captain"},
    )
    check(
        "only the captain issues a code",
        call("POST", "/api/teams/mine/invite-code", token=member).json
        == {"error": "not_captain"},
    )
    check(
        "the captain cannot remove themselves",
        call("POST", f"/api/teams/mine/members/{captain_id}/remove", token=captain).json
        == {"error": "captain_cannot_remove_self"},
    )
    for label, raw in (
        ("non-ascii digits", "%D9%A1"),
        ("fullwidth digits", "%EF%BC%91"),
        ("signed", "+1"),
        ("negative", "-1"),
        ("leading zero", "01"),
        ("too large", "9223372036854775808"),
        ("letters", "abc"),
        ("nul", "1%00"),
    ):
        answer = call("POST", f"/api/teams/mine/members/{raw}/remove", token=captain)
        check(
            f"malformed member id {label}",
            answer.status == 404 and answer.json == {"error": "not_a_member"},
            answer,
        )
    outsider = login("solo@example.com", SEED_PASSWORD)
    outsider_id = call("GET", "/api/me", token=outsider).json["user"]["id"]
    answer = call(
        "POST", f"/api/teams/mine/members/{outsider_id}/remove", token=captain
    )
    check(
        "a player from no team is not a member",
        answer.json == {"error": "not_a_member"},
        answer,
    )

    before = room(captain).json["team"]["invite_code"]
    answer = call("POST", f"/api/teams/mine/members/{member_id}/remove", token=captain)
    check("remove member", answer.status == 204, answer)
    after = room(captain).json["team"]["invite_code"]
    check("removal rotates the invite code", before != after, (before, after))
    check(
        "the old code joins nobody",
        join(player("late"), before).json == {"error": "unknown_invite_code"},
    )
    check(
        "the removed player is teamless at once",
        call("GET", "/api/me", token=member).json["team"] is None
        and room(member).status == 404
        and submit(member, "repossessed", FLAGS["repossessed"]).json
        == {"error": "no_team"},
    )

    answer = call("POST", "/api/teams/mine/invite-code", token=captain)
    check(
        "new invite code",
        answer.status == 200
        and set(answer.json) == {"invite_code"}
        and answer.json["invite_code"] != after,
        answer,
    )


def succession_checks() -> None:
    captain = player("first")
    team = make_team(captain, "succession")
    second = player("second")
    third = player("third")
    join(second, team["invite_code"])
    time.sleep(0.05)
    join(third, team["invite_code"])

    check(
        "captain leaves", call("POST", "/api/teams/leave", token=captain).status == 204
    )
    body = room(second).json
    check(
        "captaincy passes to the earliest-joined member",
        body["team"]["captain_id"]
        == [entry["user_id"] for entry in body["members"] if entry["is_captain"]][0]
        and body["members"][0]["is_captain"] is True,
        body,
    )
    check(
        "a departed captain is teamless",
        call("GET", "/api/me", token=captain).json["team"] is None,
    )

    call("POST", "/api/teams/leave", token=second)
    call("POST", "/api/teams/leave", token=third)
    board = call("GET", "/api/leaderboard?limit=50").json["entries"]
    kept = [entry for entry in board if entry["team_name"] == team["name"]]
    check("an emptied team stays on the board", len(kept) == 1, board)
    joiner = player("joiner")
    answer = join(joiner, team["invite_code"])
    check("an emptied team keeps its code", answer.status == 200, answer)
    body = room(joiner).json
    check(
        "the first joiner becomes captain",
        body["team"]["captain_id"] == body["members"][0]["user_id"]
        and body["members"][0]["is_captain"] is True,
        body,
    )


def simultaneous_team_checks() -> None:
    captain = player("race-captain")
    team = make_team(captain, "race")
    partner = player("race-partner")
    join(partner, team["invite_code"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(
            pool.map(
                lambda token: call("POST", "/api/teams/leave", token=token),
                (captain, partner),
            )
        )
    check(
        "both leaves answer 204",
        [answer.status for answer in answers] == [204, 204],
        answers,
    )
    board = call("GET", "/api/leaderboard?limit=50").json["entries"]
    check(
        "the emptied team is kept",
        any(entry["team_name"] == team["name"] for entry in board),
    )

    boss = player("three-captain")
    trio = make_team(boss, "trio")
    early = player("three-early")
    late = player("three-late")
    join(early, trio["invite_code"])
    time.sleep(0.05)
    join(late, trio["invite_code"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(
            pool.map(
                lambda token: call("POST", "/api/teams/leave", token=token),
                (boss, early),
            )
        )
    check(
        "both leaves in a team of three answer 204",
        [answer.status for answer in answers] == [204, 204],
        answers,
    )
    body = room(late).json
    check(
        "the third member becomes captain",
        body["team"]["captain_id"] == body["members"][0]["user_id"]
        and len(body["members"]) == 1,
        body,
    )

    chief = player("clash-captain")
    clash = make_team(chief, "clash")
    target = player("clash-target")
    join(target, clash["invite_code"])
    target_id = call("GET", "/api/me", token=target).json["user"]["id"]
    code_before = room(chief).json["team"]["invite_code"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        removal = pool.submit(
            call, "POST", f"/api/teams/mine/members/{target_id}/remove", None, chief
        )
        departure = pool.submit(call, "POST", "/api/teams/leave", None, target)
        remove_answer, leave_answer = removal.result(), departure.result()
    code_after = room(chief).json["team"]["invite_code"]
    removal_won = (
        remove_answer.status == 204
        and leave_answer.status == 409
        and leave_answer.json == {"error": "not_in_team"}
        and code_after != code_before
    )
    leave_won = (
        leave_answer.status == 204
        and remove_answer.status == 404
        and remove_answer.json == {"error": "not_a_member"}
        and code_after == code_before
    )
    check(
        "remove and leave resolve to exactly one",
        removal_won != leave_won and (removal_won or leave_won),
        (remove_answer, leave_answer, code_before, code_after),
    )

    joiners = [player(f"last-place-{index}") for index in range(4)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(pool.map(lambda token: join(token, "NULLHARB"), joiners))
    winners = [answer for answer in answers if answer.status == 200]
    full = [answer for answer in answers if answer.json == {"error": "team_full"}]
    check(
        "simultaneous joins fill the last place once",
        len(winners) == 1 and len(full) == 3,
        [answer.status for answer in answers],
    )
    emptied_captain = player("empty-captain")
    emptied = make_team(emptied_captain, "emptied")
    call("POST", "/api/teams/leave", token=emptied_captain)
    rejoiners = [player(f"rejoin-{index}") for index in range(3)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        answers = list(
            pool.map(lambda token: join(token, emptied["invite_code"]), rejoiners)
        )
    check(
        "all joins to an emptied team succeed",
        all(answer.status == 200 for answer in answers),
        [answer.status for answer in answers],
    )
    rooms = [room(token).json for token in rejoiners]
    captains = {
        tuple(
            sorted(entry["user_id"] for entry in body["members"] if entry["is_captain"])
        )
        for body in rooms
    }
    check(
        "exactly one joiner is captain everywhere",
        len(captains) == 1 and len(next(iter(captains))) == 1,
        captains,
    )


# -- flags ---------------------------------------------------------------
def flag_checks() -> None:
    captain = player("solver")
    team = make_team(captain, "solvers")
    mate = player("mate")
    join(mate, team["invite_code"])

    answer = submit(captain, "repossessed", "flag{nope}")
    check(
        "wrong flag",
        answer.status == 200
        and answer.json
        == {
            "correct": False,
            "already_completed": False,
            "team_points_awarded": 0,
            "ticket_awarded": False,
            "team_score": 0,
            "tickets": 0,
        },
        answer,
    )
    answer = call("GET", "/api/scenarios/repossessed", token=captain)
    check(
        "a wrong flag marks the scenario attempted",
        answer.json["attempted_by_me"] is True and answer.json["team_solved"] is False,
        answer,
    )

    answer = submit(captain, "repossessed", f"  {FLAGS['repossessed']}  ")
    check(
        "a correct flag is trimmed and credits the team",
        answer.json
        == {
            "correct": True,
            "already_completed": False,
            "team_points_awarded": 500,
            "ticket_awarded": True,
            "team_score": 500,
            "tickets": 1,
        },
        answer,
    )
    answer = submit(captain, "repossessed", FLAGS["repossessed"].upper())
    check(
        "letter case matters",
        answer.json["correct"] is False,
        answer,
    )
    answer = submit(captain, "repossessed", FLAGS["repossessed"])
    check(
        "a repeat is already completed",
        answer.json["correct"] is True
        and answer.json["already_completed"] is True
        and answer.json["team_points_awarded"] == 0
        and answer.json["ticket_awarded"] is False,
        answer,
    )
    answer = submit(mate, "repossessed", FLAGS["repossessed"])
    check(
        "a teammate earns a ticket but no team points",
        answer.json["team_points_awarded"] == 0
        and answer.json["ticket_awarded"] is True
        and answer.json["tickets"] == 1
        and answer.json["team_score"] == 500,
        answer,
    )

    for label, payload in (
        ("blank", {"flag": "  "}),
        ("missing", {}),
        ("nul", {"flag": "a\u0000b"}),
    ):
        answer = call("POST", "/api/scenarios/repossessed/flag", payload, token=captain)
        check(
            f"{label} flag is a validation error",
            answer.status == 400 and "flag" in answer.json.get("fields", {}),
            answer,
        )
    answer = call("POST", "/api/scenarios/nope/flag", {"flag": "  "}, token=captain)
    check(
        "a blank flag is refused before an unknown scenario",
        answer.status == 400,
        answer,
    )
    answer = submit(captain, "nope", "flag{x}")
    check("unknown scenario", answer.json == {"error": "unknown_scenario"}, answer)
    teamless = player("teamless")
    answer = call(
        "POST", "/api/scenarios/repossessed/flag", {"flag": ""}, token=teamless
    )
    check(
        "standing is checked before the flag field",
        answer.status == 409 and answer.json == {"error": "no_team"},
        answer,
    )
    check(
        "a flag needs a session",
        call("POST", "/api/scenarios/repossessed/flag", {"flag": "x"}).status == 401,
    )

    for slug, flag in FLAGS.items():
        if slug == "repossessed":
            continue
        answer = submit(captain, slug, flag)
        check(
            f"seeded flag solves {slug}",
            answer.json["correct"] is True and answer.json["team_points_awarded"] > 0,
            answer,
        )
    check(
        "a full board is 1950",
        room(captain).json["score"] == 1950,
        room(captain).json["score"],
    )
    return captain, mate, team


def lock_checks() -> None:
    locked = player("locked")
    team = make_team(locked, "locked")
    mate = player("locked-mate")
    join(mate, team["invite_code"])
    answers = [submit(locked, "day-o", f"flag{{wrong{index}}}") for index in range(5)]
    check(
        "five wrong flags answer normally",
        all(answer.json["correct"] is False for answer in answers),
        [answer.status for answer in answers],
    )
    answer = submit(locked, "day-o", "flag{wrong6}")
    retry = answer.header("Retry-After")
    check(
        "the sixth wrong flag is locked out",
        answer.status == 429
        and answer.json == {"error": "too_many_attempts"}
        and retry.isdigit()
        and 1 <= int(retry) <= 60,
        (answer, retry),
    )
    check(
        "the correct flag is locked out too",
        submit(locked, "day-o", FLAGS["day-o"]).status == 429,
    )
    check(
        "another scenario is not locked",
        submit(locked, "dead-endpoint", "flag{nope}").status == 200,
    )
    check(
        "a teammate is not locked",
        submit(mate, "day-o", "flag{nope}").status == 200,
    )
    check(
        "a blank flag is refused while locked",
        call("POST", "/api/scenarios/day-o/flag", {"flag": " "}, token=locked).status
        == 400,
    )
    call("POST", "/api/teams/leave", token=locked)
    check(
        "standing comes before the lock",
        submit(locked, "day-o", "flag{nope}").json == {"error": "no_team"},
    )
    make_team(locked, "moved")
    check(
        "the lock survives a team change",
        submit(locked, "day-o", "flag{nope}").status == 429,
    )

    burst_player = player("burst")
    make_team(burst_player, "burst")
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(
            pool.map(
                lambda index: submit(
                    burst_player, "the-waiting-room", f"flag{{no{index}}}"
                ),
                range(8),
            )
        )
    stored = sum(1 for answer in answers if answer.status == 200)
    refused = sum(1 for answer in answers if answer.status == 429)
    check(
        "exactly five wrong flags are stored under a burst",
        stored == 5 and refused == 3,
        (stored, refused),
    )
    reset_player = player("reset-lock")
    make_team(reset_player, "reset")
    for index in range(4):
        submit(reset_player, "day-o", f"flag{{no{index}}}")
    check(
        "a correct flag resets the count",
        submit(reset_player, "day-o", FLAGS["day-o"]).json["correct"] is True,
    )
    for index in range(4):
        answer = submit(reset_player, "day-o", f"flag{{no{index}}}")
    check("the count started again", answer.status == 200, answer)


def simultaneous_flag_checks() -> None:
    captain = player("twin-captain")
    team = make_team(captain, "twins")
    mate = player("twin-mate")
    join(mate, team["invite_code"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(
            pool.map(
                lambda token: submit(token, "repossessed", FLAGS["repossessed"]),
                (captain, mate),
            )
        )
    awarded = [answer.json["team_points_awarded"] for answer in answers]
    check(
        "teammates credit the team once",
        sorted(awarded) == [0, 500]
        and all(answer.json["ticket_awarded"] for answer in answers)
        and all(answer.json["team_score"] == 500 for answer in answers),
        [answer.json for answer in answers],
    )
    check(
        "each teammate holds one ticket",
        call("GET", "/api/me", token=captain).json["tickets"] == 1
        and call("GET", "/api/me", token=mate).json["tickets"] == 1,
    )

    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(
            pool.map(
                lambda _: submit(
                    captain, "quiet-as-the-grave", FLAGS["quiet-as-the-grave"]
                ),
                range(2),
            )
        )
    completed = [answer.json["already_completed"] for answer in answers]
    check(
        "one player twice stores one completion",
        sorted(completed) == [False, True]
        and call("GET", "/api/me", token=captain).json["tickets"] == 2,
        [answer.json for answer in answers],
    )


def webinar_checks() -> None:
    lone = player("webinar")
    answer = call("POST", "/api/webinar/flag", {"flag": "flag{nope}"}, token=lone)
    check(
        "a wrong webinar flag",
        answer.status == 422 and answer.json == {"error": "wrong_flag"},
        answer,
    )
    answer = call(
        "POST", "/api/webinar/flag", {"flag": f" {WEBINAR_FLAG} "}, token=lone
    )
    check(
        "the webinar bonus is two tickets",
        answer.status == 200 and answer.json == {"claimed": True, "tickets": 2},
        answer,
    )
    answer = call("POST", "/api/webinar/flag", {"flag": WEBINAR_FLAG}, token=lone)
    check(
        "a second claim is refused",
        answer.status == 409 and answer.json == {"error": "already_claimed"},
        answer,
    )
    answer = call("POST", "/api/webinar/flag", {"flag": "flag{nope}"}, token=lone)
    check(
        "a claim beats a wrong flag",
        answer.json == {"error": "already_claimed"},
        answer,
    )
    check(
        "the webinar needs a session",
        call("POST", "/api/webinar/flag", {"flag": WEBINAR_FLAG}).status == 401,
    )
    check(
        "me reports the claim",
        call("GET", "/api/me", token=lone).json["webinar_claimed"] is True,
    )


# -- leaderboard ---------------------------------------------------------
def leaderboard_checks() -> None:
    answer = call("GET", "/api/leaderboard")
    body = answer.json
    check(
        "leaderboard shape",
        set(body)
        == {"entries", "total", "page", "limit", "pages", "server_time", "feed"}
        and body["limit"] == 5
        and body["page"] == 1
        and len(body["entries"]) == 5
        and body["feed"] is None,
        body,
    )
    check(
        "entry fields",
        set(body["entries"][0])
        == {
            "rank",
            "team_id",
            "team_name",
            "soc_sim",
            "th_sim",
            "tabletop",
            "challenges_solved",
            "challenges_total",
            "points",
        }
        and body["entries"][0]["challenges_total"] == 5,
        body["entries"][0],
    )
    check(
        "leaderboard carries no email or invite code",
        "@example.com" not in answer.text and "invite" not in answer.text,
    )
    page_three = call("GET", "/api/leaderboard?page=3").json
    check(
        "global ranks on page three",
        [entry["rank"] for entry in page_three["entries"]] == [11, 12, 13, 14, 15],
        page_three["entries"],
    )
    capped = call("GET", "/api/leaderboard?limit=51").json
    check("limits above fifty are fifty", capped["limit"] == 50, capped["limit"])
    far = call("GET", "/api/leaderboard?page=9999").json
    check(
        "a page past the end is empty",
        far["entries"] == [] and far["total"] >= 16 and far["pages"] >= 1,
        far,
    )
    for query in (
        "page=0",
        "page=07",
        "page=-1",
        "page=abc",
        "page=%D9%A1",
        "page=1%00",
        "limit=0",
        "limit=x",
        "include_feed=2",
        "include_feed=yes",
    ):
        answer = call("GET", f"/api/leaderboard?{query}")
        check(
            f"malformed leaderboard query {query}",
            answer.status == 400 and answer.json["error"] == "validation",
            answer,
        )
    feed = call("GET", "/api/leaderboard?include_feed=1").json["feed"]
    check(
        "feed shape",
        len(feed) == 10
        and all(
            set(item) == {"team_name", "scenario_title", "points", "created_at"}
            for item in feed
        )
        and feed == sorted(feed, key=lambda item: item["created_at"], reverse=True),
        feed[:2],
    )


# -- stream --------------------------------------------------------------
class StreamReader(threading.Thread):
    def __init__(self, base: str = BASE) -> None:
        super().__init__(daemon=True)
        self.base = base
        self.lines: list[str] = []
        self.ready = threading.Event()
        self.stop = threading.Event()

    def run(self) -> None:
        request = urllib.request.Request(f"{self.base}/api/stream")
        with urllib.request.urlopen(request, timeout=30) as answer:
            self.ready.set()
            while not self.stop.is_set():
                line = answer.readline()
                if not line:
                    return
                self.lines.append(line.decode("utf-8").rstrip("\n"))

    def events(self, name: str) -> list[dict]:
        found = []
        for index, line in enumerate(self.lines):
            if line == f"event: {name}" and index + 1 < len(self.lines):
                found.append(json.loads(self.lines[index + 1].removeprefix("data: ")))
        return found


def stream_checks() -> None:
    reader = StreamReader()
    reader.start()
    reader.ready.wait(5)
    time.sleep(0.5)
    captain = player("stream")
    team = make_team(captain, "stream")
    answer = submit(captain, "dead-endpoint", FLAGS["dead-endpoint"])
    check("stream solve stored", answer.json["correct"] is True, answer)
    time.sleep(2.0)
    scores = reader.events("score")
    mine = [event for event in scores if event["team_id"] == team["id"]]
    check(
        "a score event reaches the stream within two seconds",
        len(mine) == 1
        and set(mine[0])
        == {"team_id", "team_name", "scenario_slug", "points", "team_score"}
        and mine[0]["points"] == 120
        and mine[0]["team_score"] == 120,
        mine,
    )
    teams = reader.events("team")
    check(
        "a team event reports only the team id",
        teams and all(set(event) == {"team_id"} for event in teams),
        teams[:3],
    )
    check(
        "the stream carries no email or invite code",
        not any("@example.com" in line or "invite" in line for line in reader.lines),
    )
    check(
        "the stream sends a comment line",
        any(line.startswith(":") for line in reader.lines),
        reader.lines[:3],
    )
    reader.stop.set()


# -- certificate ---------------------------------------------------------
def certificate_checks() -> None:
    captain = login("coldledger@example.com", SEED_PASSWORD)
    answer = call("GET", "/api/me/certificate", token=captain)
    body = answer.json
    check(
        "certificate body",
        answer.status == 200
        and set(body) == {"display_name", "team_name", "event_name", "issued_on"}
        and body["display_name"] == "Mara Quill"
        and body["team_name"] == "Cold Ledger"
        and body["event_name"] == "Strange & Unusual Activity"
        and body["issued_on"] == "2026-10-23T07:30:00Z",
        body,
    )
    image = call("GET", "/api/me/certificate/image", token=captain)
    check(
        "certificate image type",
        image.status == 200 and image.header("Content-Type") == "image/svg+xml",
        image.headers,
    )
    try:
        tree = ElementTree.fromstring(image.raw)
        texts = {element.text for element in tree.iter() if element.text}
    except ElementTree.ParseError as error:
        tree, texts = None, set()
        check("certificate image parses", False, error)
    if tree is not None:
        check(
            "certificate image text",
            "Certificate of completion" in texts
            and "22 to 26 October 2026" in texts
            and "Mara Quill" in texts
            and "Cold Ledger" in texts
            and "2026-10-23T07:30:00Z" in texts,
            texts,
        )
        check(
            "certificate image has no script or reference",
            b"<script" not in image.raw
            and b"http://" not in image.raw.replace(b"http://www.w3.org/2000/svg", b""),
        )

    awkward = signup(email("awkward"), 'Ada & <Moth> "Q"')
    join(awkward, "COLDLEDG")
    answer = call("GET", "/api/me/certificate", token=awkward)
    check(
        "a late joiner of a finished team is eligible",
        answer.status == 200
        and answer.json["display_name"] == 'Ada & <Moth> "Q"'
        and answer.json["issued_on"] == "2026-10-23T07:30:00Z",
        answer,
    )
    image = call("GET", "/api/me/certificate/image", token=awkward)
    tree = ElementTree.fromstring(image.raw)
    texts = {element.text for element in tree.iter() if element.text}
    check(
        "an awkward display name survives the svg",
        'Ada & <Moth> "Q"' in texts,
        texts,
    )
    call("POST", "/api/teams/leave", token=awkward)
    answer = call("GET", "/api/me/certificate", token=awkward)
    check(
        "a departed player is refused",
        answer.status == 403 and answer.json == {"error": "not_complete"},
        answer,
    )
    unfinished = login("mothlight@example.com", SEED_PASSWORD)
    check(
        "an unfinished team is refused",
        call("GET", "/api/me/certificate", token=unfinished).json
        == {"error": "not_complete"},
    )
    check(
        "the certificate needs a session",
        call("GET", "/api/me/certificate").status == 401,
    )


def moving_team_checks() -> None:
    mover = player("mover")
    first = make_team(mover, "first-stop")
    submit(mover, "day-o", FLAGS["day-o"])
    tickets_before = call("GET", "/api/me", token=mover).json["tickets"]
    call("POST", "/api/teams/leave", token=mover)
    check(
        "a departed player keeps their completions and tickets",
        call("GET", "/api/me", token=mover).json["completions"] == ["day-o"]
        and call("GET", "/api/me", token=mover).json["tickets"] == tickets_before,
        call("GET", "/api/me", token=mover).json,
    )
    board = call("GET", "/api/leaderboard?limit=50").json["entries"]
    kept = [entry for entry in board if entry["team_name"] == first["name"]]
    check(
        "the old team keeps the points from that solve",
        kept and kept[0]["points"] == 90,
        kept,
    )
    make_team(mover, "second-stop")
    answer = submit(mover, "day-o", FLAGS["day-o"])
    check(
        "a new team never scores an old completion",
        answer.json["already_completed"] is True
        and answer.json["team_points_awarded"] == 0
        and answer.json["team_score"] == 0,
        answer,
    )
    check(
        "the new team stays at zero",
        room(mover).json["score"] == 0,
        room(mover).json["score"],
    )


def media_checks() -> None:
    for path, digest in (
        (
            "/assets/moths-drawn-to-park-lights-246f8064.webm",
            "dbccae98058fd49ed2e4541c367a17a6a33401cf4dc3300123c0c2056ce9a60c",
        ),
        (
            "/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg",
            "ec2a2a610ad3dcc36ecc1ea7d7e1b4f58255026434bd357e5edd446b3fe3bcc7",
        ),
    ):
        answer = call("GET", path)
        check(
            f"{path.rsplit('/', 1)[-1]} is served byte for byte",
            answer.status == 200 and hashlib.sha256(answer.raw).hexdigest() == digest,
            (answer.status, len(answer.raw)),
        )
    answer = call("GET", "/media/briefing.vtt")
    text = answer.text
    check(
        "the captions are a webvtt captions track",
        answer.status == 200
        and answer.header("Content-Type").startswith("text/vtt")
        and text.startswith("WEBVTT")
        and "Kind: captions" in text
        and "Language: en" in text
        and text.count("-->") == 3
        and "Moths circle the lamps after dark." in text
        and "Something on the studio network is drawn to the light too." in text
        and "Find out what it is before the build walks out the door." in text,
        text[:80],
    )
    for path in (
        "/server/app.py",
        "/run.json",
        "/.venv/bin/python",
        "/requirements.txt",
    ):
        answer = call("GET", path)
        check(f"{path} is not served", answer.status == 404, answer.status)


def junk_checks() -> None:
    token = player("junk")
    paths = [
        "/api/scenarios/%00",
        "/api/scenarios/..%2f..%2fetc%2fpasswd",
        "/api/scenarios/" + "a" * 300,
        "/api/teams/mine/members/%00/remove",
        "/api/teams/mine/members/1e3/remove",
        "/api/leaderboard?page=%00",
        "/api/leaderboard?limit=1e3",
        "/api/leaderboard?include_feed=%201",
        "/api/me%00",
        "/api/../etc/passwd",
        "/api/health/",
        "/api//health",
    ]
    for path in paths:
        for method in ("GET", "POST"):
            answer = call(method, path, token=token)
            looks_like_json = answer.raw == b"" or answer.raw.lstrip().startswith(b"{")
            check(
                f"{method} {path} answers json without a server error",
                answer.status in (400, 404, 405, 409, 415, 422)
                and looks_like_json
                and b"Traceback" not in answer.raw
                and b"pg8000" not in answer.raw
                and b"/app/" not in answer.raw,
                (answer.status, answer.raw[:120]),
            )


def main() -> int:
    print(f"checking {BASE}")
    team_checks()
    captain_checks()
    succession_checks()
    simultaneous_team_checks()
    flag_checks()
    lock_checks()
    simultaneous_flag_checks()
    webinar_checks()
    leaderboard_checks()
    moving_team_checks()
    media_checks()
    junk_checks()
    stream_checks()
    certificate_checks()
    return report()


if __name__ == "__main__":
    sys.exit(main())
