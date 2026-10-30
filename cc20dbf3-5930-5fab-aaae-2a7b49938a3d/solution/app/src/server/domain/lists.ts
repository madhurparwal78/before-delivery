// Paged holds and loans lists: keyset cursors over (timestamp, id), newest first. A cursor marks a
// position and nothing else; it is signed with a secret kept in PostgreSQL so every copy accepts it and
// an altered one is refused. The caller's own-records rule is applied on every page.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { HoldPage, LoanPage, User } from "../../shared/api.js";
import { FIELD_COPY } from "../../shared/copy.js";
import { pool } from "../db.js";
import { FieldErrors } from "../http/errors.js";
import { HOLD_SELECT, holdJson, type HoldRow, isUuid, LOAN_SELECT, loansJson, type LoanRow, ownerFilter } from "./records.js";
import { holdStatusSql, loanStatusSql } from "./status.js";

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

type ListKind = "holds" | "loans";

let secret: Buffer | undefined;

export async function loadCursorSecret(): Promise<void> {
  const found = await pool.query<{ value: string }>("SELECT value FROM app_secret WHERE name = 'signing'");
  const value = found.rows[0]?.value;
  if (!value) throw new Error("signing secret is missing");
  secret = Buffer.from(value, "base64url");
}

function mac(payload: string): Buffer {
  if (!secret) throw new Error("signing secret is not loaded");
  return createHmac("sha256", secret).update(payload).digest();
}

function encodeCursor(kind: ListKind, at: Date, id: string): string {
  const payload = Buffer.from(JSON.stringify([kind, at.toISOString(), id])).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

function decodeCursor(kind: ListKind, cursor: string): { at: Date; id: string } | null {
  const [payload = "", signature = "", extra] = cursor.split(".");
  if (extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3 || value[0] !== kind || !isUuid(value[2])) return null;
    const at = new Date(String(value[1]));
    return Number.isNaN(at.getTime()) ? null : { at, id: value[2] };
  } catch {
    return null;
  }
}

interface Paging {
  limit: number;
  after: { at: Date; id: string } | null;
  status: string | null;
}

function parsePaging(kind: ListKind, query: URLSearchParams): Paging {
  const fields = new FieldErrors();
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? PAGE_DEFAULT : /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  if (!(limit >= 1 && limit <= PAGE_MAX)) fields.add("limit", FIELD_COPY.limit);
  const rawCursor = query.get("cursor");
  const after = rawCursor === null ? null : decodeCursor(kind, rawCursor);
  if (rawCursor !== null && !after) fields.add("cursor", FIELD_COPY.cursor);
  fields.throwIfAny();
  return { limit, after, status: query.get("status") };
}

export async function holdPage(user: User, now: Date, query: URLSearchParams): Promise<HoldPage> {
  const paging = parsePaging("holds", query);
  const found = await pool.query<HoldRow>(
    `${HOLD_SELECT}
     WHERE ($2::text IS NULL OR h.member_id = $2)
       AND ($3::text IS NULL OR ${holdStatusSql()} = $3)
       AND ($4::timestamptz IS NULL OR (h.created_at, h.id) < ($4, $5::uuid))
     ORDER BY h.created_at DESC, h.id DESC LIMIT $6`,
    [now, ownerFilter(user), paging.status, paging.after?.at ?? null, paging.after?.id ?? null, paging.limit + 1],
  );
  const rows = found.rows.slice(0, paging.limit);
  const last = rows.at(-1);
  return {
    holds: rows.map(holdJson),
    next_cursor: found.rows.length > paging.limit && last ? encodeCursor("holds", last.created_at, last.id) : null,
  };
}

export async function loanPage(user: User, now: Date, query: URLSearchParams): Promise<LoanPage> {
  const paging = parsePaging("loans", query);
  const found = await pool.query<LoanRow>(
    `${LOAN_SELECT}
     WHERE ($2::text IS NULL OR l.member_id = $2)
       AND ($3::text IS NULL OR ${loanStatusSql()} = $3)
       AND ($4::timestamptz IS NULL OR (l.checked_out_at, l.id) < ($4, $5::uuid))
     ORDER BY l.checked_out_at DESC, l.id DESC LIMIT $6`,
    [now, ownerFilter(user), paging.status, paging.after?.at ?? null, paging.after?.id ?? null, paging.limit + 1],
  );
  const rows = found.rows.slice(0, paging.limit);
  const last = rows.at(-1);
  return {
    loans: await loansJson(pool, rows),
    next_cursor: found.rows.length > paging.limit && last ? encodeCursor("loans", last.checked_out_at, last.id) : null,
  };
}
