import { readRows, snapshotTables } from '../extracts/snapshot.ts';
import type { App } from '../http/app.ts';
import { notFound } from '../http/errors.ts';
import type { SourceModel } from './model.ts';
import { getFields, getSource } from './repo.ts';

interface Cached {
  rev: number;
  model: SourceModel;
}

/** Models kept, most recently built last; older ones leave first (engine caches keyed on them follow). */
const MAX_MODELS = 64;
const models = new Map<string, Cached>();
const loading = new Map<string, Promise<SourceModel>>();

/**
 * The source at its current snapshot. The same object comes back until the snapshot swaps or a field, relation,
 * hierarchy or security edit bumps the source's `rev`, so caches keyed on the object stay correct.
 */
export async function loadSourceModel(app: App, sourceId: string): Promise<SourceModel> {
  const head = await app.db.row<{ rev: number; snapshot_id: string }>(
    `SELECT s.rev, e.snapshot_id FROM sources s JOIN extracts e ON e.source_id = s.id WHERE s.id = $1`,
    [sourceId],
  );
  if (!head) throw notFound();
  const cached = models.get(sourceId);
  if (cached && cached.rev === head.rev && cached.model.snapshotId === head.snapshot_id) return cached.model;
  const key = `${sourceId}/${head.rev}/${head.snapshot_id}`;
  const pending = loading.get(key) ?? readModel(app, sourceId);
  loading.set(key, pending);
  try {
    return await pending;
  } finally {
    loading.delete(key);
  }
}

/** Reads everything in one repeatable-read transaction, so a snapshot swapping meanwhile is seen whole or not at all. */
async function readModel(app: App, sourceId: string): Promise<SourceModel> {
  const { rev, model } = await app.db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const source = await getSource(tx, sourceId);
    const extract = await tx.row<{ snapshot_id: string }>(`SELECT snapshot_id FROM extracts WHERE source_id = $1`, [
      sourceId,
    ]);
    if (!source || !extract) throw notFound();
    const fields = await getFields(tx, sourceId);
    const tables = [];
    for (const table of await snapshotTables(tx, sourceId)) {
      tables.push({ name: table.table_name, columns: table.columns, rows: await readRows(tx, table.snapshot_id) });
    }
    const nameOf = (id: string) => fields.find((f) => f.id === id)?.name;
    const hierarchy = source.hierarchy && {
      name: source.hierarchy.name,
      fields: source.hierarchy.fields.flatMap((id) => nameOf(id) ?? []),
    };
    const built: SourceModel = {
      sourceId,
      snapshotId: extract.snapshot_id,
      tables,
      fields,
      relation: source.relation,
      hierarchy,
      security: {
        field: fields.find((f) => f.id === source.security_field) ?? null,
        users: source.entitlements,
      },
    };
    return { rev: source.rev, model: built };
  });
  const current = models.get(sourceId);
  if (!current || current.rev <= rev) {
    models.delete(sourceId);
    models.set(sourceId, { rev, model });
    const oldest = models.keys().next().value;
    if (models.size > MAX_MODELS && oldest !== undefined) models.delete(oldest);
  }
  return model;
}
