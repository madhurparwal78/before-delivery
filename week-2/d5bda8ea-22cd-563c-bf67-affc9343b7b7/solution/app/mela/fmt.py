"""Dates, times, countdowns, ordinals and plurals as Mela writes them, always in the event's own time zone."""
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def local(moment, zone):
    return moment.astimezone(ZoneInfo(zone))


def clock(moment):
    return f"{moment.hour % 12 or 12}:{moment.minute:02d} {'AM' if moment.hour < 12 else 'PM'}"


def long_date(moment):
    return f"{moment:%A}, {moment:%B} {moment.day}"


def short_date(moment):
    return f"{moment:%b} {moment.day}"


def time_range(event):
    start, end = local(event["start_at"], event["timezone"]), local(event["end_at"], event["timezone"])
    if start.date() == end.date():
        return f"{clock(start)} - {clock(end)}"
    return f"{clock(start)} - {short_date(end)}, {clock(end)}"


def row_start(event):
    """`Wed, Oct 21, 5:00 PM` in the event's zone."""
    start = local(event["start_at"], event["timezone"])
    return f"{start:%a}, {short_date(start)}, {clock(start)}"


def weekday_time(event):
    start = local(event["start_at"], event["timezone"])
    return f"{start:%a}, {clock(start)}"


def date_range(event):
    start, end = local(event["start_at"], event["timezone"]), local(event["end_at"], event["timezone"])
    if start.month == end.month:
        return f"{short_date(start)} - {end.day}"
    return f"{short_date(start)} - {short_date(end)}"


def requested(moment, zone):
    when = local(moment, zone)
    return f"{short_date(when)}, {clock(when)}"


def plural(count, word, words=None):
    return f"{count} {word if count == 1 else words or word + 's'}"


def countdown(start, end, now=None):
    """`3 days 04 hrs 12 min` a day or more ahead, `5 hrs 07 min 09 sec` closer, `Happening now`, or None once ended."""
    now = now or datetime.now(timezone.utc)
    if now >= end:
        return None
    seconds = math.floor((start - now).total_seconds())
    if seconds <= 0:
        return "Happening now"
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, secs = divmod(rest, 60)
    units = [(days, "day", "days"), (hours, "hr", "hrs"), (minutes, "min", "min")] if days else \
        [(hours, "hr", "hrs"), (minutes, "min", "min"), (secs, "sec", "sec")]
    while len(units) > 1 and units[0][0] == 0:
        units.pop(0)
    parts = [f"{value if index == 0 else f'{value:02d}'} {one if value == 1 else many}"
             for index, (value, one, many) in enumerate(units)]
    return " ".join(parts)


def ended_line(end, now=None):
    days = math.floor(((now or datetime.now(timezone.utc)) - end).total_seconds() / 86400)
    if days == 0:
        return "This event ended today."
    return f"This event ended {plural(days, 'day')} ago."


def ordinal(number):
    if 11 <= number % 100 <= 13:
        return f"{number}th"
    return f"{number}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(number % 10, 'th') }"


def names(people):
    """`Ravi Menon`, `Ravi Menon and Lena Ortiz`, `A, B and C`."""
    if len(people) <= 1:
        return "".join(people)
    return ", ".join(people[:-1]) + " and " + people[-1]
