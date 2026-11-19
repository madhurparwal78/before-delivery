"""Checks for the pure rules: locks, input forms, the calendar and escaping."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/app")

from server.event import calendar_file  # noqa: E402
from server.markup import Markup, fmt  # noqa: E402
from server.throttle import lock_end, seconds_remaining  # noqa: E402
from server.validation import (  # noqa: E402
    digits_only,
    display_name_problem,
    email_problem,
    normalise_email,
    password_problem,
    team_name_problem,
)
from support import check, report  # noqa: E402

START = datetime(2026, 10, 22, 16, 0, tzinfo=timezone.utc)


def at(seconds: int) -> datetime:
    return START + timedelta(seconds=seconds)


def wrong_flag_lock_checks() -> None:
    four = [(False, at(index)) for index in range(4)]
    check("four wrong flags do not lock", lock_end(four, 5, 60) is None)
    five = four + [(False, at(4))]
    ends = lock_end(five, 5, 60)
    check("the fifth wrong flag starts the lock", ends == at(64), ends)
    check(
        "the lock is measured from the fifth row",
        seconds_remaining(ends, at(10), 60) == 54
        and seconds_remaining(ends, at(63), 60) == 1
        and seconds_remaining(ends, at(64), 60) is None,
        [seconds_remaining(ends, at(moment), 60) for moment in (10, 63, 64)],
    )
    reset = five[:4] + [(True, at(4))]
    check("a correct flag resets the count", lock_end(reset, 5, 60) is None)
    after = five + [(False, at(70)), (False, at(71))]
    check(
        "the count starts again when the lock ends",
        lock_end(after, 5, 60) is None,
        lock_end(after, 5, 60),
    )
    again = five + [(False, at(70 + index)) for index in range(5)]
    check(
        "five more wrong flags start a new lock",
        lock_end(again, 5, 60) == at(74 + 60),
        lock_end(again, 5, 60),
    )


def sign_in_throttle_checks() -> None:
    nine = [(False, at(index)) for index in range(9)]
    check("nine failures do not lock", lock_end(nine, 10, 900) is None)
    ten = nine + [(False, at(9))]
    check("the tenth failure locks", lock_end(ten, 10, 900) == at(909))
    check(
        "retry-after counts down from the lock time",
        seconds_remaining(lock_end(ten, 10, 900), at(9), 900) == 900
        and seconds_remaining(lock_end(ten, 10, 900), at(908), 900) == 1,
    )
    success = nine + [(True, at(9))]
    check("a success resets the count", lock_end(success, 10, 900) is None)


def input_form_checks() -> None:
    check("digits only", digits_only("12") == 12)
    for raw in (
        "",
        "0",
        "01",
        "+1",
        "-1",
        "abc",
        "１",
        "٣",
        "1 ",
        "9223372036854775808",
    ):
        check(f"digits refuse {raw!r}", digits_only(raw) is None, raw)
    check(
        "the largest int64 is allowed", digits_only("9223372036854775807") is not None
    )

    check(
        "email trims and lower-cases",
        normalise_email("  ADA@Example.COM ") == "ada@example.com",
    )
    for raw in (
        "a@b",
        "no-at.example.com",
        "two@@example.com",
        "@example.com",
        "a@ b.com",
        "ab",
    ):
        check(
            f"email refuses {raw!r}",
            email_problem(normalise_email(raw)) is not None,
            raw,
        )
    check("a plain email is accepted", email_problem("ada@example.com") is None)
    check(
        "a 254 code point email is accepted",
        email_problem("a" * 242 + "@example.com") is None,
    )
    check(
        "a 255 code point email is refused",
        email_problem("a" * 243 + "@example.com") is not None,
    )

    check("a one character name is accepted", display_name_problem("A") is None)
    check(
        "a 40 emoji name is accepted", display_name_problem("\U0001f987" * 40) is None
    )
    check("a 41 code point name is refused", display_name_problem("n" * 41) is not None)
    for raw in (
        "Ada\u0000",
        "Ada\u0085",
        "\u200eAda",
        "Ada\u2066",
        "Ada\u202e",
        "Ada\u007f",
    ):
        check(f"name refuses {raw!r}", display_name_problem(raw) is not None, raw)
    check(
        "a trailing control is refused before trimming",
        display_name_problem("Ada\u0085") is not None,
    )

    check(
        "an eight character password is accepted", password_problem("12345678") is None
    )
    check(
        "a seven character password is refused", password_problem("1234567") is not None
    )
    check("a 128 character password is accepted", password_problem("p" * 128) is None)
    check(
        "a 129 character password is refused", password_problem("p" * 129) is not None
    )

    check("a team name of three is accepted", team_name_problem("abc") is None)
    check("a team name of 24 is accepted", team_name_problem("a" * 24) is None)
    check("a team name of 25 is refused", team_name_problem("a" * 25) is not None)
    check(
        "team names take spaces, hyphens and underscores",
        team_name_problem("Moth Crew-One_2") is None,
    )
    for raw in ("ab", "moth!", "móth crew", "moth\u200ecrew"):
        check(f"team name refuses {raw!r}", team_name_problem(raw) is not None, raw)


def calendar_checks() -> None:
    body = calendar_file(datetime(2026, 11, 15, 9, 8, 7, tzinfo=timezone.utc)).decode()
    lines = body.split("\r\n")[:-1]
    check(
        "every line ends with crlf",
        body.endswith("\r\n") and "\n" not in body.replace("\r\n", ""),
    )
    check(
        "one vevent",
        lines.count("BEGIN:VEVENT") == 1 and lines.count("END:VEVENT") == 1,
    )
    check("dtstamp uses the given time", "DTSTAMP:20261115T090807Z" in lines, lines)
    check(
        "the summary escapes its comma",
        "SUMMARY:Strange & Unusual Activity\\, a NightWard Downtime CTF" in lines,
        [line for line in lines if line.startswith("SUMMARY")],
    )
    folded = [line for line in lines if line.startswith(" ")]
    check("the long description is folded", folded != [], lines)
    check(
        "every line fits in 75 octets", all(len(line.encode()) <= 75 for line in lines)
    )


def markup_checks() -> None:
    rendered = fmt("<p>{}</p>", 'Ada & <Moth> "Q"')
    check(
        "values are escaped by default",
        str(rendered) == "<p>Ada &amp; &lt;Moth&gt; &quot;Q&quot;</p>",
        rendered,
    )
    check(
        "markup passes through",
        str(fmt("<p>{}</p>", Markup("<b>safe</b>"))) == "<p><b>safe</b></p>",
    )


def main() -> int:
    wrong_flag_lock_checks()
    sign_in_throttle_checks()
    input_form_checks()
    calendar_checks()
    markup_checks()
    return report()


if __name__ == "__main__":
    sys.exit(main())
