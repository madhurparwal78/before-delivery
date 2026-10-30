"""The featured schedule. One piece to a UTC day."""
from .. import timeutil
from ..db import row, rows
from ..errors import Refusal


def book(conn, piece, day):
    landed = row(
        conn,
        "insert into schedule_slots (day, piece_id, view_count) values (%s, %s, 0)"
        " on conflict (day) do nothing returning day",
        (day, piece["id"]),
    )
    if landed is None:
        raise Refusal(
            409,
            "{} already has a featured piece".format(timeutil.day_text(day)),
        )


def free(conn, piece_id):
    conn.execute("delete from schedule_slots where piece_id = %s", (piece_id,))


def day_of(conn, piece_id):
    found = row(conn, "select day from schedule_slots where piece_id = %s", (piece_id,))
    return found["day"] if found else None


def check_day_arrived(conn, piece_id):
    day = day_of(conn, piece_id)
    if day > timeutil.today():
        raise Refusal(409, "{} has not arrived yet".format(timeutil.day_text(day)))


def slot_for_day(conn, day):
    return row(
        conn,
        "select s.day, s.view_count, p.id, p.title, p.state from schedule_slots s"
        " join pieces p on p.id = s.piece_id where s.day = %s",
        (day,),
    )


def month(conn, start, end):
    return rows(
        conn,
        "select s.day, s.view_count, p.id, p.title, p.state from schedule_slots s"
        " join pieces p on p.id = s.piece_id where s.day >= %s and s.day < %s"
        " order by s.day",
        (start, end),
    )


def shape(slot):
    return {
        "day": timeutil.day_text(slot["day"]),
        "piece": {"id": slot["id"], "title": slot["title"], "state": slot["state"]},
        "view_count": slot["view_count"],
    }


def count_visit(conn, piece_id):
    conn.execute(
        "update schedule_slots set view_count = view_count + 1 where piece_id = %s",
        (piece_id,),
    )
