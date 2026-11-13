// The Move shape for one reader: private fields go only to dispatchers and the assigned pilot.
import { draughtMetres, feetText } from "../shared/numerals.js";
import { portStamp } from "../shared/portTime.js";
import type { Move } from "../shared/types.js";
import { billingView, pricedBy } from "./domain/billing.js";
import { detained, detentionSeconds, noticeOf } from "./domain/moveClock.js";
import { actionsFor } from "./domain/moveRules.js";
import type { MoveRecord, Store, UserRecord } from "./store.js";

export function moveView(store: Store, viewer: UserRecord, move: MoveRecord, now = Date.now()): Move {
  const pilot = move.pilot_id ? store.pilots.get(move.pilot_id) : null;
  const view: Move = {
    ref: move.ref,
    version: move.version,
    status: move.status,
    detained: detained(move),
    agency_code: move.agency_code,
    vessel: move.vessel,
    draught_mm: move.draught_mm,
    draught: { metres: draughtMetres(move.draught_mm), feet: feetText(move.draught_mm) },
    speed_kn: move.speed_kn,
    duty_minutes: move.duty_minutes,
    boarding_at: move.boarding_at,
    committed: move.committed,
    pilot: pilot ? { id: pilot.id, name: pilot.name } : null,
    notice: noticeOf(move, now),
    server_now: portStamp(now),
    late_amendments: move.late_amendments,
    detention: { open: detained(move), seconds: detentionSeconds(move, now) },
    notices: store.notices
      .by("move_ref", move.ref)
      .sort((a, b) => a.seq - b.seq)
      .map((n) => ({ kind: n.kind, to: n.to.join(", "), state: n.state })),
    ...billingView(store, move.ref),
    ladder_reports: move.ladder_reports,
    history: move.history,
    priced_by: pricedBy(store, move),
    actions: actionsFor(move, viewer),
  };
  if (viewer.role === "dispatcher" || (viewer.role === "pilot" && viewer.id === move.pilot_id)) {
    view.dispatcher_notes = move.dispatcher_notes;
  }
  if (viewer.role === "dispatcher") view.rest_override = move.rest_override;
  return view;
}
