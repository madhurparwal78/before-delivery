import { randomBytes, randomUUID } from "node:crypto";
import type { Hold, HoldPage, HoldStatus } from "../../shared/api";
import { labelOf, SHOP_ADDRESS, SIZES } from "../../shared/catalog";
import { formatDateTime, formatInstant, formatMoney, formatTime } from "../../shared/format";
import { config } from "../config";
import { pool, transaction } from "../db";
import { conflict, mailUnavailable, notFound } from "../errors";
import { MailDown, sendMail } from "../mail";
import { loadPiece } from "../pieces";
import { reply, tokenHash, type Context, type Reply } from "../pipeline";
import { periodEnd, priceAt } from "../rules/piece";
import { tagCodeOf } from "../rules/tagCode";
import { EMAIL_MESSAGE, FieldProblems, isEmail, isText, isUuid, NAME_MESSAGE } from "../validate";

export const MAIL_DOWN_COPY = "We can't send your confirmation right now. Nothing was saved — try again in a moment.";
const HOLD_ENDED = "This hold has ended.";

interface HoldRow {
  id: string;
  piece_id: string;
  tag_number: number;
  shopper_name: string;
  shopper_email: string;
  starts_at: Date;
  ends_at: Date;
  released_at: Date | null;
  ended_at: Date | null;
}

const SELECT_HOLD = "SELECT h.*, p.tag_number FROM holds h JOIN pieces p ON p.id = h.piece_id";

function holdStatus(row: Pick<HoldRow, "ends_at" | "released_at" | "ended_at">, now: Date): HoldStatus {
  if (row.released_at) return "released";
  return row.ended_at || now >= row.ends_at ? "ended" : "active";
}

const holdView = (row: HoldRow, now: Date): Hold => ({
  id: row.id,
  pieceId: row.piece_id,
  tagCode: tagCodeOf(row.tag_number),
  shopperName: row.shopper_name,
  shopperEmail: row.shopper_email,
  startsAt: formatInstant(row.starts_at),
  endsAt: formatInstant(row.ends_at),
  status: holdStatus(row, now),
});

export async function placeHold({ params, body, now }: Context): Promise<Reply> {
  const { name, email } = body;
  const problems = new FieldProblems();
  if (!isText(name, 80)) problems.add("name", NAME_MESSAGE);
  if (!isEmail(email)) problems.add("email", EMAIL_MESSAGE);
  problems.check();
  const startsAt = new Date(now.getTime() - (now.getTime() % 1000));
  const hold = await transaction(async (db) => {
    const piece = await loadPiece(db, now, params.id, true);
    if (piece.status === "on_hold") {
      const { rows } = await db.query<{ ends_at: Date }>("SELECT ends_at FROM holds WHERE piece_id = $1 AND released_at IS NULL AND ended_at IS NULL AND ends_at > $2", [piece.id, now]);
      throw conflict("hold_taken", `Someone else is holding this piece until ${formatTime(rows[0].ends_at)}.`);
    }
    if (piece.status !== "on_rail") throw conflict("not_for_sale", "This piece can't be held.");
    const endsAt = new Date(Math.min(startsAt.getTime() + config.holdSeconds * 1000, periodEnd(piece).getTime()));
    const token = randomBytes(32).toString("base64url");
    const { rows } = await db.query<HoldRow>(
      `INSERT INTO holds (id, piece_id, shopper_name, shopper_email, token_hash, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *, ${piece.tagNumber} AS tag_number`,
      [randomUUID(), piece.id, name, email, tokenHash(token), startsAt, endsAt],
    );
    try {
      await sendMail({
        to: String(email),
        subject: `Your hold at Atelier Ourlet until ${formatTime(endsAt)}`,
        text: [
          `${piece.tagCode}: ${piece.description}`,
          `${piece.brand}, size ${labelOf(SIZES, piece.size)}`,
          formatMoney(priceAt(piece, now)),
          "",
          `Held until ${formatDateTime(endsAt)}`,
          `Atelier Ourlet, ${SHOP_ADDRESS}`,
          "",
          `Your hold page: ${config.publicUrl}/h/${token}`,
        ].join("\n"),
      });
    } catch (error) {
      if (error instanceof MailDown) throw mailUnavailable(MAIL_DOWN_COPY);
      throw error;
    }
    return rows[0];
  });
  return reply(201, { hold: { id: hold.id, pieceId: hold.piece_id, startsAt: formatInstant(hold.starts_at), endsAt: formatInstant(hold.ends_at), status: "active" } });
}

export async function listHolds({ now }: Context): Promise<Reply> {
  const { rows } = await pool.query<HoldRow>(`${SELECT_HOLD} WHERE h.released_at IS NULL AND h.ended_at IS NULL AND h.ends_at > $1 ORDER BY h.ends_at`, [now]);
  return reply(200, { holds: rows.map((row) => holdView(row, now)) });
}

const holdsById = (id: string) => pool.query<HoldRow>(`${SELECT_HOLD} WHERE h.id = $1`, [id]);

export async function holdExists({ params }: Context): Promise<void> {
  if (!isUuid(params.id) || !(await holdsById(params.id)).rows.length) throw notFound();
}

export async function getHold({ params, now }: Context): Promise<Reply> {
  const { rows: [row] } = await holdsById(params.id);
  return reply(200, { hold: holdView(row, now) });
}

export async function releaseHold({ params, now }: Context): Promise<Reply> {
  const { rows } = await pool.query<HoldRow>("UPDATE holds SET released_at = $2 WHERE id = $1 AND released_at IS NULL AND ended_at IS NULL AND ends_at > $2 RETURNING id", [params.id, now]);
  if (!rows[0]) throw conflict("hold_ended", HOLD_ENDED);
  const { rows: [row] } = await holdsById(params.id);
  return reply(200, { hold: holdView(row, now) });
}

const holdsByToken = (token: string) => pool.query<HoldRow>(`${SELECT_HOLD} WHERE h.token_hash = $1`, [tokenHash(token)]);

export async function holdTokenExists({ params }: Context): Promise<void> {
  if (!(await holdsByToken(params.token)).rows.length) throw notFound();
}

async function holdPage(row: HoldRow, now: Date): Promise<HoldPage> {
  const piece = await loadPiece(pool, now, row.piece_id);
  const status = holdStatus(row, now);
  return {
    status,
    endsAt: formatInstant(row.ends_at),
    secondsLeft: status === "active" ? Math.floor((row.ends_at.getTime() - now.getTime()) / 1000) : 0,
    piece: {
      tagCode: piece.tagCode,
      description: piece.description,
      category: piece.category,
      brand: piece.brand,
      size: piece.size,
      currentPriceCents: priceAt(piece, now),
      photoUrl: piece.photos[0]?.publicUrl ?? null,
    },
    shopAddress: SHOP_ADDRESS,
  };
}

export async function holdPageByToken({ params, now }: Context): Promise<Reply> {
  const { rows: [row] } = await holdsByToken(params.token);
  return reply(200, { hold: await holdPage(row, now) });
}

export async function letHoldGo({ params, now }: Context): Promise<Reply> {
  const { rows } = await pool.query<{ id: string }>("UPDATE holds SET released_at = $2 WHERE token_hash = $1 AND released_at IS NULL AND ended_at IS NULL AND ends_at > $2 RETURNING id", [tokenHash(params.token), now]);
  if (!rows[0]) throw conflict("hold_ended", HOLD_ENDED);
  const { rows: [row] } = await holdsByToken(params.token);
  return reply(200, { hold: await holdPage(row, now) });
}
