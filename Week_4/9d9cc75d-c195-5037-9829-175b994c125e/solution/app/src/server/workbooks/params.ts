// Parameters and sets of a workbook: body narrowing and writes, shared by the routes and the grading seed.
import type { ParameterDef, ParameterType, SetDef } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { App } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import type { JsonObject } from '../http/validate.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { nameClash } from '../sources/fields.ts';
import { mapSet } from '../sheets/refs.ts';
import { workbookScope } from '../sheets/scope.ts';
import { Malformed, cells, measurePill, oneOf, parsed } from '../sheets/shape.ts';
import { bumpWorkbook } from './store.ts';
import type { WorkbookRow } from './store.ts';

const TYPES: readonly ParameterType[] = ['number', 'text', 'list'];
const TOP_TEXT = 'Top needs a count of at least 1 or a parameter, and a measure.';

function name(body: JsonObject): string {
  const value = nonBlank(body.name);
  if (value === null) throw new Malformed('name', NAME_REQUIRED);
  return value.trim();
}

/** `{"name","type":"number|text|list","value","values"}`; a list's value is one of its values. */
function parameterBody(body: JsonObject): Omit<ParameterDef, 'id'> {
  const type = oneOf(TYPES, body.type);
  if (type === null) throw new Malformed('type', 'Type must be number, text or list.');
  const values = body.values ?? [];
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
    throw new Malformed('values', 'Values must be a list of text values.');
  }
  if (type === 'list' && values.length === 0) throw new Malformed('values', 'A list parameter needs values.');
  const value = body.value;
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Malformed('value', 'Value must be a number.');
    return { name: name(body), type, value, values: [] };
  }
  if (typeof value !== 'string' || (type === 'list' && !values.includes(value))) {
    throw new Malformed('value', type === 'text' ? 'Value must be text.' : 'Value must be one of the values.');
  }
  return { name: name(body), type, value, values: type === 'list' ? values : [] };
}

/** `{"name","field","members":[...]}` or `{"name","field","top":{"n":n|"@<parameter>","by":measure pill}}`, with names. */
function setBody(body: JsonObject): Omit<SetDef, 'id'> {
  const setName = name(body);
  const field = nonBlank(body.field);
  if (field === null) throw new Malformed('field', 'Field is required.');
  if (body.top !== undefined && body.top !== null) {
    const top = body.top;
    if (!isObject(top)) throw new Malformed('top', TOP_TEXT);
    const n = top.n;
    const isParameter = typeof n === 'string' && n.startsWith('@') && n.length > 1;
    const isCount = typeof n === 'number' && Number.isInteger(n) && n >= 1;
    if (!isParameter && !isCount) throw new Malformed('top', TOP_TEXT);
    return { name: setName, field, top: { n, by: measurePill(top.by, 'top', TOP_TEXT) } };
  }
  return { name: setName, field, members: cells(body.members ?? [], 'members', 'Members must be a list of values.') };
}

async function clash(app: App, table: 'parameters' | 'sets', workbookId: string, wanted: string, except: string | null): Promise<boolean> {
  const row = await app.db.row<{ id: string }>(
    `SELECT id FROM ${table} WHERE workbook_id = $1 AND name = $2 AND id <> $3`,
    [workbookId, wanted, except ?? ''],
  );
  return row !== null;
}

/** Adds (`id` null) or replaces a parameter. */
export async function saveParameter(app: App, workbook: WorkbookRow, id: string | null, body: JsonObject): Promise<ParameterDef> {
  const def = parsed(() => parameterBody(body));
  if (await clash(app, 'parameters', workbook.id, def.name, id)) throw invalid({ name: nameClash(def.name) });
  const saved: ParameterDef = { id: id ?? newId(), ...def };
  await app.db.transaction(async (tx) => {
    const values = [saved.id, workbook.id, saved.name, saved.type, JSON.stringify(saved.value), JSON.stringify(saved.values)];
    if (id === null) {
      await tx.exec(`INSERT INTO parameters (id, workbook_id, name, type, value, "values") VALUES ($1, $2, $3, $4, $5, $6)`, values);
    } else {
      await tx.exec(`UPDATE parameters SET name = $3, type = $4, value = $5, "values" = $6 WHERE id = $1 AND workbook_id = $2`, values);
    }
    await bumpWorkbook(tx, workbook.id);
  });
  return saved;
}

/** Adds (`id` null) or replaces a set. The field must be one of the source's fields; a Top N parameter must exist. */
export async function saveSet(app: App, workbook: WorkbookRow, id: string | null, body: JsonObject): Promise<SetDef> {
  const def = parsed(() => setBody(body));
  const ws = await workbookScope(app, workbook);
  const n = def.top?.n;
  if (ws.dataset.byName.has(def.name) || (await clash(app, 'sets', workbook.id, def.name, id))) {
    throw invalid({ name: nameClash(def.name) });
  }
  if (!ws.dataset.byName.has(def.field)) throw invalid({ field: 'Field must be one of the source fields.' });
  if (typeof n === 'string' && !ws.parameters.some((p) => `@${p.name}` === n)) throw invalid({ top: TOP_TEXT });
  const saved: SetDef = { id: id ?? newId(), ...def };
  const stored = mapSet(saved, ws.maps.stored);
  await app.db.transaction(async (tx) => {
    const values = [
      saved.id,
      workbook.id,
      saved.name,
      stored.field,
      stored.members === undefined ? null : JSON.stringify(stored.members),
      stored.top === undefined ? null : JSON.stringify(stored.top),
    ];
    if (id === null) {
      await tx.exec(`INSERT INTO sets (id, workbook_id, name, field, members, top) VALUES ($1, $2, $3, $4, $5, $6)`, values);
    } else {
      await tx.exec(`UPDATE sets SET name = $3, field = $4, members = $5, top = $6 WHERE id = $1 AND workbook_id = $2`, values);
    }
    await bumpWorkbook(tx, workbook.id);
  });
  return saved;
}
