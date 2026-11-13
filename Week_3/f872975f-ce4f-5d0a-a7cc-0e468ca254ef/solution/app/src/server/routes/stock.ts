// Rate versions, stock on hand and the board-volume ledger.
import type { StockFigures, StockRow } from "../../shared/api";
import { boardFeet, isGrade, isSpecies, SPECIES } from "../../shared/domain";
import { pool, query } from "../db";
import { Fields, isObject, ok, requireRole, requireUser, route } from "../http";
import { iso, now, ratesInForce, scheduledRates } from "../store";

route("GET", "/api/rates", async () => {
  const at = now();
  const { rows } = await ratesInForce(pool, at);
  return ok({ rates: rows, scheduled: await scheduledRates(pool, at) });
});

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})$/;

/** An ISO 8601 timestamp that carries `Z` or a numeric offset, to the millisecond. */
function parseInstant(text: string): Date | null {
  const m = ISO_WITH_OFFSET.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = Number((frac ?? "").padEnd(3, "0").slice(0, 3));
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), ms);
  const check = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (check.getUTCMonth() !== Number(mo) - 1 || Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null;
  let offsetMin = 0;
  if (zone && zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }
  return new Date(utc - offsetMin * 60_000);
}

const WINDOW_BEFORE_MS = 60_000;
const WINDOW_AFTER_MS = 365 * 24 * 3600 * 1000;

route("PUT", "/api/rates", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "owner");
  const b = isObject(ctx.body) ? ctx.body : {};
  const at = now();
  const fields = new Fields();
  if (!isSpecies(b["species"])) fields.add("species", "Choose a species.");
  if (!isGrade(b["grade"])) fields.add("grade", "Choose a grade.");
  const cents = b["rate_cents"];
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 1 || cents > 1_000_000) {
    fields.add("rate_cents", "Enter a rate from 1 to 1000000 cents per board foot.");
  }
  let effective = at;
  if (b["effective_at"] !== undefined && b["effective_at"] !== null) {
    const parsed = typeof b["effective_at"] === "string" ? parseInstant(b["effective_at"]) : null;
    if (parsed === null || parsed.getTime() < at.getTime() - WINDOW_BEFORE_MS || parsed.getTime() > at.getTime() + WINDOW_AFTER_MS) {
      fields.add("effective_at", "Give a time with Z or an offset, from a minute ago to a year ahead.");
    } else {
      effective = parsed;
    }
  }
  fields.throwIfAny();
  await pool.query("INSERT INTO rates (species, grade, rate_cents, effective_at, created_at) VALUES ($1, $2, $3, $4, $5)",
    [b["species"], b["grade"], cents, effective, at]);
  return ok({ rate: { species: b["species"], grade: b["grade"], rate_cents: cents, effective_at: iso(effective) } });
});

interface StockSql {
  species: string;
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: number;
}

route("GET", "/api/stock", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "owner", "hand");
  const rows = await query<StockSql>(pool,
    `SELECT b.species, count(*)::int AS open_boards,
       count(*) FILTER (WHERE b.status = 'available')::int AS on_rack,
       count(*) FILTER (WHERE b.status = 'held')::int AS held,
       COALESCE(SUM(bal.v), 0)::bigint AS volume_mm3
     FROM boards b
     LEFT JOIN (SELECT account, SUM(volume_mm3) AS v FROM entries WHERE account LIKE 'board:%' GROUP BY account) bal
       ON bal.account = 'board:' || b.tag
     WHERE b.status IN ('tagged','graded','available','held') GROUP BY b.species`);
  const species: StockRow[] = SPECIES.map((name) => {
    const r = rows.find((x) => x.species === name);
    const volume = r?.volume_mm3 ?? 0;
    return { species: name, open_boards: r?.open_boards ?? 0, on_rack: r?.on_rack ?? 0, held: r?.held ?? 0, volume_mm3: volume, board_feet: boardFeet(volume) };
  });
  const sum = (k: "open_boards" | "on_rack" | "held" | "volume_mm3"): number => species.reduce((s, r) => s + r[k], 0);
  const volume = sum("volume_mm3");
  const totals: StockFigures = { open_boards: sum("open_boards"), on_rack: sum("on_rack"), held: sum("held"), volume_mm3: volume, board_feet: boardFeet(volume) };
  return ok({ species, totals });
});

interface MovementSql {
  id: number;
  kind: string;
  created_at: Date;
  ticket_id: string | null;
  by_name: string | null;
  account: string;
  volume_mm3: number;
}

route("GET", "/api/ledger", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "owner");
  const account = ctx.url.searchParams.get("account");
  const rows = await query<MovementSql>(pool,
    `SELECT m.id, m.kind, m.created_at, m.ticket_id, u.name AS by_name, e.account, e.volume_mm3
     FROM movements m LEFT JOIN users u ON u.id = m.by_user JOIN entries e ON e.movement_id = m.id
     WHERE $1::text IS NULL OR m.id IN (SELECT movement_id FROM entries WHERE account = $1)
     ORDER BY m.id, e.id`, [account]);
  const movements: { id: number; kind: string; created_at: string; ticket: string | null; by: { name: string } | null; entries: { account: string; volume_mm3: number }[] }[] = [];
  for (const r of rows) {
    let m = movements[movements.length - 1];
    if (m === undefined || m.id !== r.id) {
      m = { id: r.id, kind: r.kind, created_at: iso(r.created_at), ticket: r.ticket_id, by: r.by_name === null ? null : { name: r.by_name }, entries: [] };
      movements.push(m);
    }
    m.entries.push({ account: r.account, volume_mm3: r.volume_mm3 });
  }
  return ok({ movements });
});
