import { COUNTRIES, GARMENTS, MATERIALS, MODES } from "../../shared/catalog";
import { pool, transaction, now, type DbRow } from "../db";
import { ApiError, conflict, empty, fieldErrors, notFound, ok, route, type Call, type Session } from "../http";
import { characters, exact, fitsInteger, fold, gtinProblem, isPositiveDecimal, plain } from "../figures";
import {
  ARCHIVED_COPY,
  CLOSED_COPY,
  assertFresh,
  assertWritable,
  lineJson,
  linesOf,
  listedStyles,
  loadLiveLabel,
  loadStyle,
  newId,
  nextStyleState,
  object,
  styleJson,
  touchStyle,
  type ListedStyle,
  type StyleRecord,
} from "../domain";

const EMPTY = "Give a value here.";
const CODE_TAKEN = "That style code is already in this label.";
const MASS_FORM = "Give a fabric weight and area, or a plain mass.";
const SHARE_FORM = "Give each fibre share with one decimal.";
const PAGE_SIZE = 25;

const desk = (call: Call): string => (call.session as Session).assessorId;

function optionalInteger(value: unknown): boolean {
  return value === null || (fitsInteger(value) && (value as number) >= 0);
}

function styleFieldProblems(body: Record<string, unknown>, creating: boolean): Record<string, string> {
  const fields: Record<string, string> = {};
  const has = (key: string): boolean => creating || key in body;
  if (has("name") && (typeof body.name !== "string" || !body.name.trim() || characters(body.name) > 120)) fields.name = EMPTY;
  if (has("season") && (typeof body.season !== "string" || !body.season.trim() || characters(body.season) > 120)) fields.season = EMPTY;
  if (has("gtin")) {
    const problem = gtinProblem(body.gtin);
    if (problem) fields.gtin = problem;
  }
  if ("styleCode" in body && body.styleCode !== null && (typeof body.styleCode !== "string" || characters(body.styleCode) > 120)) fields.styleCode = EMPTY;
  if ("garment" in body && !GARMENTS.some((garment) => garment.id === body.garment)) fields.garment = EMPTY;
  if ("washes" in body && !(fitsInteger(body.washes) && (body.washes as number) >= 0)) fields.washes = EMPTY;
  if ("repairService" in body && body.repairService !== null && typeof body.repairService !== "boolean") fields.repairService = EMPTY;
  if ("rangeSize" in body && !optionalInteger(body.rangeSize)) fields.rangeSize = EMPTY;
  if ("notes" in body && body.notes !== null && (typeof body.notes !== "string" || characters(body.notes) > 2000)) fields.notes = EMPTY;
  return fields;
}

const blankToNull = (value: unknown): unknown => (typeof value === "string" && !value.trim() ? null : value ?? null);

async function codeTaken(labelId: string, code: unknown, exceptId: string | null): Promise<boolean> {
  if (typeof code !== "string") return false;
  const { rows } = await pool.query(`SELECT id FROM styles WHERE label_id = $1 AND style_code = $2`, [labelId, code]);
  return rows.some((row) => row.id !== exceptId);
}

interface StyleCursor {
  key: string | null;
  id: string;
}

function readCursor(text: string | null): StyleCursor | null {
  if (!text) return null;
  try {
    return JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as StyleCursor;
  } catch {
    return null;
  }
}

function sortKey(style: ListedStyle, sort: string): string | null {
  return sort === "climate" ? style.climateTotal : fold(style.row.name);
}

function compareKeys(a: StyleCursor, b: StyleCursor, sort: string): number {
  if (a.key !== b.key) {
    if (sort === "climate") {
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return exact(a.key).comparedTo(b.key);
    }
    return (a.key as string) < (b.key as string) ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

route("GET", "/api/styles", {
  handle: async (call) => {
    const label = call.query.get("label");
    const season = call.query.get("season");
    const state = call.query.get("state");
    const sort = call.query.get("sort") === "climate" ? "climate" : "name";
    const term = fold(call.query.get("q")?.trim() ?? "");
    const cursor = readCursor(call.query.get("cursor"));
    const keyed = (await listedStyles(pool, desk(call)))
      .filter(({ row }) => (state ? row.state === state : row.state !== "archived"))
      .filter(({ row }) => !label || row.labelId === label)
      .filter(({ row }) => !season || row.season === season)
      .filter(({ row }) => !term || [row.name, ...row.suppliers].some((name) => fold(name).includes(term)))
      .map((style) => ({ style, at: { key: sortKey(style, sort), id: style.row.id } }))
      .sort((a, b) => compareKeys(a.at, b.at, sort))
      .filter(({ at }) => !cursor || compareKeys(at, cursor, sort) > 0);
    const page = keyed.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    return ok({
      styles: page.map(({ style }) => style.row),
      nextCursor: keyed.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify(last.at)).toString("base64url") : null,
    });
  },
});

route("POST", "/api/styles", {
  input: "json",
  handle: async (call) => {
    const body = object(call.body);
    if (typeof body.labelId !== "string" || !body.labelId) {
      throw fieldErrors({ labelId: EMPTY, ...styleFieldProblems(body, true) });
    }
    const label = await loadLiveLabel(pool, desk(call), body.labelId);
    const fields = styleFieldProblems(body, true);
    const code = blankToNull(body.styleCode);
    if (!fields.styleCode && (await codeTaken(label.id, code, null))) fields.styleCode = CODE_TAKEN;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    if (label.state !== "open") throw conflict(CLOSED_COPY);
    const id = newId();
    const inserted = await pool.query(
      `INSERT INTO styles (id, assessor_id, label_id, style_code, name, season, gtin, garment, washes, repair_service, range_size, notes, state, changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13) ON CONFLICT (label_id, style_code) DO NOTHING`,
      [id, desk(call), label.id, code, body.name, body.season, body.gtin, body.garment ?? "tshirt", body.washes ?? 30, body.repairService ?? null, body.rangeSize ?? null, blankToNull(body.notes), now()],
    );
    if (!inserted.rowCount) throw fieldErrors({ styleCode: CODE_TAKEN });
    return ok(await styleJson(pool, await loadStyle(pool, desk(call), id)), 201);
  },
});

const theStyle = (call: Call): Promise<StyleRecord> => loadStyle(pool, desk(call), call.params[0] as string);

route("GET", "/api/styles/:id", {
  resource: theStyle,
  handle: async (_call, style) => ok(await styleJson(pool, style)),
});

const OUTDATING = ["gtin", "garment", "washes", "repairService", "rangeSize"];

route("PATCH", "/api/styles/:id", {
  input: "json",
  resource: theStyle,
  handle: async (call, style) => {
    const body = object(call.body);
    const fields = styleFieldProblems(body, false);
    const code = "styleCode" in body ? blankToNull(body.styleCode) : style.style_code;
    if (!fields.styleCode && "styleCode" in body && (await codeTaken(style.label_id, code, style.id))) fields.styleCode = CODE_TAKEN;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, body.baseVersion);
      await tx.query(
        `UPDATE styles SET style_code = $2, name = $3, season = $4, gtin = $5, garment = $6, washes = $7, repair_service = $8, range_size = $9, notes = $10 WHERE id = $1`,
        [
          style.id,
          code,
          body.name ?? locked.name,
          body.season ?? locked.season,
          body.gtin ?? locked.gtin,
          body.garment ?? locked.garment,
          body.washes ?? locked.washes,
          "repairService" in body ? body.repairService : locked.repair_service,
          "rangeSize" in body ? body.rangeSize : locked.range_size,
          "notes" in body ? blankToNull(body.notes) : locked.notes,
        ],
      );
      await touchStyle(tx, style.id, null, OUTDATING.some((key) => key in body));
      return ok(await styleJson(tx, await loadStyle(tx, desk(call), style.id)));
    });
  },
});

route("POST", "/api/styles/:id/duplicate", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (call, style) => {
    assertWritable(style);
    const id = newId();
    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO styles (id, assessor_id, label_id, name, season, gtin, garment, washes, repair_service, range_size, notes, state, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12)`,
        [id, style.assessor_id, style.label_id, `${style.name} (copy)`, style.season, style.gtin, style.garment, style.washes, style.repair_service, style.range_size, style.notes, now()],
      );
      await tx.query(
        `INSERT INTO lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2, mass_grams, fibres, tier1, tier2, tier3)
         SELECT gen_random_uuid()::text, $2, position, material_id, fabric_weight_gsm, area_m2, mass_grams, fibres, tier1, tier2, tier3 FROM lines WHERE style_id = $1`,
        [style.id, id],
      );
      await tx.query(
        `INSERT INTO legs (id, style_id, position, mode, km) SELECT gen_random_uuid()::text, $2, position, mode, km FROM legs WHERE style_id = $1`,
        [style.id, id],
      );
    });
    return ok(await styleJson(pool, await loadStyle(pool, desk(call), id)), 201);
  },
});

route("POST", "/api/styles/:id/archive", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (call, style) => {
    if (style.label_state !== "open") throw conflict(CLOSED_COPY);
    if (style.state === "archived") throw conflict(ARCHIVED_COPY);
    if (style.state === "published") throw conflict("Withdraw the passport before archiving.");
    await pool.query(`UPDATE styles SET state = $2 WHERE id = $1`, [style.id, nextStyleState(style.state, "archive")]);
    return ok(await styleJson(pool, await loadStyle(pool, desk(call), style.id)));
  },
});

route("GET", "/api/materials", {
  handle: async (call) => {
    const term = fold(call.query.get("q") ?? "");
    return ok({ materials: MATERIALS.filter((material) => fold(material.name).includes(term)) });
  },
});

// ---- material lines

interface LineFields {
  materialId: string;
  fabricWeightGsm: string | null;
  areaM2: string | null;
  massGrams: string;
  fibres: { name: string; sharePercent: string }[];
  tier1: unknown;
  tier2: unknown;
  tier3: unknown;
}

function tierProblems(fields: Record<string, string>, key: string, tier: unknown): void {
  if (tier === null || tier === undefined) return;
  const value = object(tier);
  if (typeof value.factory !== "string" || !value.factory.trim()) fields[`${key}.factory`] = EMPTY;
  if (typeof value.town !== "string" || !value.town.trim()) fields[`${key}.town`] = EMPTY;
  if (value.country !== null && value.country !== undefined && !COUNTRIES.some((country) => country.id === value.country)) {
    fields[`${key}.country`] = EMPTY;
  }
}

/** Mass in exact decimals and fibre shares adding up to exactly 100.0. */
function readLine(body: Record<string, unknown>, current: LineFields | null): LineFields {
  const fields: Record<string, string> = {};
  const materialId = (body.materialId ?? current?.materialId) as string;
  if (!MATERIALS.some((material) => material.id === materialId)) fields.materialId = EMPTY;

  let fabricWeightGsm: string | null = current?.fabricWeightGsm ?? null;
  let areaM2: string | null = current?.areaM2 ?? null;
  let massGrams = current?.massGrams ?? "";
  if (body.massGrams !== undefined && body.massGrams !== null) {
    if (isPositiveDecimal(body.massGrams)) massGrams = body.massGrams;
    else fields.massGrams = MASS_FORM;
    fabricWeightGsm = null;
    areaM2 = null;
  } else if (body.fabricWeightGsm !== undefined || body.areaM2 !== undefined) {
    const weight = body.fabricWeightGsm ?? current?.fabricWeightGsm;
    const area = body.areaM2 ?? current?.areaM2;
    if (!isPositiveDecimal(weight)) fields.fabricWeightGsm = MASS_FORM;
    if (!isPositiveDecimal(area)) fields.areaM2 = MASS_FORM;
    if (isPositiveDecimal(weight) && isPositiveDecimal(area)) {
      fabricWeightGsm = weight;
      areaM2 = area;
      massGrams = plain(exact(weight).times(area));
    }
  } else if (!current) {
    fields.massGrams = MASS_FORM;
  }

  const fibres = (body.fibres ?? current?.fibres ?? []) as { name?: unknown; sharePercent?: unknown }[];
  let shareForm = Array.isArray(fibres);
  if (Array.isArray(fibres)) {
    fibres.forEach((fibre, index) => {
      if (typeof fibre?.name !== "string" || !fibre.name.trim()) fields[`fibres.${index}.name`] = EMPTY;
      if (typeof fibre?.sharePercent !== "string" || !/^\d{1,3}\.\d$/.test(fibre.sharePercent)) {
        fields[`fibres.${index}.sharePercent`] = SHARE_FORM;
        shareForm = false;
      }
    });
    if (shareForm) {
      const total = fibres.reduce((sum, fibre) => sum.plus(fibre.sharePercent as string), exact(0));
      if (!total.equals(100)) fields.fibres = `The fibres add up to ${total.toFixed(1)}%. They must add up to 100.0%.`;
    }
  } else {
    fields.fibres = SHARE_FORM;
  }

  const tier1 = "tier1" in body ? body.tier1 : current?.tier1 ?? null;
  const tier2 = "tier2" in body ? body.tier2 : current?.tier2 ?? null;
  const tier3 = "tier3" in body ? body.tier3 : current?.tier3 ?? null;
  tierProblems(fields, "tier1", tier1);
  tierProblems(fields, "tier2", tier2);
  tierProblems(fields, "tier3", tier3);

  if (Object.keys(fields).length) throw fieldErrors(fields);
  return {
    materialId,
    fabricWeightGsm,
    areaM2,
    massGrams,
    fibres: fibres.map((fibre) => ({ name: fibre.name as string, sharePercent: fibre.sharePercent as string })),
    tier1: tier1 ?? null,
    tier2: tier2 ?? null,
    tier3: tier3 ?? null,
  };
}

route("GET", "/api/styles/:id/lines", {
  resource: theStyle,
  handle: async (_call, style) => ok({ lines: await linesOf(pool, style.id), version: style.version }),
});

route("POST", "/api/styles/:id/lines", {
  input: "json",
  resource: theStyle,
  handle: async (call, style) => {
    const body = object(call.body);
    const line = readLine(body, null);
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, body.baseVersion);
      const { rows } = await tx.query(
        `INSERT INTO lines (id, style_id, position, material_id, fabric_weight_gsm, area_m2, mass_grams, fibres, tier1, tier2, tier3)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10 FROM lines WHERE style_id = $2 RETURNING *`,
        [newId(), style.id, line.materialId, line.fabricWeightGsm, line.areaM2, line.massGrams, JSON.stringify(line.fibres), JSON.stringify(line.tier1), JSON.stringify(line.tier2), JSON.stringify(line.tier3)],
      );
      await touchStyle(tx, style.id, null, true);
      return ok(lineJson(rows[0]), 201);
    });
  },
});

async function loadLine(styleId: string, lineId: string): Promise<DbRow> {
  const { rows } = await pool.query(`SELECT * FROM lines WHERE id = $1 AND style_id = $2`, [lineId, styleId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

const styleAndLine = async (call: Call): Promise<{ style: StyleRecord; line: DbRow }> => {
  const style = await theStyle(call);
  return { style, line: await loadLine(style.id, call.params[1] as string) };
};

route("PATCH", "/api/styles/:id/lines/:lineId", {
  input: "json",
  resource: styleAndLine,
  handle: async (call, { style, line }) => {
    const body = object(call.body);
    const current = lineJson(line);
    const next = readLine(body, { ...current, massGrams: current.massGrams });
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, body.baseVersion);
      const { rows } = await tx.query(
        `UPDATE lines SET material_id = $2, fabric_weight_gsm = $3, area_m2 = $4, mass_grams = $5, fibres = $6, tier1 = $7, tier2 = $8, tier3 = $9 WHERE id = $1 RETURNING *`,
        [current.id, next.materialId, next.fabricWeightGsm, next.areaM2, next.massGrams, JSON.stringify(next.fibres), JSON.stringify(next.tier1), JSON.stringify(next.tier2), JSON.stringify(next.tier3)],
      );
      await touchStyle(tx, style.id, null, true);
      return ok(lineJson(rows[0]));
    });
  },
});

route("DELETE", "/api/styles/:id/lines/:lineId", {
  resource: styleAndLine,
  handle: async (call, { style, line }) => {
    assertWritable(style);
    await transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, baseVersionOf(call));
      await tx.query(`DELETE FROM lines WHERE id = $1`, [line.id]);
      await tx.query(
        `UPDATE lines l SET position = n.position FROM
           (SELECT id, row_number() OVER (ORDER BY position) AS position FROM lines WHERE style_id = $1) n
         WHERE l.id = n.id`,
        [style.id],
      );
      await touchStyle(tx, style.id, null, true);
    });
    return empty();
  },
});

function baseVersionOf(call: Call): number | undefined {
  const text = call.query.get("baseVersion");
  return text === null ? undefined : Number(text);
}

route("POST", "/api/styles/:id/lines/:lineId/move", {
  input: "json",
  resource: styleAndLine,
  handle: async (call, { style, line }) => {
    const body = object(call.body);
    if (body.direction !== "up" && body.direction !== "down") throw fieldErrors({ direction: EMPTY });
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      // The one published exception to the ladder: an old baseVersion wins over the line being at the end.
      assertFresh(locked, body.baseVersion);
      const { rows } = await tx.query(`SELECT id, position FROM lines WHERE style_id = $1 ORDER BY position`, [style.id]);
      const index = rows.findIndex((row) => row.id === line.id);
      const neighbour = rows[index + (body.direction === "up" ? -1 : 1)];
      if (!neighbour) throw new ApiError(409, "conflict", "That line is already at the end.");
      await tx.query(`UPDATE lines SET position = $2 WHERE id = $1`, [line.id, neighbour.position]);
      await tx.query(`UPDATE lines SET position = $2 WHERE id = $1`, [neighbour.id, rows[index].position]);
      await touchStyle(tx, style.id, null, true);
      const after = await loadStyle(tx, desk(call), style.id);
      const lines = await linesOf(tx, style.id);
      const moved = lines.find((candidate) => candidate.id === line.id);
      return ok({ lines, position: moved?.position, total: lines.length, version: after.version });
    });
  },
});

// ---- transport legs

route("POST", "/api/styles/:id/legs", {
  input: "json",
  resource: theStyle,
  handle: async (call, style) => {
    const body = object(call.body);
    const fields: Record<string, string> = {};
    if (!MODES.some((mode) => mode.id === body.mode)) fields.mode = EMPTY;
    if (!isPositiveDecimal(body.km)) fields.km = EMPTY;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    assertWritable(style);
    return transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, body.baseVersion);
      const { rows } = await tx.query(
        `INSERT INTO legs (id, style_id, position, mode, km)
         SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4 FROM legs WHERE style_id = $2 RETURNING id, mode, km`,
        [newId(), style.id, body.mode, body.km],
      );
      await touchStyle(tx, style.id, null, true);
      return ok({ ...rows[0], version: locked.version + 1 }, 201);
    });
  },
});

route("DELETE", "/api/styles/:id/legs/:legId", {
  resource: async (call) => {
    const style = await theStyle(call);
    const { rows } = await pool.query(`SELECT id FROM legs WHERE id = $1 AND style_id = $2`, [call.params[1], style.id]);
    if (!rows[0]) throw notFound();
    return { style, legId: rows[0].id as string };
  },
  handle: async (call, { style, legId }) => {
    assertWritable(style);
    await transaction(async (tx) => {
      const locked = await loadStyle(tx, desk(call), style.id, true);
      assertFresh(locked, baseVersionOf(call));
      await tx.query(`DELETE FROM legs WHERE id = $1`, [legId]);
      await touchStyle(tx, style.id, null, true);
    });
    return empty();
  },
});
