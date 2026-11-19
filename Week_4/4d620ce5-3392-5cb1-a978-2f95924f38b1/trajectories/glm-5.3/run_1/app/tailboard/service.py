"""Board, directive and thread assembly for reads (DP-34, DP-36, DP-51)."""
import json

from . import rules
from .clock import clock, format_iso
from .domain import AUTHORITIES, tag_of
from .repo import Repo, directive_shape, person_shape
from .threads import ThreadView


class BoardService:
    def __init__(self, repo: Repo):
        self.repo = repo

    async def load_people(self) -> dict:
        rows = await self.repo.pool.fetch("SELECT * FROM people")
        return {row["id"]: row for row in rows}

    async def load_person_shapes(self) -> dict:
        return {
            person_id: person_shape(row)
            for person_id, row in (await self.load_people()).items()
        }

    async def load_tails(self) -> dict:
        rows = await self.repo.tails()
        return {row["registration"]: row for row in rows}

    async def thread_view(self, thread_row, people, tails, now) -> ThreadView:
        revision_rows = await self.repo.revisions_of(thread_row["lineage_id"])
        lineage = await self.repo.lineage(thread_row["lineage_id"])
        signatures = await self.repo.signatures_of(thread_row["id"])
        evidence = await self.repo.evidence_of(thread_row["id"])
        history = await self.repo.history_of(thread_row["id"])
        legacy = await self.repo.legacy_of(thread_row["id"])
        deferral = await self.repo.deferral_of(thread_row["id"])
        return ThreadView(thread_row, revision_rows, tails, people, signatures, evidence,
                          history, legacy, deferral, now, lineage)

    async def thread_by_id(self, thread_id: str) -> dict | None:
        row = await self.repo.thread(thread_id)
        if row is None:
            return None
        people = await self.load_people()
        tails = await self.load_tails()
        view = await self.thread_view(row, people, tails, clock().now())
        return view.shape()

    async def threads(self, directive_id=None, registration=None, state=None) -> list:
        if directive_id:
            rows = await self.repo.threads_of_lineage(directive_id)
        elif registration:
            rows = await self.repo.pool.fetch(
                """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
                   FROM threads t JOIN work_cards w ON w.thread_id = t.id
                   JOIN tails tm ON tm.registration = t.registration
                   WHERE t.registration = $1 ORDER BY t.lineage_id""", registration)
        else:
            rows = await self.repo.pool.fetch(
                """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
                   FROM threads t JOIN work_cards w ON w.thread_id = t.id
                   JOIN tails tm ON tm.registration = t.registration
                   ORDER BY t.lineage_id, t.registration""")
        people = await self.load_people()
        tails = await self.load_tails()
        now = clock().now()
        views = []
        for row in rows:
            view = await self.thread_view(row, people, tails, now)
            if state is None or view.state == state or view.label.lower() == state:
                views.append(view.shape())
        return views

    async def directives(self) -> list:
        lineages = await self.repo.lineages()
        by_name = await self.load_person_shapes()
        shaped = []
        for lineage in lineages:
            revisions = await self.repo.revisions_of(lineage["id"])
            shaped.append(directive_shape(lineage, revisions, by_name))
        return shaped

    async def board(self, directive_id=None, as_of=None) -> dict:
        """The fleet board: directives in rail order, one column per directive, one row per tail."""
        now = clock().now()
        people = await self.load_people()
        tails = await self.load_tails()
        lineages = await self.repo.lineages()
        directives_out = []
        cells_out = []
        totals = rules.empty_counts()

        if directive_id:
            lineages = [row for row in lineages if row["id"] == directive_id]
        order = {authority: index for index, authority in enumerate(AUTHORITIES)}
        lineages = sorted(lineages, key=lambda row: (order.get(row["authority"], 99), row["number"]))

        for lineage in lineages:
            revisions = await self.repo.revisions_of(lineage["id"])
            rev_map = {r["revision"]: r for r in revisions}
            snapshot = None
            if as_of is not None:
                snap_row = await self.repo.pool.fetchrow(
                    "SELECT payload FROM snapshots WHERE lineage_id = $1 AND revision = $2",
                    *(lineage["id"], int(as_of[1:])))
                if snap_row is None:
                    return None
                snapshot = json.loads(snap_row["payload"])

            if snapshot is not None:
                column_counts = snapshot["counts"]
                cells = snapshot["cells"]
                for cell in cells:
                    cells_out.append(cell)
                for bucket in totals:
                    totals[bucket] += column_counts.get(bucket, 0)
            else:
                thread_rows = await self.repo.threads_of_lineage(lineage["id"])
                states = []
                cells = []
                for thread_row in thread_rows:
                    view = await self.thread_view(thread_row, people, tails, now)
                    cell = view.cell()
                    cell["directive_id"] = lineage["id"]
                    cells.append(cell)
                    states.append((thread_row["stage"], view.state))
                column_counts = rules.counts_from_states(states)
                cells_out.extend(cells)
                for bucket, value in column_counts.items():
                    totals[bucket] += value

            prior_tags = [tag_of(r["revision"]) for r in revisions if r["revision"] != lineage["revision"]]
            current_rev = rev_map[lineage["revision"]]
            directives_out.append({
                "id": lineage["id"],
                "authority": lineage["authority"],
                "number": lineage["number"],
                "title": current_rev["title"],
                "revision": lineage["revision"],
                "status": lineage["status"],
                "prior_revisions": prior_tags,
                "counts": column_counts,
                "tag": tag_of(lineage["revision"]),
            })

        tails_out = [{
            "registration": row["registration"],
            "model": row["model"],
            "msn": row["msn"],
            "total_hours": float(row["total_hours"]),
            "daily_utilisation": float(row["daily_utilisation"]),
        } for row in (await self.repo.tails())]

        return {
            "generated_at": format_iso(now),
            "as_of": as_of,
            "directives": directives_out,
            "tails": tails_out,
            "cells": cells_out,
            "totals": totals,
        }

    async def search(self, query: str) -> list:
        """Search directives, threads and people by the published fields."""
        query = query.strip().lower()
        if len(query) < 2:
            return []
        results = []
        lineages = await self.repo.lineages()
        people = await self.load_people()
        for lineage in lineages:
            revisions = await self.repo.revisions_of(lineage["id"])
            current = revisions[-1]
            label = f"{lineage['authority']} {lineage['number']}"
            norm = _normalise_directive(label)
            if query in label.lower() or query in norm or query in current["title"].lower():
                results.append({
                    "type": "directive",
                    "id": lineage["id"],
                    "label": f"{label} {tag_of(lineage['revision'])} {current['title']}",
                    "revision": tag_of(lineage["revision"]),
                })
        thread_rows = await self.repo.pool.fetch(
            """SELECT t.id, t.registration, t.lineage_id, t.revision FROM threads t""")
        tail_query = query.replace("-", "").replace(" ", "").upper()
        for thread in thread_rows:
            if tail_query in _normalise_tail(thread["registration"]):
                lineage = await self.repo.lineage(thread["lineage_id"])
                label = f"{thread['registration']} {lineage['authority']} {lineage['number']} {tag_of(lineage['revision'])}"
                results.append({
                    "type": "thread",
                    "id": thread["id"],
                    "label": label,
                    "revision": tag_of(lineage["revision"]),
                })
        for person_id, person in people.items():
            if person["username"] is None:
                continue
            name = person["display_name"]
            licence = person["licence"]
            if query in name.lower() or (licence and query in licence.lower()):
                label = name if person["erased"] or not licence else f"{name} {licence}"
                results.append({
                    "type": "person",
                    "id": person_id,
                    "label": label,
                    "revision": None,
                })
        return results[:50]


def _normalise_tail(registration: str) -> str:
    return registration.replace("-", "").replace(" ", "").upper()


def _normalise_directive(number: str) -> str:
    return number.replace(" ", "-").upper()
