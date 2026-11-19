// What each confirmed command announces on success, from the feedback registry.

import { F, holdPlaced } from "../shared/feedback";
import type { DeskState, Offer, Receipt } from "../shared/types";
import type { CommandRequest } from "./desk";

/** The receipt outcome as the brief words it, from the server's reply and the refreshed receipts. */
function receiptCopy(offerKey: string, body: { receipt: Receipt; offer: Offer }, state: DeskState | null): string {
  if (body.offer.status === "transferred") return F.RECEIPT_DONE;
  if (body.offer.status === "disputed") return F.RECEIPT_HOLD;
  const receipts = (["dealer", "counterpart"] as const).map((party) => state?.receipts[`${offerKey}/${party}`]);
  if (!body.receipt.matches || receipts.some((r) => r && !r.matches)) return F.RECEIPT_MISMATCH;
  return F.RECEIPT_WAIT;
}

export function successCopy(request: CommandRequest, body: unknown, state: DeskState | null): string | null {
  switch (request.kind) {
    case "intake": return F.INTAKE_OK;
    case "quarantine": return F.ATTR_OK;
    case "reconcile": return F.CATALOG_OK;
    case "annotation": return F.CONDITION_OK;
    case "tray": return F.TRAY_OK;
    case "fill": return F.SET_OK;
    case "keeper": return F.KEEPER_OK;
    case "undo": return F.UNDO_OK;
    case "send": return F.OFFER_OK;
    case "hold": return holdPlaced(`Specimen ${(body as { hold: { specimen: string } }).hold.specimen}`);
    case "replace": return F.COUNTER_VOID;
    case "accept": return F.COUNTER_ACCEPT;
    case "freeze": return F.DISPATCH_OK;
    case "receipt": return receiptCopy(request.path.split("/")[2] ?? "", body as { receipt: Receipt; offer: Offer }, state);
    case "dispute": return F.DISPUTE_OPEN;
    case "propose": return F.RESOLUTION_WAIT;
    case "approve": return F.RESOLUTION_DONE;
    case "revoke-link": return F.LINK_REVOKED;
    case "mark": return F.AUDIT_MISSING;
    case "link":
    case "release":
    case "arrival":
    case "marker":
      return null;
  }
}

/** A fresh command identifier; retries and resumes reuse the original one. */
export const newCommandId = () => crypto.randomUUID();

/** A JSON command whose body carries the same command identifier the request is resent with. */
export function jsonCommand(kind: CommandRequest["kind"], method: CommandRequest["method"], path: string, fields: Record<string, unknown> = {}): CommandRequest {
  const commandId = newCommandId();
  return { kind, method, path, body: { command_id: commandId, ...fields }, commandId };
}
