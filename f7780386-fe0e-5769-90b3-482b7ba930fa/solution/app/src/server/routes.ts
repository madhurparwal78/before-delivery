// Every API route the brief names, with who may call it and how its body is read.

import { adjustHours, buyPack, getInvoice, listInvoices, listMembers, me, readLedger, renameBusiness, reverseTransaction, signIn, signOut } from "./accounts.js";
import { billingState } from "./billing.js";
import { cancelBooking, checkIn, confirmHold, getBooking, listBookings, waiveFee } from "./bookings.js";
import { approveDocument, documentFile, getDocument, listDocumentsFor, rejectDocument, uploadDocument } from "./documents.js";
import { compile, json, type BodyKind, type CompiledRoute, type Reply, type Request } from "./http.js";
import { board, placeHold, releaseHold, resizeHold } from "./holds.js";
import { kitchenJson } from "./kitchen.js";
import { createPacket, listPackets, publicPacket, publicPacketPdf, regeneratePacket, revokePacket } from "./packets.js";
import { dailyUsage, usageCsv } from "./reports.js";
import type { SessionUser } from "./sessions.js";

export type Endpoint =
  | { access: "public"; body: BodyKind; handle: (req: Request) => Promise<Reply> }
  | { access: "session"; body: BodyKind; handle: (req: Request, user: SessionUser) => Promise<Reply> };

const open = (handle: (req: Request) => Promise<Reply>): Endpoint => ({ access: "public", body: "json", handle });
const signedIn = (handle: (req: Request, user: SessionUser) => Promise<Reply>, body: BodyKind = "json"): Endpoint => ({ access: "session", body, handle });

export function apiRoutes(holdSeconds: number): CompiledRoute<Endpoint>[] {
  return [
    compile("/api/health", { GET: open(async () => json(200, { status: "ok" })) }),
    compile("/api/session", { POST: open(signIn), DELETE: signedIn(signOut) }),
    compile("/api/me", { GET: signedIn(me) }),
    compile("/api/members", { GET: signedIn(listMembers) }),
    compile("/api/members/me", { PATCH: signedIn(renameBusiness) }),
    compile("/api/kitchen", { GET: signedIn(async () => json(200, kitchenJson(holdSeconds, billingState()))) }),
    compile("/api/board", { GET: signedIn(board) }),
    compile("/api/holds", { POST: signedIn((req, user) => placeHold(req, user, holdSeconds)) }),
    compile("/api/holds/:id", { PATCH: signedIn(resizeHold), DELETE: signedIn(releaseHold) }),
    compile("/api/holds/:id/confirm", { POST: signedIn(confirmHold) }),
    compile("/api/bookings", { GET: signedIn(listBookings) }),
    compile("/api/bookings/:id", { GET: signedIn(getBooking) }),
    compile("/api/bookings/:id/cancel", { POST: signedIn(cancelBooking) }),
    compile("/api/bookings/:id/waive-fee", { POST: signedIn(waiveFee) }),
    compile("/api/bookings/:id/check-ins", { POST: signedIn(checkIn) }),
    compile("/api/ledger", { GET: signedIn(readLedger) }),
    compile("/api/ledger/adjustments", { POST: signedIn(adjustHours) }),
    compile("/api/ledger/transactions/:id", {}),
    compile("/api/ledger/transactions/:id/reverse", { POST: signedIn(reverseTransaction) }),
    compile("/api/packs/:pack_id/purchase", { POST: signedIn(buyPack) }),
    compile("/api/invoices", { GET: signedIn(listInvoices) }),
    compile("/api/invoices/:id", { GET: signedIn(getInvoice) }),
    compile("/api/documents", { GET: signedIn(listDocumentsFor), POST: signedIn(uploadDocument, "multipart") }),
    compile("/api/documents/:id", { GET: signedIn(getDocument) }),
    compile("/api/documents/:id/file", { GET: signedIn(documentFile) }),
    compile("/api/documents/:id/approve", { POST: signedIn(approveDocument) }),
    compile("/api/documents/:id/reject", { POST: signedIn(rejectDocument) }),
    compile("/api/usage", { GET: signedIn(dailyUsage) }),
    compile("/api/exports/usage.csv", { GET: signedIn(usageCsv) }),
    compile("/api/packets", { GET: signedIn(listPackets), POST: signedIn(createPacket) }),
    compile("/api/packets/:id/revoke", { POST: signedIn(revokePacket) }),
    compile("/api/packets/:id/regenerate", { POST: signedIn(regeneratePacket) }),
    compile("/api/packet/:token", { GET: open(publicPacket) }),
    compile("/api/packet/:token/pdf", { GET: open(publicPacketPdf) }),
  ];
}
