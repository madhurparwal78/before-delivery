// Notices: each listed state change records one pending notice; the step worker sends it once.
// No notice carries a pilot's rest figures, a rest-override reason or a dispatcher note.
import { signedMetres } from "../../shared/numerals.js";
import { DEFECTS } from "../../shared/types.js";
import type { LadderReportRecord, MoveRecord, PhotoRecord, Store } from "../store.js";

const HARBOUR_AUTHORITY = "harbourmaster@port-ansell.example";

const boardingText = (move: MoveRecord): string => `${move.boarding_at.replace("T", " ")} port time`;

function record(
  store: Store,
  move: MoveRecord,
  kind: string,
  to: string[],
  subject: string,
  lines: string[],
  photoIds: string[] = [],
): void {
  const seq = store.next("notice");
  store.notices.put({
    id: `NT-${seq}`,
    seq,
    move_ref: move.ref,
    kind,
    to,
    subject,
    body: [...lines, "", "Ebbstone Marine pilot station, Port Ansell"].join("\n"),
    photo_ids: photoIds,
    state: "pending",
  });
}

const agentOf = (store: Store, move: MoveRecord): string => store.agencies.get(move.agency_code)?.agent_email ?? "";
const pilotAddress = (store: Store, pilotId: string): string => store.users.get(pilotId)?.email ?? "";

export function orderConfirmation(store: Store, move: MoveRecord, pilotName: string): void {
  record(store, move, "Order confirmation", [agentOf(store, move)], `Pilot order confirmed: ${move.vessel.name}`, [
    `Move: ${move.ref}`,
    `Vessel: ${move.vessel.name}`,
    `Boarding: ${boardingText(move)}`,
    `Pilot: ${pilotName}`,
  ]);
}

export function assignmentNotice(store: Store, move: MoveRecord, pilotId: string): void {
  const committed = move.committed;
  record(store, move, "Assignment notice", [pilotAddress(store, pilotId)], `Assignment: ${move.vessel.name} ${boardingText(move)}`, [
    `Move: ${move.ref}`,
    `Vessel: ${move.vessel.name}`,
    `Boarding: ${boardingText(move)}`,
    committed ? `Pinch: ${committed.pinch_waypoint}, margin ${signedMetres(committed.margin_mm)} m` : "Pinch: not committed",
  ]);
}

export function orderAmended(store: Store, move: MoveRecord): void {
  record(store, move, "Order amended", [agentOf(store, move)], `Pilot order amended: ${move.vessel.name}`, [
    `Move: ${move.ref}`,
    `Vessel: ${move.vessel.name}`,
    `Boarding: ${boardingText(move)}`,
    `Status: ${move.status}`,
  ]);
}

export function orderCancelled(store: Store, move: MoveRecord): void {
  record(store, move, "Order cancelled", [agentOf(store, move)], `Pilot order cancelled: ${move.vessel.name}`, [
    `Move: ${move.ref}`,
    `Vessel: ${move.vessel.name}`,
    `Boarding: ${boardingText(move)}`,
    `Status: ${move.status}`,
  ]);
}

export function assignmentWithdrawn(store: Store, move: MoveRecord, pilotId: string): void {
  record(store, move, "Assignment withdrawn", [pilotAddress(store, pilotId)], `Assignment withdrawn: ${move.vessel.name}`, [
    `Move: ${move.ref}`,
    `Vessel: ${move.vessel.name}`,
    `Boarding: ${boardingText(move)}`,
  ]);
}

export function ladderNotice(store: Store, move: MoveRecord, report: LadderReportRecord, photos: PhotoRecord[]): void {
  const defects = report.defects.map((code) => `- ${DEFECTS.find((d) => d.code === code)?.name ?? code} (${code})`);
  record(
    store,
    move,
    "Ladder notice",
    [agentOf(store, move), HARBOUR_AUTHORITY],
    `Non-compliant boarding ladder: ${move.vessel.name}`,
    [
      `Move: ${move.ref}`,
      `Vessel: ${move.vessel.name}`,
      `Report: ${report.id}`,
      `Boarding refused: ${report.refused ? "yes" : "no"}`,
      "Defects:",
      ...defects,
      photos.length ? "Photos (SHA-256):" : "Photos: none",
      ...photos.map((p, i) => `- Photo ${i + 1}: ${p.sha256}`),
    ],
    photos.map((p) => p.id),
  );
}
