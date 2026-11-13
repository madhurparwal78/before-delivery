// Regulator packs: the document format, preview, submission, storage and
// mail. A pack ends either stored and mailed, or neither.
import pg from "pg";
import { createHash } from "node:crypto";
import { capVolumeMl, effectiveCapMlDay } from "../shared/domain.ts";
import { formatInstant, districtDate, parseDistrictDate, windowLabel } from "../shared/district-time.ts";
import { ApiError, fieldErrors } from "./errors.ts";
import { Store } from "./store.ts";

export const REGULATOR_EMAIL = "returns@regulator.example";

// --- the pack document (one place) -------------------------------------------

export async function buildPackDocument(
  store: Store,
  from: string,
  to: string,
  signatory: string,
): Promise<string> {
  const fromMs = parseDistrictDate(from);
  const toMs = parseDistrictDate(to);
  if (fromMs === null || toMs === null) throw new ApiError(500, "pack_error", "Period is invalid.");
  // windows whose opening falls on those district dates
  const windows = await store.query<{
    id: string; channel_id: string; channel_name: string; rail_order: number; opens_at: Date; hours: number;
    table_cap: string; restriction_cap: string | null; restriction_eff: Date | null;
    cap_volume_ml: string; committed_ml: string; delivered_ml: string;
  }>(
    `SELECT w.id, w.channel_id, c.name AS channel_name, c.rail_order, w.opens_at, w.hours,
       w.restriction_cap_ml_day AS restriction_cap, w.restriction_effective_at AS restriction_eff,
       w.committed_ml, w.delivered_ml,
       (SELECT cc.cap_ml_day FROM capacity_cells cc JOIN capacity_revisions r ON r.id = cc.revision_id
        WHERE cc.window_id = w.id ORDER BY r.revision DESC, r.id DESC LIMIT 1) AS table_cap
     FROM windows w JOIN channels c ON c.id = w.channel_id ORDER BY c.rail_order, w.opens_at`,
  );

  const lines: string[] = [`Wirrinbah Water Trust delivery pack ${from} to ${to}`];
  const covered = windows.rows.filter((w) => {
    const local = districtDate(w.opens_at.getTime());
    return local >= from && local <= to;
  });
  for (const w of covered) {
    const label = windowLabelForPack(w.opens_at.getTime(), w.hours);
    const effCap = effectiveCapMlDay(w.table_cap ?? "0.000", w.restriction_cap);
    const capVol = capVolumeMl(w.table_cap ?? "0.000", w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
    lines.push(
      `WINDOW ${w.id} ${w.channel_name} | ${label} | cap ${effCap} ML/day | volume ${capVol} ML | committed ${w.committed_ml} ML | delivered ${w.delivered_ml} ML` +
        (w.restriction_cap !== null ? ` | restricted ${w.restriction_cap} ML/day from ${formatInstant(w.restriction_eff!.getTime())}` : ""),
    );
    // spent strokes of this window, ordered by confirmation
    const strokes = await store.query<{ turnout: string; kind: string; from_ml_day: string; to_ml_day: string; stroke_operator: string; stroke_committed_at: Date }>(
      `SELECT turnout, kind, from_ml_day, to_ml_day, stroke_operator, stroke_committed_at FROM gate_cards
       WHERE window_id = $1 AND state = 'spent' AND stroke_committed_at IS NOT NULL
       ORDER BY stroke_confirmed_at, id`,
      [w.id],
    );
    for (const s of strokes.rows) {
      lines.push(
        `STROKE ${s.turnout} ${s.kind} ${s.from_ml_day} -> ${s.to_ml_day} ML/day | operator ${s.stroke_operator} | ${formatInstant(s.stroke_committed_at.getTime())}`,
      );
    }
  }
  lines.push(`Signed by ${signatory} for Wirrinbah Water Trust`);
  return lines.map((l) => `${l}\n`).join("");
}

// window label from stored opens_at/hours
function windowLabelForPack(opensAtMs: number, hours: number): string {
  return windowLabel(opensAtMs, opensAtMs + hours * 3600000);
}

// --- period validation (one place) -------------------------------------------

export function validatePeriod(from: unknown, to: unknown): { from: string; to: string } {
  const errors: Record<string, string> = {};
  const fromStr = typeof from === "string" ? from : "";
  const toStr = typeof to === "string" ? to : "";
  const fromMs = parseDistrictDate(fromStr);
  if (fromMs === null) errors.from = "Give a district date like 2026-10-04.";
  const toMs = parseDistrictDate(toStr);
  if (toMs === null) {
    errors.to = "Give a district date like 2026-10-04.";
  } else if (fromMs !== null) {
    if (toMs < fromMs) {
      errors.to = "The end date must not be before the start date.";
    } else {
      const days = Math.round((toMs - fromMs) / 86400000) + 1;
      if (days > 92) errors.to = "A period is at most 92 days.";
    }
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  return { from: fromStr, to: toStr };
}

export function validateSignatory(signatory: unknown): string {
  const s = typeof signatory === "string" ? signatory.trim() : "";
  if (s.length < 2 || s.length > 80) throw fieldErrors({ signatory: "Signatory is 2 to 80 characters." });
  return s;
}

// --- submission ----------------------------------------------------------------

export type PackRow = {
  id: string;
  number: string;
  from: string;
  to: string;
  signatory: string;
  state: "building" | "stored" | "mailed" | "withdrawn";
  stalled_on: null | "store" | "mail";
  key: string | null;
  sha256: string | null;
  created_at: string;
  mailed_at: string | null;
};

export async function submitPack(
  store: Store,
  clerkId: number,
  input: { from: string; to: string; signatory: string; document: string },
): Promise<PackRow> {
  return store.transaction(async (client) => {
    const { from, to } = validatePeriod(input.from, input.to);
    const signatory = validateSignatory(input.signatory);
    if (typeof input.document !== "string" || input.document.length === 0) {
      throw fieldErrors({ document: "Preview the pack first." });
    }
    // rebuild and compare
    const rebuilt = await buildPackDocumentTx(client, from, to, signatory);
    if (rebuilt !== input.document) {
      throw new ApiError(409, "pack_stale", "The records changed since your preview. Preview again before signing.");
    }
    const res = await client.query<{ last_number: number }>(
      "UPDATE packs_last_number SET last_number = last_number + 1 WHERE id = 1 RETURNING last_number",
    );
    const n = res.rows[0]!.last_number;
    const number = `WP-${String(n).padStart(4, "0")}`;
    const ins = await client.query(
      `INSERT INTO packs (id, number, from_date, to_date, signatory, state, document, created_at)
       VALUES ($1,$2,$3,$4,$5,'building',$6, now())`,
      [number, number, from, to, signatory, input.document],
    );
    void ins;
    return {
      id: number,
      number,
      from,
      to,
      signatory,
      state: "building",
      stalled_on: null,
      key: `packs/${number}.txt`,
      sha256: null,
      created_at: formatInstant(Date.now()),
      mailed_at: null,
    };
  });
}

async function buildPackDocumentTx(client: pg.PoolClient, from: string, to: string, signatory: string): Promise<string> {
  // the same document as buildPackDocument, reading through the transaction
  const fromMs = parseDistrictDate(from);
  const toMs = parseDistrictDate(to);
  if (fromMs === null || toMs === null) throw new ApiError(500, "pack_error", "Period is invalid.");
  const windows = await client.query<{
    id: string; channel_name: string; opens_at: Date; hours: number; table_cap: string | null;
    restriction_cap: string | null; restriction_eff: Date | null; committed_ml: string; delivered_ml: string;
  }>(
    `SELECT w.id, c.name AS channel_name, w.opens_at, w.hours,
       w.restriction_cap_ml_day AS restriction_cap, w.restriction_effective_at AS restriction_eff,
       w.committed_ml, w.delivered_ml,
       (SELECT cc.cap_ml_day FROM capacity_cells cc JOIN capacity_revisions r ON r.id = cc.revision_id
        WHERE cc.window_id = w.id ORDER BY r.revision DESC, r.id DESC LIMIT 1) AS table_cap
     FROM windows w JOIN channels c ON c.id = w.channel_id ORDER BY c.rail_order, w.opens_at`,
  );
  const lines: string[] = [`Wirrinbah Water Trust delivery pack ${from} to ${to}`];
  for (const w of windows.rows) {
    const local = districtDate(w.opens_at.getTime());
    if (local < from || local > to) continue;
    const label = windowLabelForPack(w.opens_at.getTime(), w.hours);
    const effCap = effectiveCapMlDay(w.table_cap ?? "0.000", w.restriction_cap);
    const capVol = capVolumeMl(w.table_cap ?? "0.000", w.restriction_cap, w.restriction_eff?.getTime() ?? null, w.opens_at.getTime(), w.hours);
    lines.push(
      `WINDOW ${w.id} ${w.channel_name} | ${label} | cap ${effCap} ML/day | volume ${capVol} ML | committed ${w.committed_ml} ML | delivered ${w.delivered_ml} ML` +
        (w.restriction_cap !== null ? ` | restricted ${w.restriction_cap} ML/day from ${formatInstant(w.restriction_eff!.getTime())}` : ""),
    );
    const strokes = await client.query<{ turnout: string; kind: string; from_ml_day: string; to_ml_day: string; stroke_operator: string; stroke_committed_at: Date }>(
      `SELECT turnout, kind, from_ml_day, to_ml_day, stroke_operator, stroke_committed_at FROM gate_cards
       WHERE window_id = $1 AND state = 'spent' AND stroke_committed_at IS NOT NULL
       ORDER BY stroke_confirmed_at, id`,
      [w.id],
    );
    for (const s of strokes.rows) {
      lines.push(
        `STROKE ${s.turnout} ${s.kind} ${s.from_ml_day} -> ${s.to_ml_day} ML/day | operator ${s.stroke_operator} | ${formatInstant(s.stroke_committed_at.getTime())}`,
      );
    }
  }
  lines.push(`Signed by ${signatory} for Wirrinbah Water Trust`);
  return lines.map((l) => `${l}\n`).join("");
}

export function packSha256(document: string): string {
  return createHash("sha256").update(document, "utf8").digest("hex");
}

export function toPackRow(r: {
  id: string; number: string; from_date: string; to_date: string; signatory: string;
  state: string; stalled_on: string | null; object_key: string | null; sha256: string | null;
  created_at: Date; mailed_at: Date | null;
}): PackRow {
  return {
    id: r.id,
    number: r.number,
    from: r.from_date,
    to: r.to_date,
    signatory: r.signatory,
    state: r.state as PackRow["state"],
    stalled_on: (r.stalled_on as PackRow["stalled_on"]) ?? null,
    key: r.object_key,
    sha256: r.sha256,
    created_at: formatInstant(new Date(r.created_at).getTime()),
    mailed_at: r.mailed_at ? formatInstant(new Date(r.mailed_at).getTime()) : null,
  };
}
