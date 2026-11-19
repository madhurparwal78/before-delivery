import type { AppState } from "../auth.js";
import { loadSource, type JoinedRow } from "../sample.js";
import type { Node } from "../formula/parser.js";
import { checkFormula } from "../formula/checker.js";
import type { SheetShape } from "../query/view.js";
import { dimValueFor, type QueryContext } from "../query/evaluate.js";
import type { FieldDef, Row } from "../query/core.js";
import type { Value } from "../formula/evaluator.js";
import { cellValue } from "../query/core.js";
import { lodRowValues } from "../query/lod.js";

export interface SheetRecord {
  id: string;
  workbook_id: string;
  owner_id: string | null;
  name: string;
  version: number;
  shape: SheetShape;
}

/**
 * Build the query context for a sheet: RLS first, then the query order.
 * Used by the query route, the member-list route, exports and alerts so the
 * steps are decided in exactly one place.
 */
export async function buildQueryContextForSheet(
  state: AppState,
  sheet: SheetRecord,
  userId: string,
  params: Record<string, unknown> = {},
  sets: Record<string, unknown> = {},
): Promise<QueryContext> {
  const db = state.db;
  const wb = (await db.query("SELECT * FROM workbooks WHERE id = $1", [sheet.workbook_id])).rows[0];
  if (!wb) throw new Error("workbook missing");
  const source = await loadSource(db, wb.source_id);
  if (!source) throw new Error("source missing");
  // Entitlements are a table of usernames to allowed values.
  const usernameRow = await db.query("SELECT username FROM users WHERE id = $1", [userId]);
  const username = usernameRow.rows[0]?.username ?? "";
  const wbParams = (await db.query("SELECT * FROM parameters WHERE workbook_id = $1", [wb.id])).rows;
  const parameters = new Map<string, Value>();
  for (const p of wbParams) {
    const override = params[p.name];
    let value: Value;
    if (override !== undefined) {
      value = typeof override === "number" ? override : String(override);
    } else if (p.type === "number") {
      const n = Number(p.value);
      value = Number.isFinite(n) ? n : null;
    } else {
      value = p.value;
    }
    parameters.set(p.name, value);
  }
  const wbSets = (await db.query("SELECT * FROM sets WHERE workbook_id = $1", [wb.id])).rows;
  const setMap = new Map<string, { field: string; members: Value[] | null; top: { n: number | string; by: { field: string; agg: string } | null } | null }>();
  for (const s of wbSets) {
    const override = sets[s.name];
    if (Array.isArray(override)) {
      setMap.set(s.name, { field: s.field, members: override.map((v) => (typeof v === "number" ? v : String(v))), top: null });
    } else {
      setMap.set(s.name, {
        field: s.field,
        members: ((s.members as unknown[] | null) ?? []).map((v) => (typeof v === "number" ? v : String(v))),
        top: (s.top as { n: number | string; by: { field: string; agg: string } | null } | null) ?? null,
      });
    }
  }
  // Step 1: row-level security.
  const fieldDefs: FieldDef[] = source.fields.map((f) => ({
    id: f.id,
    name: f.name,
    table: f.table,
    type: f.type,
    kind: f.kind,
    continuous: f.continuous,
    hidden: f.hidden,
    origin: f.origin,
  }));
  const securityField = source.entitlementField;
  const entitledValues = source.entitlementUsers?.[username];
  const rows: Row[] = [];
  for (const jr of source.rows as JoinedRow[]) {
    if (securityField) {
      const v = jr.values[securityField];
      if (v === null || v === undefined) continue;
      if (!entitledValues || !entitledValues.includes(v)) continue;
    }
    const values = new Map<string, Value>();
    for (const f of fieldDefs) {
      values.set(f.name, cellValue(f.type, jr.values[f.name] ?? null));
    }
    for (const [name, s] of setMap) {
      if (s.members) {
        const v = values.get(s.field);
        values.set(name, v !== null && v !== undefined && s.members.map(String).includes(String(v)));
      } else {
        values.set(name, null);
      }
    }
    rows.push({ values });
  }
  const calcs = (await db.query("SELECT name, formula FROM calculations WHERE sheet_id = $1", [sheet.id])).rows;
  const calcNodes: { name: string; node: Node }[] = [];
  for (const c of calcs) {
    const check = checkFormula(
      c.formula,
      {
        fields: fieldDefs.filter((f) => !f.hidden),
        calcs: calcNodes.map((x) => ({ id: x.name, name: x.name, formula: "" })),
        parameters: [...parameters.entries()].map(([name, value]) => ({
          name,
          type: (typeof value === "number" ? "number" : "text") as "number" | "text",
          value: typeof value === "string" || typeof value === "number" ? value : "",
          values: [],
        })),
        sets: [...setMap.entries()].map(([name, s]) => ({ name, field: s.field, members: (s.members ?? []) as string[], top: s.top })),
        formulaMaxDepth: state.config.formulaMaxDepth,
      },
      state.config.formulaMaxChars,
    );
    if (check.valid && check.node) calcNodes.push({ name: c.name, node: check.node });
  }
  // LOD precompute: AT and {agg} see the rows after security and source and
  // context filters.
  const lodValues = new Map<string, Map<Row, number | null>>();
  const viewDims = sheet.shape.rows
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => fieldDefs.find((f) => f.name === (typeof p === "string" ? p : p.field))?.kind === "dimension")
    .map(({ p, i }) => {
      const name = typeof p === "string" ? p : p.field;
      const level = typeof sheet.shape.rows[i] === "object" ? ((sheet.shape.rows[i] as { level?: string }).level ?? "month") : null;
      return { field: fieldDefs.find((f) => f.name === name)!, level };
    });
  let lodScopeRows = rows;
  const fieldByName = new Map(fieldDefs.map((f) => [f.name, f]));
  for (const f of sheet.shape.filters.filter((x) => x.step === "source" || x.step === "context")) {
    const field = fieldByName.get(f.field);
    if (!field) continue;
    const allowed = new Set((f.values ?? []).map((v) => (v === null ? "\u0000" : String(v))));
    lodScopeRows = lodScopeRows.filter((r) => {
      const v = dimValueFor(r, field, null);
      return allowed.has(v === null ? "\u0000" : String(v));
    });
  }
  const lodCtx: QueryContext = {
    fields: fieldDefs,
    calcs: calcNodes,
    parameters,
    sets: setMap,
    rows: lodScopeRows,
    rightTable: source.relation?.right_table ?? null,
    rightKeyField: source.relation?.right_key ?? null,
  };
  for (const c of calcNodes) {
    if (c.node.kind === "lod") {
      lodValues.set(c.name, lodRowValues(c.node, { rows: lodScopeRows, viewDims }, fieldDefs, lodCtx));
    }
  }
  return {
    fields: fieldDefs,
    calcs: calcNodes,
    parameters,
    sets: setMap,
    rows,
    rightTable: source.relation?.right_table ?? null,
    rightKeyField: source.relation?.right_key ?? null,
    lodValues,
  };
}
