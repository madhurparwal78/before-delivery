// The owner projection (brief: API › Owner projection), decided here only: owners see staff as the
// house, and never see Kill Bill ids or who recorded a transfer.
import type { Actor, Invoice, Payment } from "../shared/api.js";
import { HOUSE_ACTOR, type Role } from "../shared/domain.js";

export interface Viewer {
  id: string;
  role: Role;
}

/** How an actor appears to the viewer. */
export function presentActor(viewer: Viewer, actor: Actor & { role: Role }): Actor {
  if (viewer.role === "owner" && actor.role !== "owner") return { ...HOUSE_ACTOR };
  return { id: actor.id, name: actor.name };
}

/** An invoice as the viewer may see it. */
export function presentInvoice(viewer: Viewer, invoice: Invoice): Invoice {
  if (viewer.role !== "owner") return invoice;
  const { killbill_invoice_id: _kb, payments, ...rest } = invoice;
  return {
    ...rest,
    payments: payments.map(({ killbill_payment_id: _id, recorded_by: _by, ...payment }): Payment => payment),
  };
}
