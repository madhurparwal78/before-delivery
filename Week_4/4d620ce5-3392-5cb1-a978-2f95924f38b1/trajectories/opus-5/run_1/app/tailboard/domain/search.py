"""Fleet search over directives, threads and people."""

from . import people as people_rules
from .directives import load_directives, normalise_number, tag_of
from .imports import normalise_tail

LIMIT = 50


def run(cursor, query):
    needle = query.lower()
    results = []
    directives = load_directives(cursor)
    for directive in directives.values():
        current = directive["revisions"][directive["current_revision"]]
        tag = tag_of(directive["current_revision"])
        haystacks = [
            directive["number"].lower(),
            normalise_number(directive["number"]).lower(),
            current["title"].lower(),
            f"{directive['authority']} {directive['number']}".lower(),
        ]
        if any(needle in value for value in haystacks):
            results.append(
                {
                    "type": "directive",
                    "id": directive["id"],
                    "label": (
                        f"{directive['authority']} {directive['number']} {tag} {current['title']}"
                    ),
                    "revision": tag,
                }
            )

    rows = cursor.all(
        """SELECT t.id, t.registration, t.directive_id,
                  ARRAY(SELECT COALESCE(l.notes, '') FROM legacy_records l
                         WHERE l.thread_id = t.id) AS notes
             FROM threads t ORDER BY t.registration"""
    )
    for row in rows:
        directive = directives[row["directive_id"]]
        tag = tag_of(directive["current_revision"])
        haystacks = [
            row["registration"].lower(),
            normalise_tail(row["registration"]).lower(),
            *[note.lower() for note in row["notes"]],
        ]
        if any(needle in value for value in haystacks):
            results.append(
                {
                    "type": "thread",
                    "id": row["id"],
                    "label": (
                        f"{row['registration']} {directive['authority']} "
                        f"{directive['number']} {tag}"
                    ),
                    "revision": tag,
                }
            )

    for row in people_rules.load_people(cursor).values():
        if row["is_system"]:
            continue
        person = people_rules.person(row)
        label = person["display_name"]
        if person["licence"]:
            label = f"{label} {person['licence']}"
        if needle in label.lower():
            results.append(
                {"type": "person", "id": row["id"], "label": label, "revision": None}
            )
    return results[:LIMIT]
