"""Thread, cell and board assembly. States are derived on every read from the server clock."""
from datetime import datetime

from . import rules
from .clock import format_iso
from .domain import tag_of
from .repo import person_shape



class ThreadView:
    """One thread's derived view: state, label, governing limit, rails, sign-off chain."""

    def __init__(self, thread_row, revision_rows, tails_by_registration, people_rows,
                 signatures, evidence, history, legacy, deferral, now, lineage):
        self.row = thread_row
        self.now = now
        self.revisions = {r["revision"]: r for r in revision_rows}
        self.tail = tails_by_registration[thread_row["registration"]]
        self.people = people_rows
        self.lineage = lineage
        self.signatures = signatures
        self.evidence = evidence
        self.history = history
        self.legacy = legacy
        self.deferral = deferral
        self.total_hours = float(self.tail["total_hours"])
        self.governing_revision = thread_row["pinned_revision"] or thread_row["revision"]
        self.governing_rev_row = self.revisions[self.governing_revision]

    # ---- derived state -------------------------------------------------
    @property
    def calendar_due_at(self) -> datetime:
        return rules.end_of_day(self.row["deadline_date"])

    @property
    def hours_due_at(self) -> datetime | None:
        """The hours due instant, only when logged hours are above the threshold."""
        if self.total_hours <= float(self.row["threshold"]):
            return None
        return self.row["hours_due_at"] or self.row["last_revision_change"]

    @property
    def due_at(self) -> datetime:
        hours_due = self.hours_due_at
        cal = self.calendar_due_at
        return hours_due if hours_due is not None and hours_due < cal else cal

    @property
    def overdue(self) -> bool:
        return rules.is_overdue(
            self.row["stage"], self.now, self.due_at, self.total_hours, float(self.row["threshold"]))

    @property
    def due_soon(self) -> bool:
        return rules.is_due_soon(self.row["stage"], self.now, self.due_soon_from, self.overdue)

    @property
    def due_soon_from(self) -> datetime:
        crossing = rules.due_soon_hours_crossing(
            float(self.row["threshold"]), self.total_hours, self.row["last_revision_change"])
        return rules.due_soon_instants(deadline_date=self.row["deadline_date"], crossing_log=crossing)

    @property
    def state(self) -> str:
        if self.overdue:
            return "overdue"
        if self.due_soon:
            return "due_soon"
        return self.row["stage"]

    @property
    def label(self) -> str:
        return rules.stage_label(self.row["stage"], self.state)

    @property
    def governing(self) -> str | None:
        stage = self.row["stage"]
        if stage in ("not_applicable", "withdrawn"):
            return None
        cal_passed = self.now > self.calendar_due_at
        hours_passed = rules.hours_above_threshold(self.total_hours, float(self.row["threshold"]))
        return rules.governing(
            self.row["deadline_date"], self.total_hours, float(self.row["threshold"]),
            float(self.tail["daily_utilisation"]), self.now, cal_passed, hours_passed)

    def rails(self) -> tuple[float, float]:
        return rules.rail_fractions(
            effective_date=self.governing_rev_row["effective_date"],
            calendar_due_at=self.calendar_due_at,
            now=self.now,
            baseline=float(self.row["fh_baseline"]),
            threshold=float(self.row["threshold"]),
            total_hours=self.total_hours,
        )

    def limits(self) -> dict:
        return rules.thread_limits(
            effective_date=self.governing_rev_row["effective_date"],
            calendar_days=self.governing_rev_row["calendar_days"],
            baseline=float(self.row["fh_baseline"]),
            threshold=float(self.row["threshold"]),
            deadline_date=self.row["deadline_date"],
            deferred=self.deferral is not None,
            last_log_at=self.row["last_revision_change"],
            total_hours=self.total_hours,
            hours_due_at=self.hours_due_at,
        )

    def wording(self) -> dict:
        rev = self.governing_rev_row
        return {"title": rev["title"], "method": rev["method"]}

    def _person(self, person_id):
        if person_id is None:
            return None
        return person_shape(self.people.get(person_id))

    def shape(self) -> dict:
        cal_used, hours_used = self.rails()
        rev = self.row["revision"]
        pinned = self.row["pinned_revision"]
        inspector_sig = None
        certifier_sig = None
        for sig in self.signatures:
            if sig["kind"] == "inspection" and sig["status"] != "void":
                inspector_sig = sig if inspector_sig is None else inspector_sig
            if sig["kind"] == "countersignature" and sig["status"] != "void":
                certifier_sig = sig if certifier_sig is None else certifier_sig
        assigned = self._person(self.row["certifier_id"])
        if self.row["stage"] == "inspected":
            certifier_status = "awaiting_countersignature" if assigned else "awaiting_certifier"
        else:
            certifier_status = None
        timeliness = None
        for sig in self.signatures:
            if sig["kind"] == "inspection" and sig["status"] == "valid":
                timeliness = sig["timeliness"]
                break
        return {
            "id": self.row["id"],
            "registration": self.row["registration"],
            "model": self.row["model"],
            "msn": self.row["msn"],
            "directive_id": self.row["lineage_id"],
            "directive": self._directive_label(),
            "state": self.state,
            "stage": self.row["stage"],
            "label": self.label,
            "revision": tag_of(rev),
            "pinned_revision": tag_of(pinned) if pinned else None,
            "governing_revision": tag_of(self.governing_revision),
            "governing": self.governing,
            "wording": self.wording(),
            "limits": self.limits(),
            "timeliness": timeliness,
            "work_card": self._work_card(),
            "evidence": [self._evidence_shape(e) for e in self.evidence],
            "signatures": [self._signature_shape(s) for s in self.signatures],
            "certifier": {"assigned": assigned, "status": certifier_status},
            "deferral": self._deferral_shape(),
            "history": self._history(),
            "legacy_records": [self._legacy_shape(r) for r in self.legacy],
        }

    def _directive_label(self):
        return f"{self.lineage['authority']} {self.lineage['number']}"

    def _work_card(self):
        holder = self._person(self.row["holder_id"])
        return {
            "id": self.row["card_id"],
            "holder": holder,
            "claimed_at": format_iso(self.row["claimed_at"]) if self.row["claimed_at"] else None,
        }

    def _evidence_shape(self, e):
        return {
            "id": e["id"],
            "key": e["key"],
            "sha256": e["sha256"],
            "content_type": e["content_type"],
            "bytes": e["bytes"],
            "attached_by": self._person(e["attached_by"]),
            "attached_at": format_iso(e["attached_at"]),
        }

    def _signature_shape(self, s):
        signer = self._person(s["signer_id"])
        return {
            "id": s["id"],
            "kind": s["kind"],
            "signer": signer,
            "signer_text": s["signer_text"] if s["kind"] == "legacy" else None,
            "revision": tag_of(s["revision"]),
            "committed_at": format_iso(s["committed_at"]),
            "timeliness": s["timeliness"],
            "method_ref": s["method_ref"],
            "findings": s["findings"],
            "status": s["status"],
            "void_reason": s["void_reason"],
        }

    def _deferral_shape(self):
        if self.deferral is None:
            return None
        return {
            "granted_by": self._person(self.deferral["granted_by"]),
            "granted_at": format_iso(self.deferral["granted_at"]),
            "reason": self.deferral["reason"],
        }

    def _legacy_shape(self, r):
        return {
            "status": r["status"],
            "inspected_on": r["inspected_on"].isoformat() if r["inspected_on"] else None,
            "certified_on": r["certified_on"].isoformat() if r["certified_on"] else None,
            "notes": r["notes"],
            "inspector": r["inspector_name"],
            "inspector_licence": r["inspector_licence"],
            "certifier": r["certifier_name"],
            "certifier_licence": r["certifier_licence"],
        }

    def _history(self):
        entries = []
        for entry in self.history:
            if entry["outcome"] == "current":
                limits = self.limits()
                wording = self.wording()
            else:
                rev_row = self.revisions[entry["revision"]]
                limits = rules.thread_limits(
                    effective_date=rev_row["effective_date"],
                    calendar_days=rev_row["calendar_days"],
                    baseline=float(entry["fh_baseline"]),
                    threshold=float(entry["threshold"]),
                    deadline_date=entry["deadline_date"],
                    deferred=False,
                    last_log_at=None,
                    total_hours=float(entry["fh_baseline"]),
                )
                wording = {"title": entry["title"], "method": entry["method"]}
            legacy = [self._legacy_shape(r) for r in self.legacy if r["revision"] == entry["revision"]]
            entries.append({
                "revision": tag_of(entry["revision"]),
                "entered_at": format_iso(entry["entered_at"]),
                "left_at": format_iso(entry["left_at"]) if entry["left_at"] else None,
                "limits": limits,
                "wording": wording,
                "outcome": entry["outcome"],
                "legacy_records": legacy,
            })
        return entries

    def cell(self) -> dict:
        cal_used, hours_used = self.rails()
        return {
            "thread_id": self.row["id"],
            "registration": self.row["registration"],
            "directive_id": self.row["lineage_id"],
            "state": self.state,
            "stage": self.row["stage"],
            "label": self.label,
            "revision": tag_of(self.row["revision"]),
            "pinned_revision": tag_of(self.row["pinned_revision"]) if self.row["pinned_revision"] else None,
            "governing": self.governing,
            "calendar_used": cal_used,
            "hours_used": hours_used,
            "due_at": format_iso(self.due_at),
        }

