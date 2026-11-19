"""The domain rules: accounts, teams, flags, tickets and the certificate.

Each rule is decided in exactly one place here: team credit (submit_flag),
ticket count (ticket_count), the wrong-flag lock (wrong_flag_lock), the
sign-in throttle (sign_in_throttle_state), the ranking order (ranking_rows),
the team cap (TEAM_CAP, join_team), captain authority and succession
(_ensure_captain_exists), invite code rotation (rotate_invite_code), the
return-address check (safe_redirect in pages.py) and the certificate issued
time (certificate_for).

Changes to one team are serialised by one shared SELECT ... FOR UPDATE on the
team row. Simultaneous outcomes are settled by the database, never by an
earlier read checked later. A player's own membership changes are serialised
by a per-player advisory lock, and attempts that race on one player and one
scenario by a per-attempt advisory lock.
"""

import datetime
import hashlib
import json
import secrets

from . import db, errors
from .config import SIGN_IN_LOCK_SECONDS

TEAM_CAP = 20
WRONG_FLAG_LIMIT = 5
WRONG_FLAG_LOCK_SECONDS = 60
ATTEMPT_NAMESPACE = 918274
EVENT_CHANNEL = "downtime_events"
_UTC = datetime.timezone.utc
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=_UTC)


# --- accounts ----------------------------------------------------------------

def user_public(row):
    """The published user fields. It is only ever the caller's own record."""
    return {"id": row[0], "email": row[1], "display_name": row[2]}


def find_user_by_email(conn, email):
    return db.query_one(
        conn, "SELECT id, email, display_name, password_salt, password_hash "
              "FROM users WHERE email = %s", (email,))


def create_account(conn, email, display_name, password):
    """Simultaneous sign-ups for one email create exactly one account: the
    unique index settles the race, every other request answers 409."""
    salt, password_hash = db.salted_hash(password)
    try:
        return db.query_one(
            conn,
            "INSERT INTO users (email, display_name, password_salt, password_hash, created_at) "
            "VALUES (%s, %s, %s, %s, statement_timestamp()) "
            "RETURNING id, email, display_name",
            (email, display_name, salt, password_hash))
    except Exception as exc:
        conn.rollback()
        if _unique_violation(exc):
            raise errors.email_taken()
        raise


def start_session(conn, user_id):
    token = secrets.token_hex(32)
    db.execute(conn, "INSERT INTO sessions (token, user_id, created_at) "
                     "VALUES (%s, %s, statement_timestamp())", (token, user_id))
    return token


def end_session(conn, token):
    db.execute(conn, "DELETE FROM sessions WHERE token = %s", (token,))


def user_for_token(conn, token):
    return db.query_one(
        conn,
        "SELECT u.id, u.email, u.display_name FROM sessions s "
        "JOIN users u ON u.id = s.user_id WHERE s.token = %s", (token,))


def ticket_count(conn, user_id):
    """A player's tickets: their completions plus 2 when they hold a webinar
    claim. Computed from stored rows, never a counter."""
    completions = db.query_one(
        conn, "SELECT count(*) FROM completions WHERE user_id = %s", (user_id,))[0]
    claimed = db.query_one(
        conn, "SELECT 1 FROM webinar_claims WHERE user_id = %s", (user_id,))
    return completions + (2 if claimed else 0)


def completions_slugs(conn, user_id):
    return [row[0] for row in db.query(
        conn, "SELECT scenario_slug FROM completions WHERE user_id = %s "
              "ORDER BY scenario_slug", (user_id,))]


def caller(conn, token):
    """Every route but the public reads needs a bearer token. Membership is
    read from the database on every request, never from the session."""
    if not token:
        raise errors.unauthenticated()
    row = user_for_token(conn, token)
    if row is None:
        raise errors.unauthenticated()
    return row


# --- the sign-in throttle, in one place --------------------------------------

def sign_in_throttle_state(conn, email, now):
    """After ten failed sign-ins in a row for one email, every sign-in for
    that email is refused until the lock time has passed, measured from the
    tenth failure's created_at on the database clock."""
    rows = db.query(
        conn,
        "SELECT succeeded, created_at FROM login_attempts WHERE email = %s "
        "ORDER BY id DESC LIMIT 10", (email,))
    if len(rows) < 10 or any(row[0] for row in rows):
        return None
    lock_until = rows[0][1] + datetime.timedelta(seconds=max(1, int(SIGN_IN_LOCK_SECONDS)))
    return lock_until if now < lock_until else None


def record_sign_in(conn, email, succeeded):
    """Every sign-in that reaches the password check stores one row, whether
    it succeeds or fails."""
    db.execute(conn, "INSERT INTO login_attempts (email, succeeded, created_at) "
                     "VALUES (%s, %s, statement_timestamp())", (email, succeeded))


# --- teams -------------------------------------------------------------------

def team_public(row):
    return {"id": row[0], "name": row[1], "invite_code": row[2],
            "captain_id": row[3]}


def team_for_caller(conn, user_row):
    return db.query_one(
        conn,
        "SELECT t.id, t.name, t.invite_code, t.captain_id FROM memberships m "
        "JOIN teams t ON t.id = m.team_id WHERE m.user_id = %s", (user_row[0],))


def lock_my_membership(conn, user_id):
    """The one shared serialisation point for changes to one player's team
    membership: the caller's own membership row, or the absence of one."""
    db.execute(conn, "SELECT id FROM memberships WHERE user_id = %s FOR UPDATE",
               (user_id,))


def lock_team(conn, team_id):
    db.execute(conn, "SELECT id FROM teams WHERE id = %s FOR UPDATE", (team_id,))


def create_team(conn, user_row, name):
    """A teamless player creates a uniquely named team and becomes its
    captain."""
    lock_my_membership(conn, user_row[0])
    if db.query_one(conn, "SELECT 1 FROM memberships WHERE user_id = %s", (user_row[0],)):
        raise errors.already_in_team()
    try:
        team = db.query_one(
            conn,
            "INSERT INTO teams (name, invite_code, captain_id, created_at) "
            "VALUES (%s, %s, %s, statement_timestamp()) "
            "RETURNING id, name, invite_code, captain_id",
            (name, db.draw_invite_code(conn), user_row[0]))
        db.execute(conn, "INSERT INTO memberships (user_id, team_id, joined_at) "
                         "VALUES (%s, %s, statement_timestamp())",
                   (user_row[0], team[0]))
        publish_team_event(conn, team[0])
        return team
    except Exception as exc:
        conn.rollback()
        if _unique_violation(exc):
            raise errors.name_taken()
        raise


def join_team(conn, user_row, invite_code):
    """A teamless player joins with the current invite code in any letter
    case. Joins for the last free place are serialised by the team row lock,
    so exactly one succeeds."""
    lock_my_membership(conn, user_row[0])
    if db.query_one(conn, "SELECT 1 FROM memberships WHERE user_id = %s", (user_row[0],)):
        raise errors.already_in_team()
    team = db.query_one(
        conn, "SELECT id, name, invite_code, captain_id FROM teams "
              "WHERE upper(invite_code) = %s FOR UPDATE", (invite_code,))
    if team is None:
        raise errors.unknown_invite_code()
    if db.query_one(conn, "SELECT count(*) FROM memberships WHERE team_id = %s",
                    (team[0],))[0] >= TEAM_CAP:
        raise errors.team_full()
    db.execute(conn, "INSERT INTO memberships (user_id, team_id, joined_at) "
                     "VALUES (%s, %s, statement_timestamp())", (user_row[0], team[0]))
    _ensure_captain_exists(conn, team[0])
    publish_team_event(conn, team[0])
    return db.query_one(
        conn, "SELECT id, name, invite_code, captain_id FROM teams WHERE id = %s",
        (team[0],))


def _ensure_captain_exists(conn, team_id):
    """Captaincy is always a current member or nobody: null exactly when the
    team has no members, otherwise the earliest-joined member when the seat
    is empty."""
    if not db.query_one(conn, "SELECT 1 FROM teams WHERE id = %s AND captain_id IS NULL",
                        (team_id,)):
        return
    member = db.query_one(
        conn, "SELECT user_id FROM memberships WHERE team_id = %s "
              "ORDER BY joined_at, id LIMIT 1", (team_id,))
    if member:
        db.execute(conn, "UPDATE teams SET captain_id = %s WHERE id = %s",
                   (member[0], team_id))


def leave_team(conn, user_row):
    """Leaving passes captaincy to the earliest-joined remaining member. The
    leave is serialised against every other change on the team by the same
    team row lock, and the membership is re-read under that lock, so a
    simultaneous removal settles as exactly one of the two."""
    lock_my_membership(conn, user_row[0])
    team = team_for_caller(conn, user_row)
    if team is None:
        raise errors.not_in_team()
    lock_team(conn, team[0])
    if team_for_caller(conn, user_row) is None:
        # A simultaneous removal already took effect.
        raise errors.not_in_team()
    db.execute(conn, "DELETE FROM memberships WHERE user_id = %s", (user_row[0],))
    remaining = db.query_one(
        conn, "SELECT user_id FROM memberships WHERE team_id = %s "
              "ORDER BY joined_at, id LIMIT 1", (team[0],))
    if remaining:
        db.execute(conn, "UPDATE teams SET captain_id = %s WHERE id = %s",
                   (remaining[0], team[0]))
    else:
        db.execute(conn, "UPDATE teams SET captain_id = NULL WHERE id = %s", (team[0],))
    publish_team_event(conn, team[0])
    return team


def remove_member(conn, user_row, target_id):
    """Only the captain may remove a member. The removal and the member's
    simultaneous leave are serialised by the team row lock, so exactly one of
    the two takes effect, and the invite code rotates when a removal does."""
    lock_my_membership(conn, user_row[0])
    team = team_for_caller(conn, user_row)
    if team is None:
        raise errors.not_in_team()
    lock_team(conn, team[0])
    if team_for_caller(conn, user_row) is None:
        raise errors.not_in_team()
    if team[3] != user_row[0]:
        raise errors.not_captain()
    if target_id == user_row[0]:
        raise errors.captain_cannot_remove_self()
    if not db.query_one(conn, "SELECT 1 FROM memberships WHERE user_id = %s AND team_id = %s",
                        (target_id, team[0])):
        raise errors.not_a_member()
    db.execute(conn, "DELETE FROM memberships WHERE user_id = %s", (target_id,))
    rotate_invite_code(conn, team)
    _ensure_captain_exists(conn, team[0])
    publish_team_event(conn, team[0])
    return team


def rotate_invite_code(conn, team_row):
    """A new invite code and every successful removal replace the team's code
    with a freshly drawn one that differs from the old, at once."""
    code = db.draw_invite_code(conn, exclude={team_row[2]})
    db.execute(conn, "UPDATE teams SET invite_code = %s WHERE id = %s",
               (code, team_row[0]))
    return code


def team_room(conn, user_row):
    """GET /api/teams/mine: the team, its members oldest join first with their
    tickets, its score and the eight scenario states, or 404 for a teamless
    player."""
    team = team_for_caller(conn, user_row)
    if team is None:
        raise errors.team_room_not_in_team()
    members = []
    for row in db.query(
            conn,
            "SELECT u.id, u.display_name, m.joined_at FROM memberships m "
            "JOIN users u ON u.id = m.user_id WHERE m.team_id = %s "
            "ORDER BY m.joined_at, m.id", (team[0],)):
        members.append({
            "user_id": row[0], "display_name": row[1],
            "joined_at": db.time_text(row[2]),
            "is_captain": row[0] == team[3],
            "tickets": ticket_count(conn, row[0])})
    return {"team": team_public(team), "members": members,
            "score": team_score(conn, team[0]),
            "scenarios": scenario_states(conn, team[0], user_row[0])}


def scenario_states(conn, team_id, user_id):
    solved = {row[0] for row in db.query(
        conn, "SELECT scenario_slug FROM team_solves WHERE team_id = %s", (team_id,))}
    mine = {row[0] for row in db.query(
        conn, "SELECT scenario_slug FROM completions WHERE user_id = %s", (user_id,))}
    attempted = {row[0] for row in db.query(
        conn, "SELECT DISTINCT scenario_slug FROM flag_attempts "
              "WHERE user_id = %s AND correct = false", (user_id,))}
    return [{"slug": row[0], "team_solved": row[0] in solved,
             "solved_by_me": row[0] in mine,
             "attempted_by_me": row[0] in attempted}
            for row in db.query(conn, "SELECT slug FROM scenarios ORDER BY number")]


def team_score(conn, team_id):
    """A team's score is the sum of the points of its team solves. Computed
    from stored rows, never a counter."""
    row = db.query_one(
        conn,
        "SELECT coalesce(sum(s.points), 0) FROM team_solves ts "
        "JOIN scenarios s ON s.slug = ts.scenario_slug WHERE ts.team_id = %s",
        (team_id,))
    return row[0] or 0


def last_scoring_time(conn, team_id):
    """A team's time of last scoring is the created_at of its latest team
    solve."""
    row = db.query_one(conn, "SELECT max(created_at) FROM team_solves WHERE team_id = %s",
                      (team_id,))
    return row[0]


def _unique_violation(exc):
    return "duplicate key value" in str(exc) or "unique" in str(exc).lower()


# --- flags -------------------------------------------------------------------

def flag_sha256(flag):
    return hashlib.sha256(flag.encode("utf-8")).hexdigest()


def scenario_for_slug(conn, slug):
    return db.query_one(
        conn, "SELECT slug, number, title, kind, points, description FROM scenarios "
              "WHERE slug = %s", (slug,))


def submit_flag(conn, user_row, scenario, submitted_flag):
    """A flag is compared exactly, letter case included, after trimming
    surrounding whitespace, by its SHA-256 against the stored hash. Team
    credit, the personal ticket and the wrong-flag lock are all decided here.

    Attempts by one player on one scenario are serialised by that attempt's
    advisory lock, and the team credit by the team row lock, so simultaneous
    submissions credit the team exactly once and each player at most once."""
    slug = scenario[0]
    attempt_lock(conn, user_row[0], slug)
    now = db.statement_now(conn)
    lock_until = wrong_flag_lock(conn, user_row[0], slug, now)
    if lock_until is not None:
        raise errors.too_many_attempts(retry_after(now, lock_until,
                                                   WRONG_FLAG_LOCK_SECONDS))
    correct = flag_sha256(submitted_flag) == stored_flag_sha256(conn, slug)
    completed = db.query_one(conn, "SELECT 1 FROM completions WHERE user_id = %s "
                                  "AND scenario_slug = %s", (user_row[0], slug))
    if correct and completed:
        # A correct flag from a player who has already completed this
        # scenario, in this team or any earlier one, writes nothing.
        return {"correct": True, "already_completed": True,
                "team_points_awarded": 0, "ticket_awarded": False,
                "team_score": None, "tickets": None}
    db.execute(conn, "INSERT INTO flag_attempts (user_id, scenario_slug, correct, created_at) "
                     "VALUES (%s, %s, %s, statement_timestamp())",
               (user_row[0], slug, correct))
    if not correct:
        return {"correct": False, "already_completed": False,
                "team_points_awarded": 0, "ticket_awarded": False,
                "team_score": None, "tickets": None}
    team = team_for_caller(conn, user_row)
    if team is None:
        raise errors.no_team()
    lock_team(conn, team[0])
    if team_for_caller(conn, user_row) is None:
        raise errors.no_team()
    db.execute(conn, "INSERT INTO completions (user_id, scenario_slug, team_id, created_at) "
                     "VALUES (%s, %s, %s, statement_timestamp()) "
                     "ON CONFLICT (user_id, scenario_slug) DO NOTHING",
               (user_row[0], slug, team[0]))
    credit = db.query_one(
        conn,
        "INSERT INTO team_solves (team_id, scenario_slug, user_id, created_at) "
        "VALUES (%s, %s, %s, statement_timestamp()) "
        "ON CONFLICT (team_id, scenario_slug) DO NOTHING RETURNING created_at",
        (team[0], slug, user_row[0]))
    points_awarded = scenario[4] if credit else 0
    if credit:
        publish_score_event(conn, team, scenario, points_awarded)
    return {"correct": True, "already_completed": False,
            "team_points_awarded": points_awarded,
            "ticket_awarded": True,
            "team_score": team_score(conn, team[0]),
            "tickets": ticket_count(conn, user_row[0])}


def attempt_lock(conn, user_id, scenario_slug):
    """Serialise flag attempts by one player on one scenario, so exactly
    five wrong rows are stored under a burst and every one beyond the fifth
    is refused."""
    db.execute(conn, "SELECT pg_advisory_xact_lock(%s, %s)",
               (ATTEMPT_NAMESPACE,
                (user_id * 8 + _slug_number(conn, scenario_slug)) % 2000000000))


def _slug_number(conn, scenario_slug):
    row = db.query_one(conn, "SELECT number FROM scenarios WHERE slug = %s",
                       (scenario_slug,))
    return row[0] if row else 0


def publish_score_event(conn, team_row, scenario, points):
    """A team solve made through any instance reaches /api/stream on every
    instance within two seconds, through PostgreSQL."""
    payload = json.dumps({
        "team_id": team_row[0], "team_name": team_row[1],
        "scenario_slug": scenario[0], "points": points,
        "team_score": team_score(conn, team_row[0])})
    text = "event: score\ndata: " + payload
    db.execute(conn, "SELECT pg_notify(%s, %s)", (EVENT_CHANNEL, text))


def publish_team_event(conn, team_id):
    payload = json.dumps({"team_id": team_id})
    text = "event: team\ndata: " + payload
    db.execute(conn, "SELECT pg_notify(%s, %s)", (EVENT_CHANNEL, text))


def stored_flag_sha256(conn, slug):
    return db.query_one(conn, "SELECT flag_sha256 FROM scenarios WHERE slug = %s", (slug,))[0]


def wrong_flag_lock(conn, user_id, scenario_slug, now):
    """The wrong-flag lock, in one place. The count is the stored wrong rows
    since the later of the player's latest correct row and the end of their
    latest lock. The fifth wrong flag starts a sixty-second lock stamped by
    the database clock. The lock belongs to the player and the scenario, not
    to the team."""
    latest_correct = db.query_one(
        conn, "SELECT max(created_at) FROM flag_attempts "
              "WHERE user_id = %s AND scenario_slug = %s AND correct = true",
        (user_id, scenario_slug))
    lock_end = db.query_one(
        conn, "SELECT max(created_at) + interval '60 seconds' FROM flag_attempts "
              "WHERE user_id = %s AND scenario_slug = %s AND correct = false "
              "AND (SELECT count(*) FROM flag_attempts w WHERE w.user_id = flag_attempts.user_id "
              "AND w.scenario_slug = flag_attempts.scenario_slug AND w.correct = false "
              "AND w.created_at >= %s AND w.id <= flag_attempts.id) = %s",
        (user_id, scenario_slug, latest_correct and latest_correct[0] or _EPOCH,
         WRONG_FLAG_LIMIT))
    if lock_end is None or lock_end[0] is None:
        return None
    lock_until = lock_end[0]
    return lock_until if now < lock_until else None


def retry_after(now, until, cap):
    """Seconds left until a lock ends, rounded up, from 1 to cap."""
    left = (until - now).total_seconds()
    return max(1, min(cap, int(left) + (1 if left % 1 else 0)))


# --- webinar ------------------------------------------------------------------

def webinar_claim(conn, user_row, submitted_flag):
    """The webinar flag adds 2 tickets once per player, with or without a
    team."""
    if db.query_one(conn, "SELECT 1 FROM webinar_claims WHERE user_id = %s", (user_row[0],)):
        raise errors.already_claimed()
    from .seed import WEBINAR_FLAG
    if flag_sha256(submitted_flag) != flag_sha256(WEBINAR_FLAG):
        raise errors.wrong_flag()
    db.execute(conn, "INSERT INTO webinar_claims (user_id, created_at) "
                     "VALUES (%s, statement_timestamp()) ON CONFLICT (user_id) DO NOTHING",
               (user_row[0],))
    return ticket_count(conn, user_row[0])


# --- leaderboard and feed ----------------------------------------------------

def ranking_rows(conn, page, limit):
    """Teams rank by points, then by who reached their points first, then
    oldest first. Zero-point and emptied teams are kept."""
    rows = db.query(
        conn,
        "SELECT t.id, t.name, t.invite_code, t.captain_id, t.created_at, "
        "       coalesce(pts.total, 0) AS points, "
        "       pts.last_at "
        "FROM teams t "
        "LEFT JOIN (SELECT team_id, sum(s.points) AS total, max(ts.created_at) AS last_at "
        "           FROM team_solves ts JOIN scenarios s ON s.slug = ts.scenario_slug "
        "           GROUP BY team_id) pts ON pts.team_id = t.id "
        "ORDER BY points DESC, "
        "         (CASE WHEN pts.last_at IS NULL THEN 1 ELSE 0 END) DESC, "
        "         pts.last_at ASC NULLS LAST, t.created_at ASC, t.id ASC")
    return rows


def ranking_page(conn, page, limit):
    rows = ranking_rows(conn, page, limit)
    total = len(rows)
    pages = (total + limit - 1) // limit if limit else 1
    start = (page - 1) * limit
    return rows[start:start + limit], total, pages


def feed_rows(conn):
    """The ten newest team solves, newest first, ties broken by team name."""
    return db.query(
        conn,
        "SELECT t.name, s.title, s.points, ts.created_at FROM team_solves ts "
        "JOIN scenarios s ON s.slug = ts.scenario_slug "
        "JOIN teams t ON t.id = ts.team_id "
        "ORDER BY ts.created_at DESC, t.name ASC LIMIT 10")


# --- certificate -------------------------------------------------------------

def certificate_for(conn, user_row):
    """A current member of a team that has solved all eight scenarios gets a
    certificate whose issued time is the moment of the team's eighth solve.
    Every other player is refused."""
    team = team_for_caller(conn, user_row)
    if team is None:
        raise errors.not_complete()
    solves = db.query(conn, "SELECT scenario_slug, created_at FROM team_solves "
                            "WHERE team_id = %s ORDER BY created_at DESC LIMIT 8",
                      (team[0],))
    if len(solves) < 8:
        raise errors.not_complete()
    display_name = user_row[2]
    return {"display_name": display_name, "team_name": team[1],
            "event_name": EVENT_NAME, "issued_on": db.time_text(solves[0][1])}


EVENT_NAME = "Strange & Unusual Activity"
