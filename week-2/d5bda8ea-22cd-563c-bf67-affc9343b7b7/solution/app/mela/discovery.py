"""Upcoming public events by city, category and community, and the counts derived from them."""
from .domain import CATEGORIES, CITIES, CITY_NAMES, CATEGORY_NAMES

LISTING = """
SELECT e.slug, e.name, e.start_at, e.end_at, e.timezone, e.city, e.venue_name, e.theme, e.categories
FROM events e
WHERE e.visibility = 'public' AND e.end_at > now()
"""


def upcoming(conn, calendar_id=None, multi_day=False):
    """Upcoming public events, soonest first; private and ended events never appear."""
    sql, params = LISTING, []
    if calendar_id is not None:
        sql += " AND e.calendar_id = %s"
        params.append(calendar_id)
    if multi_day:
        sql += " AND (e.start_at AT TIME ZONE e.timezone)::date < (e.end_at AT TIME ZONE e.timezone)::date"
    return conn.execute(sql + " ORDER BY e.start_at, e.id", params).fetchall()


def matches(event, place=None, category=None):
    """Whether an event is in the city slug `place` and the category slug `category` (None matches all)."""
    in_place = place is None or event["city"].strip().lower() == CITY_NAMES[place].lower()
    return in_place and (category is None or category in event["categories"])


def known_filters(place, category):
    """Whether the city and category slugs (None for no filter) are ones Mela knows."""
    return (place is None or place in CITY_NAMES) and (category is None or category in CATEGORY_NAMES)


def counts(events):
    """Event counts for the six cities and the twelve categories, in tile order."""
    places = [{"slug": slug, "name": name, "event_count": sum(matches(e, place=slug) for e in events)}
              for slug, name in CITIES]
    categories = [{"slug": slug, "name": name, "tint": tint,
                   "event_count": sum(matches(e, category=slug) for e in events)}
                  for slug, name, tint in CATEGORIES]
    return places, categories


def filter_label(place, category):
    if place and category:
        return f"{CATEGORY_NAMES[category]} in {CITY_NAMES[place]}"
    if place or category:
        return CITY_NAMES[place] if place else CATEGORY_NAMES[category]
    return "All cities"
