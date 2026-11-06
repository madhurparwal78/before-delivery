// Offers answered from the emailed link, and the interpreter's own offers and assignments.
import type { MyOffer, OfferPage } from "../../shared/api.js";
import type { OfferStatus, RequestStatus } from "../../shared/domain.js";
import { audit } from "../audit.js";
import { one, pool, rows, transaction } from "../db.js";
import { derivedStatus, offerStatus, openOfferSql, staffingStatus } from "../domain/rules.js";
import { jobOf, staffedMail } from "../emails.js";
import { ApiError } from "../errors.js";
import { json, route, type AuthedCtx } from "../http.js";
import { enqueue, kickOutbox } from "../outbox.js";
import { observe } from "../sweep.js";
import { REQUEST_SELECT, refOf, requestRows, requestViews, type RequestRow } from "../views.js";
import { acceptedSeats, requesterEmails } from "./common.js";

interface OfferRow {
  id: string;
  seat_id: string;
  request_id: string;
  position: number;
  status: OfferStatus;
  expires_at: Date;
  interpreter_id: string;
  interpreter_name: string;
}

const OFFER_SELECT = `
  SELECT o.id, o.seat_id, s.request_id, s.position, o.status, o.expires_at, o.interpreter_id, u.name AS interpreter_name
  FROM offers o JOIN seats s ON s.id = o.seat_id JOIN users u ON u.id = o.interpreter_id`;

/** Offer tokens are URL-safe base64; anything else can never name an offer, so it is refused before any lookup. */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

async function findOffer(token: string | undefined): Promise<OfferRow | undefined> {
  if (!token || !TOKEN.test(token)) throw new ApiError("not_found");
  return one<OfferRow>(pool, `${OFFER_SELECT} WHERE o.token = $1`, [token]);
}

const seatTotal = async (requestId: string): Promise<number> =>
  (await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM seats WHERE request_id = $1", [requestId]))?.n ?? 1;

route("GET", "/api/offers/:token", "public", async (ctx) => {
  const offer = await findOffer(ctx.params.token);
  if (!offer) throw new ApiError("not_found");
  const [request] = await requestRows(pool, "r.id = $1", [offer.request_id]);
  if (!request) throw new ApiError("not_found");
  const page: OfferPage = {
    offer: { status: offerStatus(offer.status, offer.expires_at, new Date()), expires_at: offer.expires_at.toISOString() },
    request: {
      ref: refOf(request.ref_no),
      title: request.title,
      setting: request.setting,
      location: request.location,
      start: request.start_at.toISOString(),
      end: request.end_at.toISOString(),
      org_name: request.org_name,
    },
    seat: { position: offer.position, total: await seatTotal(offer.request_id) },
    interpreter: { name: offer.interpreter_name },
  };
  return json(200, page);
});

/** Answers an offer once: accept fills the seat and moves the request on; decline reopens the seat. */
async function answer(token: string, verdict: "accepted" | "declined"): Promise<{ ref: string; status: RequestStatus }> {
  const found = await findOffer(token);
  if (!found) throw new ApiError("not_found");
  let mailed = false;
  const result = await transaction(async (client) => {
    const request = await one<RequestRow>(client, `${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [found.request_id]);
    const offer = await one<OfferRow>(client, `${OFFER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`, [found.id]);
    if (!request || !offer) throw new ApiError("not_found");
    const now = new Date();
    const current = offerStatus(offer.status, offer.expires_at, now);
    if (current !== "active") throw new ApiError("offer_closed", { offer_status: current }, `This offer is no longer open (${current}).`);
    await client.query("UPDATE offers SET status = $2 WHERE id = $1", [offer.id, verdict]);
    const action = verdict === "accepted" ? "offer.accepted" : "offer.declined";
    const detail = { interpreter: { id: offer.interpreter_id, name: offer.interpreter_name }, seat_id: offer.seat_id };
    await audit(client, { actorId: null, action, entity: "offer", entityId: offer.id, requestId: request.id, from: "active", to: verdict, detail });
    let status = request.status;
    if (verdict === "accepted") {
      const seated = await acceptedSeats(client, request.id);
      const total = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM seats WHERE request_id = $1", [request.id]);
      status = staffingStatus(seated.length, total?.n ?? 1);
      if (status !== request.status) {
        await client.query("UPDATE requests SET status = $2 WHERE id = $1", [request.id, status]);
        await audit(client, {
          actorId: null,
          action: "request.status_changed",
          entity: "request",
          entityId: request.id,
          requestId: request.id,
          from: request.status,
          to: status,
        });
      }
      if (status === "staffed") {
        const names = seated.map((s) => s.name);
        for (const to of await requesterEmails(client, request.org_id)) await enqueue(client, staffedMail(to, jobOf(request), names));
        mailed = true;
      }
    }
    return { ref: refOf(request.ref_no), status: derivedStatus(status, request.end_at, now) };
  });
  if (mailed) kickOutbox();
  return result;
}

route("POST", "/api/offers/:token/accept", "public", async (ctx) => {
  const request = await answer(ctx.params.token ?? "", "accepted");
  return json(200, { offer: { status: "accepted" }, request });
});

route("POST", "/api/offers/:token/decline", "public", async (ctx) => {
  const request = await answer(ctx.params.token ?? "", "declined");
  return json(200, { offer: { status: "declined" }, request });
});

route("GET", "/api/interpreters/me/assignments", ["interpreter"], async (ctx: AuthedCtx) => {
  await observe();
  const offers = await rows<OfferRow & { token: string; sent_at: Date }>(
    pool,
    `SELECT o.id, o.token, o.sent_at, o.seat_id, s.request_id, s.position, o.status, o.expires_at, o.interpreter_id, ''::text AS interpreter_name
     FROM offers o JOIN seats s ON s.id = o.seat_id
     WHERE o.interpreter_id = $1 AND ${openOfferSql()} ORDER BY o.expires_at`,
    [ctx.user.id],
  );
  const offered = await requestRows(pool, "r.id = ANY($1)", [offers.map((o) => o.request_id)]);
  const totals = await rows<{ request_id: string; n: number }>(pool, "SELECT request_id, count(*)::int AS n FROM seats WHERE request_id = ANY($1) GROUP BY request_id", [
    offers.map((o) => o.request_id),
  ]);
  const mine: MyOffer[] = offers.flatMap((o) => {
    const r = offered.find((x) => x.id === o.request_id);
    if (!r) return [];
    return [
      {
        id: o.id,
        token: o.token,
        status: "active" as const,
        sent_at: o.sent_at.toISOString(),
        expires_at: o.expires_at.toISOString(),
        request: {
          id: r.id,
          ref: refOf(r.ref_no),
          title: r.title,
          setting: r.setting,
          location: r.location,
          start: r.start_at.toISOString(),
          end: r.end_at.toISOString(),
          org_name: r.org_name,
        },
        seat: { position: o.position, total: totals.find((t) => t.request_id === o.request_id)?.n ?? 1 },
      },
    ];
  });
  const assigned = await requestRows(
    pool,
    `r.status NOT IN ('cancelled_on_time', 'cancelled_late') AND EXISTS (
       SELECT 1 FROM seats s JOIN offers o ON o.seat_id = s.id WHERE s.request_id = r.id AND o.status = 'accepted' AND o.interpreter_id = $1)`,
    [ctx.user.id],
  );
  return json(200, { offers: mine, assignments: await requestViews(pool, assigned) });
});
