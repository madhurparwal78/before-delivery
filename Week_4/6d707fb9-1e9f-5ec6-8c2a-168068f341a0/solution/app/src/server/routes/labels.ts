import { townName } from "../../shared/catalog";
import { config } from "../config";
import { now, pool, transaction, type DbRow } from "../db";
import { conflict, empty, fieldErrors, notFound, ok, refused, route, type Call, type Session } from "../http";
import { addSeconds, characters, gtinProblem } from "../figures";
import {
  CLOSED_COPY,
  labelJson,
  loadLabel,
  loadLiveLabel,
  newId,
  object,
  objectKeysOfLabel,
  withdrawPassportsOfLabel,
} from "../domain";

const EMPTY = "Give a value here.";
const HEADER = "styleCode,name,season,gtin";

const desk = (call: Call): string => (call.session as Session).assessorId;

function nameProblem(value: unknown): string | null {
  return typeof value !== "string" || !value.trim() || characters(value) > 120 ? EMPTY : null;
}

route("GET", "/api/labels", {
  handle: async (call) => {
    const { rows } = await pool.query(`SELECT * FROM labels WHERE assessor_id = $1 ORDER BY seq`, [desk(call)]);
    return ok({ labels: rows.map(labelJson) });
  },
});

route("POST", "/api/labels", {
  input: "json",
  handle: async (call) => {
    const body = object(call.body);
    const fields: Record<string, string> = {};
    if (nameProblem(body.name)) fields.name = EMPTY;
    if (nameProblem(body.contactName)) fields.contactName = EMPTY;
    if (typeof body.contactEmail !== "string" || !/^[^\s@]+@[^\s@]+$/.test(body.contactEmail)) fields.contactEmail = EMPTY;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    const { rows } = await pool.query(
      `INSERT INTO labels (id, assessor_id, name, contact_name, contact_email, state) VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *`,
      [newId(), desk(call), body.name, body.contactName, body.contactEmail],
    );
    return ok(labelJson(rows[0]), 201);
  },
});

route("GET", "/api/labels/:id", {
  resource: (call) => loadLabel(pool, desk(call), call.params[0] as string),
  handle: async (_call, label) => {
    const suppliers = await pool.query(`SELECT * FROM suppliers WHERE label_id = $1 ORDER BY seq`, [label.id]);
    return ok({
      ...labelJson(label),
      suppliers: suppliers.rows.map((row) => ({
        id: row.id,
        name: row.name,
        town: row.town,
        townName: townName(row.town),
        language: row.language,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
      })),
    });
  },
});

route("PATCH", "/api/labels/:id", {
  input: "json",
  resource: (call) => loadLiveLabel(pool, desk(call), call.params[0] as string),
  handle: async (call, label) => {
    const body = object(call.body);
    if (nameProblem(body.name)) throw fieldErrors({ name: EMPTY });
    if (label.state !== "open") throw conflict(CLOSED_COPY);
    const { rows } = await pool.query(`UPDATE labels SET name = $2 WHERE id = $1 RETURNING *`, [label.id, body.name]);
    return ok(labelJson(rows[0]));
  },
});

route("DELETE", "/api/labels/:id", {
  resource: (call) => loadLiveLabel(pool, desk(call), call.params[0] as string),
  handle: async (_call, label) => {
    await transaction(async (tx) => {
      await withdrawPassportsOfLabel(tx, label.id);
      for (const key of await objectKeysOfLabel(tx, label.id)) {
        await tx.query(`INSERT INTO object_deletions (object_key) VALUES ($1) ON CONFLICT (object_key) DO NOTHING`, [key]);
      }
      await tx.query(`DELETE FROM labels WHERE id = $1`, [label.id]);
    });
    return empty();
  },
});

route("POST", "/api/labels/:id/close", {
  input: "emptyOrJson",
  resource: (call) => loadLabel(pool, desk(call), call.params[0] as string),
  handle: async (_call, label) => {
    const at = now();
    const { rows } = await pool.query(
      `UPDATE labels SET state = 'closed', closed_at = $2, erase_at = $3 WHERE id = $1 AND state = 'open' RETURNING *`,
      [label.id, at, addSeconds(at, config.closureWaitSeconds)],
    );
    if (!rows[0]) throw conflict("This label is not open.");
    return ok(labelJson(rows[0]));
  },
});

route("POST", "/api/labels/:id/bring-back", {
  input: "emptyOrJson",
  resource: (call) => loadLabel(pool, desk(call), call.params[0] as string),
  handle: async (_call, label) => {
    const { rows } = await pool.query(
      `UPDATE labels SET state = 'open', closed_at = NULL, erase_at = NULL
       WHERE id = $1 AND state = 'closed' AND erase_at > $2 AND NOT erase_started RETURNING *`,
      [label.id, now()],
    );
    if (!rows[0]) throw conflict("This label can no longer be brought back.");
    return ok(labelJson(rows[0]));
  },
});

// ---- catalogue file

interface CsvRow {
  line: number;
  cells: string[];
}

/** Standard double-quote quoting, LF or CRLF; rows keep the file line they start on. */
function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRow = (): void => {
    cells.push(cell);
    cell = "";
    if (cells.length > 1 || cells[0] !== "") rows.push({ line: start, cells });
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\n") {
      if (cell.endsWith("\r")) cell = cell.slice(0, -1);
      endRow();
      line += 1;
      start = line;
    } else {
      cell += char;
    }
  }
  if (cell.endsWith("\r")) cell = cell.slice(0, -1);
  if (cell || cells.length) endRow();
  return rows;
}

interface Judged {
  row: number;
  styleCode: string;
  name: string;
  season: string;
  gtin: string;
  outcome: "new" | "matched" | "refused";
  reason: string | null;
}

async function judgeCatalogue(call: Call, labelId: string): Promise<Judged[]> {
  const text = call.raw.toString("utf8").replace(/^﻿/, "");
  const rows = parseCsv(text);
  if (rows[0]?.cells.join(",") !== HEADER) throw refused("The first row must be styleCode,name,season,gtin.");
  const existing = await pool.query(`SELECT style_code FROM styles WHERE label_id = $1 AND style_code IS NOT NULL`, [labelId]);
  const taken = new Set(existing.rows.map((row) => row.style_code as string));
  const firstRow = new Map<string, number>();
  return rows.slice(1).map(({ line, cells }) => {
    const [styleCode = "", name = "", season = "", gtin = ""] = cells.map((cell) => cell.trim());
    const earlier = firstRow.get(styleCode);
    const reason = cells.some((cell) => cell.includes("\0"))
      ? EMPTY
      : !name
      ? "A name is needed."
      : !season
        ? "A season is needed."
        : gtinProblem(gtin) ?? (!styleCode ? EMPTY : earlier ? `This style code is already on row ${earlier}.` : null);
    if (styleCode && !earlier) firstRow.set(styleCode, line);
    const outcome = reason ? "refused" : taken.has(styleCode) ? "matched" : "new";
    return { row: line, styleCode, name, season, gtin, outcome, reason };
  });
}

function counts(rows: Judged[]): { newCount: number; matchedCount: number; refusedCount: number } {
  const count = (outcome: Judged["outcome"]): number => rows.filter((row) => row.outcome === outcome).length;
  return { newCount: count("new"), matchedCount: count("matched"), refusedCount: count("refused") };
}

const catalogueLabel = async (call: Call): Promise<DbRow> => {
  const label = await loadLabel(pool, desk(call), call.params[0] as string);
  if (label.state === "erased") throw notFound();
  return label;
};

route("POST", "/api/labels/:id/catalogue/preview", {
  input: "csv",
  resource: catalogueLabel,
  handle: async (call, label) => {
    const rows = await judgeCatalogue(call, label.id);
    return ok({
      rows: rows.map(({ row, styleCode, name, outcome, reason }) => ({ row, styleCode, name, outcome, reason })),
      ...counts(rows),
    });
  },
});

route("POST", "/api/labels/:id/catalogue/save", {
  input: "csv",
  resource: catalogueLabel,
  handle: async (call, label) => {
    const rows = await judgeCatalogue(call, label.id);
    if (label.state !== "open") throw conflict(CLOSED_COPY);
    await transaction(async (tx) => {
      for (const row of rows.filter((candidate) => candidate.outcome === "new")) {
        await tx.query(
          `INSERT INTO styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes, state, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'tshirt', 30, 'draft', $8) ON CONFLICT (label_id, style_code) DO NOTHING`,
          [newId(), desk(call), label.id, row.styleCode, row.name, row.season, row.gtin, now()],
        );
      }
    });
    return ok(counts(rows));
  },
});
