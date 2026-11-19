"""Fleet search over directives, threads and people (brief: Search)."""

import re

from . import rules, views
from .errors import invalid

LIMIT = 50


def _compact(text: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", text.upper())


async def search(conn, q: str | None) -> list[dict]:
    if not isinstance(q, str) or not 2 <= len(q) <= 100:
        raise invalid({"q": "Search for 2 to 100 characters."})
    needle, compact = q.strip().lower(), _compact(q)
    fleet = await views.load_fleet(conn)

    def hit(*texts: str | None, normalised: tuple[str, ...] = ()) -> bool:
        return (any(t and needle in t.lower() for t in texts)
                or bool(compact) and any(compact in _compact(n) for n in normalised))

    results = []
    for did in fleet.order:
        d = fleet.directives[did]
        title = d["revisions"][d["current_revision"]]["title"]
        if hit(d["number"], title, normalised=(d["number"],)):
            current = rules.tag(d["current_revision"])
            results.append({"type": "directive", "id": did, "label": f"{views.directive_name(d)} {current} {title}",
                            "revision": current})
    for u in fleet.people.values():
        if hit(u["display_name"], u["licence"]):
            label = " ".join(x for x in (u["display_name"], u["licence"], f"· {rules.ROLE_LABELS[u['role']]}") if x)
            results.append({"type": "person", "id": u["id"], "label": label, "revision": None})
    registrations = [r for r in fleet.tails if hit(r, normalised=(r,))]
    noted = [r["thread_id"] for r in await conn.fetch(
        "SELECT DISTINCT thread_id FROM legacy_records WHERE strpos(lower(notes), $1) > 0", needle)]
    rows = await conn.fetch(
        "SELECT * FROM threads WHERE registration = ANY($1) OR id = ANY($2) ORDER BY id = ANY($2) DESC, registration "
        "LIMIT $3", registrations, noted, LIMIT)
    for t in rows:
        d = fleet.directives[t["directive_id"]]
        s = views.status(fleet, t)
        current = rules.tag(d["current_revision"])
        results.append({"type": "thread", "id": t["id"],
                        "label": f"{t['registration']} {views.directive_name(d)} {current}: {s['label']}",
                        "revision": current})
    return results[:LIMIT]
