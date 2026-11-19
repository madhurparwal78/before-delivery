// Sheet and calculation writes. The routes and the grading seed both write through these.
import type { CalculationDef, SheetDetail, SheetShape } from '../../shared/model.ts';
import type { SheetScope } from '../engine/contract.ts';
import { toStoredFormula, validateCalculation } from '../engine/index.ts';
import { newId } from '../db/ids.ts';
import type { App, AuthUser } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { bumpWorkbook } from '../workbooks/store.ts';
import type { WorkbookRow } from '../workbooks/store.ts';
import { mapShape, refMaps } from './refs.ts';
import { sheetScope, workbookScope } from './scope.ts';
import type { LoadedSheet } from './scope.ts';
import { bumpSheet, sheetVersion } from './store.ts';
import type { SheetAccess, SheetRow } from './store.ts';

export function sheetDetail(access: SheetAccess, loaded: LoadedSheet): SheetDetail {
  return {
    ...loaded.shape,
    id: access.sheet.id,
    workbook: access.workbook.id,
    version: sheetVersion(access),
    copy: access.sheet.owner_id !== null,
    calculations: loaded.scope.calculations,
  };
}

/** Adds a workbook sheet; `expected` is the `If-Match` version already checked by the route. */
export async function createSheet(app: App, workbook: WorkbookRow, shape: SheetShape, expected: number | null): Promise<SheetRow> {
  const ws = await workbookScope(app, workbook);
  const sheet: SheetRow = { id: newId(), workbook_id: workbook.id, owner_id: null, shape: mapShape(shape, ws.maps.stored), version: 1 };
  await app.db.transaction(async (tx) => {
    await tx.exec(`INSERT INTO sheets (id, workbook_id, name, shape) VALUES ($1, $2, $3, $4)`, [
      sheet.id,
      workbook.id,
      shape.name,
      JSON.stringify(sheet.shape),
    ]);
    await bumpWorkbook(tx, workbook.id, expected);
  });
  return sheet;
}

export async function saveSheet(app: App, access: SheetAccess, shape: SheetShape, expected: number | null): Promise<void> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  await app.db.transaction(async (tx) => {
    await tx.exec(`UPDATE sheets SET name = $2, shape = $3 WHERE id = $1`, [
      access.sheet.id,
      shape.name,
      JSON.stringify(mapShape(shape, loaded.maps.stored)),
    ]);
    await bumpSheet(tx, access, expected);
  });
}

/** A personal copy for `user`: the same shape and calculations (new ids), its own version from 1, owned by them. */
export async function copySheet(app: App, user: AuthUser, access: SheetAccess): Promise<string> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const calculations = loaded.scope.calculations.map((c) => ({ ...c, id: newId() }));
  const scope: SheetScope = { ...loaded.scope, calculations };
  const maps = refMaps([...loaded.dataset.fields, ...calculations, ...loaded.sets], loaded.parameters);
  const id = newId();
  await app.db.transaction(async (tx) => {
    await tx.exec(`INSERT INTO sheets (id, workbook_id, owner_id, name, shape) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      access.workbook.id,
      user.id,
      loaded.shape.name,
      JSON.stringify(mapShape(loaded.shape, maps.stored)),
    ]);
    for (const c of calculations) {
      await tx.exec(`INSERT INTO calculations (id, sheet_id, name, formula) VALUES ($1, $2, $3, $4)`, [
        c.id,
        id,
        c.name,
        toStoredFormula(c.formula, scope),
      ]);
    }
  });
  return id;
}

/** Validates and saves a new (`id` null) or changed calculation; 422 with the engine's field errors. */
export async function saveCalculation(
  app: App,
  access: SheetAccess,
  draft: { id: string | null; name: string; formula: string },
): Promise<CalculationDef> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const errors = validateCalculation(draft, loaded.scope, app.config);
  const messages: Record<string, string> = {};
  if (errors.name !== undefined) messages.name = errors.name;
  if (errors.formula !== undefined) messages.formula = errors.formula;
  if (Object.keys(messages).length > 0) throw invalid(messages);
  const name = draft.name.trim();
  const stored = toStoredFormula(draft.formula, loaded.scope);
  const id = draft.id ?? newId();
  await app.db.transaction(async (tx) => {
    if (draft.id === null) {
      await tx.exec(`INSERT INTO calculations (id, sheet_id, name, formula) VALUES ($1, $2, $3, $4)`, [
        id,
        access.sheet.id,
        name,
        stored,
      ]);
    } else {
      await tx.exec(`UPDATE calculations SET name = $2, formula = $3 WHERE id = $1`, [id, name, stored]);
    }
    await bumpSheet(tx, access);
  });
  return { id, name, formula: draft.formula };
}
