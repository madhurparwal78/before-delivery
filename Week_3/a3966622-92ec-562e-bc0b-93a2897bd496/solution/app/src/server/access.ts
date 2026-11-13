// Visibility decides every read; a record outside it answers exactly as one that does not exist.
import type { Role } from "../shared/types.js";
import { forbidden, notFound } from "./errors.js";
import type { InvoiceRecord, LadderReportRecord, MoveRecord, Store, UserRecord, VesselRecord } from "./store.js";

export function mayReadMove(user: UserRecord, move: MoveRecord): boolean {
  switch (user.role) {
    case "dispatcher":
    case "clerk":
      return true;
    case "agent":
      return move.agency_code === user.agency_code;
    case "pilot":
      return move.pilots_ever.includes(user.id);
  }
}

export function readableMove(store: Store, user: UserRecord, ref: string): MoveRecord {
  const move = store.moves.get(ref);
  if (!move || !mayReadMove(user, move)) throw notFound();
  return move;
}

/** Vessels: every one for dispatchers, pilots and (for role checks) the clerk; agents see their own. */
export function readableVessel(store: Store, user: UserRecord, id: string): VesselRecord {
  const vessel = store.vessels.get(id);
  if (!vessel || (user.role === "agent" && vessel.agency_code !== user.agency_code)) throw notFound();
  return vessel;
}

export function readableReport(store: Store, user: UserRecord, id: string): LadderReportRecord {
  const report = store.ladderReports.get(id);
  const move = report ? store.moves.get(report.move_ref) : null;
  if (!report || !move || !mayReadMove(user, move)) throw notFound();
  return report;
}

export function readableInvoice(store: Store, user: UserRecord, id: string): InvoiceRecord {
  const invoice = store.invoices.get(id);
  if (!invoice || !(user.role === "clerk" || (user.role === "agent" && invoice.agency_code === user.agency_code))) throw notFound();
  return invoice;
}

export function requireRole(user: UserRecord, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden();
}

/** The dispatcher, or the pilot currently assigned to the move. */
export function requireCrew(user: UserRecord, move: MoveRecord): void {
  if (user.role === "dispatcher") return;
  if (user.role === "pilot" && move.pilot_id === user.id) return;
  throw forbidden();
}
