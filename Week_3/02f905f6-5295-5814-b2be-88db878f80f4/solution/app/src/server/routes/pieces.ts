// Pieces: lists, detail, collection, guest tracking links and the read-only tracking view.
import type { PieceStatus, Tracking, User } from "../../shared/api";
import { allow } from "../auth";
import { PIECE_LABELS } from "../clock";
import { pool, tx } from "../db";
import { HttpError, notFound, type Route } from "../http";
import { newTrackingLink } from "../mail";
import { drainOutbox, enqueue } from "../outbox";
import { addHistory, currentStatus, parsePieceNumber, pieceByNumber, pieceNumberText, pieceRows, piecesOut, visibleTo, type PieceRow } from "../pieces";
import { newTrackingToken } from "./intake";

/** The piece if the user may see it, otherwise the 404. */
async function visiblePiece(user: User, raw: string): Promise<PieceRow> {
  const number = parsePieceNumber(raw);
  if (number === null) throw notFound();
  const scope = visibleTo(user);
  const [row] = await pieceRows(pool, `p.number = $${scope.params.length + 1} AND ${scope.where}`, [...scope.params, number]);
  if (!row) throw notFound();
  return row;
}

const notGuest = () => new HttpError(409, "not_a_guest_piece", "Only guest drop-offs have tracking links.");
const deadLink = () => new HttpError(404, "not_found", "This tracking link is no longer active.");

export const pieceRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/pieces",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      const scope = visibleTo(ctx.user);
      const wanted = ctx.url.searchParams.get("status");
      const now = new Date();
      const rows = (await pieceRows(pool, scope.where, scope.params)).filter((row) => !wanted || currentStatus(row, now) === wanted);
      return { status: 200, body: await piecesOut(pool, rows, now) };
    },
  },
  {
    method: "GET",
    path: "/api/pieces/:number",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      const row = await visiblePiece(ctx.user, ctx.params.number);
      return { status: 200, body: await pieceByNumber(row.number) };
    },
  },
  {
    method: "POST",
    path: "/api/pieces/:number/collect",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const row = await visiblePiece(ctx.user, ctx.params.number);
      allow(ctx.user, "owner", "tech");
      await tx(async (client) => {
        const collected = await client.query(
          "UPDATE pieces SET status = 'collected' WHERE number = $1 AND status IN ('ready', 'uncollected') RETURNING number",
          [row.number],
        );
        if (collected.rowCount === 0) {
          throw new HttpError(409, "invalid_transition", `Piece ${pieceNumberText(row.number)} is not on the pickup shelf.`);
        }
        await client.query("UPDATE tracking_links SET active = false WHERE piece_number = $1", [row.number]);
        await addHistory(client, row.number, ctx.user.name, "collected");
      });
      return { status: 200, body: await pieceByNumber(row.number) };
    },
  },
  {
    method: "POST",
    path: "/api/pieces/:number/tracking-link/revoke",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const row = await visiblePiece(ctx.user, ctx.params.number);
      allow(ctx.user, "owner");
      if (row.member_id !== null) throw notGuest();
      await tx(async (client) => {
        await client.query("UPDATE tracking_links SET active = false WHERE piece_number = $1", [row.number]);
        await addHistory(client, row.number, ctx.user.name, "tracking revoked");
      });
      return { status: 200, body: { tracking: "revoked" } };
    },
  },
  {
    method: "POST",
    path: "/api/pieces/:number/tracking-link",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const row = await visiblePiece(ctx.user, ctx.params.number);
      allow(ctx.user, "owner");
      if (row.member_id !== null) throw notGuest();
      const tracking = newTrackingToken();
      await tx(async (client) => {
        await client.query("SELECT number FROM pieces WHERE number = $1 FOR UPDATE", [row.number]);
        await client.query("UPDATE tracking_links SET active = false WHERE piece_number = $1", [row.number]);
        await client.query("INSERT INTO tracking_links (token, piece_number, active, created_at) VALUES ($1, $2, true, now())", [
          tracking.token,
          row.number,
        ]);
        await enqueue(client, newTrackingLink(row.guest_email ?? "", row.guest_name ?? "", pieceNumberText(row.number), tracking.url));
        await addHistory(client, row.number, ctx.user.name, "tracking replaced");
      });
      void drainOutbox().catch((error: Error) => console.error("outbox failed:", error.message));
      return { status: 201, body: { tracking_url: tracking.url } };
    },
  },
  {
    method: "GET",
    path: "/api/track/:token",
    auth: false,
    body: "none",
    handler: async (ctx) => {
      // Tokens are base64url (newTrackingToken); anything else is refused before the lookup.
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(ctx.params.token ?? "")) throw deadLink();
      const link = await pool.query<{ piece_number: number }>(
        "SELECT piece_number FROM tracking_links WHERE token = $1 AND active",
        [ctx.params.token],
      );
      const number = link.rows[0]?.piece_number;
      const [row] = number === undefined ? [] : await pieceRows(pool, "p.number = $1", [number]);
      if (!row) throw deadLink();
      const status: PieceStatus = currentStatus(row, new Date());
      const body: Tracking = {
        piece_number: pieceNumberText(row.number),
        status,
        status_label: PIECE_LABELS[status],
        pickup_shelf: status === "ready" || status === "uncollected" ? row.pickup_shelf : null,
      };
      return { status: 200, body };
    },
  },
];
