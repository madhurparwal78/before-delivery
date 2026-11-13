import type { PoolClient, QueryResultRow } from 'pg';
import type {
  Cell,
  CellType,
  KernelStatus,
  Notebook,
  NotebookOutput,
  RunState,
} from '../shared/types.js';
import { cellHeadings } from '../shared/toc.js';
import { query, queryOne } from './db.js';
import { conflict, storageUnavailable } from './errors.js';
import type { NotebookAccess } from './access.js';
import { putObject, storageKeys, StorageFailure } from './storage.js';
import { indexNotebook, removeNotebookFromIndex, SearchFailure } from './search.js';

interface CellRow {
  id: string;
  position: number;
  cell_type: CellType;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: RunState;
  outputs: NotebookOutput[];
  outputs_version: number;
  metadata: Record<string, unknown>;
  locked_by: string | null;
}

const CELL_COLUMNS = `
  c.id, c.position, c.cell_type, c.source, c.revision, c.execution_count,
  c.run_state, c.outputs, c.outputs_version, c.metadata,
  (select u.display_name
     from cell_locks l
     join users u on u.id = l.user_id
    where l.notebook_id = c.notebook_id and l.cell_id = c.id) as locked_by`;

type Queryable = Pick<PoolClient, 'query'>;

async function rows<T extends QueryResultRow>(
  client: Queryable | null,
  text: string,
  values: readonly unknown[],
): Promise<T[]> {
  if (!client) return query<T>(text, values);
  const result = await client.query<T>(text, values as unknown[]);
  return result.rows;
}

function toCell(row: CellRow): Cell {
  return {
    id: row.id,
    position: row.position,
    cell_type: row.cell_type,
    source: row.source,
    revision: row.revision,
    execution_count: row.execution_count,
    run_state: row.run_state,
    outputs: row.outputs,
    outputs_version: row.outputs_version,
    metadata: row.metadata,
    locked_by: row.locked_by,
  };
}

export async function loadCells(notebookId: string, client: Queryable | null = null): Promise<Cell[]> {
  const found = await rows<CellRow>(
    client,
    `select ${CELL_COLUMNS} from cells c where c.notebook_id = $1 order by c.position`,
    [notebookId],
  );
  return found.map(toCell);
}

export async function loadCell(
  notebookId: string,
  cellId: string,
  client: Queryable | null = null,
): Promise<Cell | null> {
  const found = await rows<CellRow>(
    client,
    `select ${CELL_COLUMNS} from cells c where c.notebook_id = $1 and c.id = $2`,
    [notebookId, cellId],
  );
  return found.length > 0 ? toCell(found[0]) : null;
}

/**
 * The status every screen shows: busy while any tab's kernel is busy, otherwise
 * the most recent report from any tab.
 */
export async function kernelStatusOf(notebookId: string): Promise<KernelStatus> {
  const busy = await queryOne<{ one: number }>(
    `select 1 as one from kernel_reports where notebook_id = $1 and status = 'busy' limit 1`,
    [notebookId],
  );
  if (busy) return 'busy';
  const latest = await queryOne<{ status: KernelStatus }>(
    `select status from kernel_reports where notebook_id = $1 order by seq desc limit 1`,
    [notebookId],
  );
  return latest ? latest.status : 'idle';
}

export async function buildNotebook(access: NotebookAccess): Promise<Notebook> {
  const owner = await queryOne<{ display_name: string }>(`select display_name from users where id = $1`, [
    access.notebook.owner_id,
  ]);
  return {
    id: access.notebook.id,
    title: access.notebook.title,
    role: access.role,
    owner_display_name: owner ? owner.display_name : '',
    imported: access.notebook.imported,
    execution_counter: access.notebook.execution_counter,
    kernel_status: await kernelStatusOf(access.notebook.id),
    cells: await loadCells(access.notebook.id),
  };
}

export async function touchNotebook(notebookId: string, client: Queryable | null = null): Promise<void> {
  await rows(client, `update notebooks set modified_at = now(), search_dirty = true where id = $1`, [
    notebookId,
  ]);
}

/** Renumbers positions 0..n-1 in the one server order. */
export async function renumber(client: Queryable, notebookId: string, orderedIds: string[]): Promise<void> {
  for (let index = 0; index < orderedIds.length; index += 1) {
    await client.query(`update cells set position = $1 where notebook_id = $2 and id = $3`, [
      index,
      notebookId,
      orderedIds[index],
    ]);
  }
}

/** Takes the notebook row's lock so every structural change is applied in order. */
export async function lockNotebook(client: Queryable, notebookId: string): Promise<void> {
  await client.query(`select id from notebooks where id = $1 for update`, [notebookId]);
}

/**
 * Lock checks come before revision checks: a cell held by another tab refuses
 * the whole write.
 */
export async function assertCellsUnlocked(
  client: Queryable,
  notebookId: string,
  cellIds: string[],
  tabId: string,
): Promise<void> {
  if (cellIds.length === 0) return;
  const held = await client.query<{ cell_id: string; tab_id: string; holder: string }>(
    `select l.cell_id, l.tab_id, u.display_name as holder
       from cell_locks l join users u on u.id = l.user_id
      where l.notebook_id = $1 and l.cell_id = any($2::text[]) and l.tab_id <> $3
      order by l.cell_id`,
    [notebookId, cellIds, tabId],
  );
  const blocked = held.rows[0];
  if (blocked) {
    throw conflict('cell_locked', { cell_id: blocked.cell_id, holder: blocked.holder });
  }
}

export async function nextExecutionCount(notebookId: string): Promise<number> {
  const updated = await queryOne<{ execution_counter: number }>(
    `update notebooks set execution_counter = execution_counter + 1
      where id = $1 returning execution_counter`,
    [notebookId],
  );
  if (!updated) throw new Error(`notebook ${notebookId} is gone`);
  return updated.execution_counter;
}

/** The whole notebook in the export format, used for working copies and checkpoints. */
export function notebookFileOf(cells: Cell[]): string {
  return JSON.stringify(
    {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: {
          name: 'brackenpad-js',
          display_name: 'JavaScript (Brackenpad)',
          language: 'javascript',
        },
        language_info: { name: 'javascript' },
      },
      cells: cells.map((cell) =>
        cell.cell_type === 'code'
          ? {
              id: cell.id,
              cell_type: cell.cell_type,
              source: cell.source,
              metadata: cell.metadata,
              execution_count: cell.execution_count,
              outputs: cell.outputs,
            }
          : {
              id: cell.id,
              cell_type: cell.cell_type,
              source: cell.source,
              metadata: cell.metadata,
            },
      ),
    },
    null,
    1,
  );
}

/** Rewrites the working copy in MinIO; a failure refuses the save. */
export async function writeWorkingCopy(notebookId: string, cells: Cell[]): Promise<void> {
  try {
    await putObject(storageKeys.working(notebookId), Buffer.from(notebookFileOf(cells), 'utf8'), 'application/json');
  } catch (error) {
    if (error instanceof StorageFailure) throw storageUnavailable();
    throw error;
  }
}

async function readerIds(notebookId: string, ownerId: string): Promise<string[]> {
  const shared = await query<{ user_id: string }>(
    `select user_id from shares where notebook_id = $1 and status = 'active' and user_id is not null`,
    [notebookId],
  );
  return [ownerId, ...shared.map((row) => row.user_id)];
}

/** Writes the notebook's search document, clearing the dirty flag on success. */
export async function syncSearchDocument(notebookId: string): Promise<void> {
  const notebook = await queryOne<{ id: string; title: string; owner_id: string }>(
    `select id, title, owner_id from notebooks where id = $1`,
    [notebookId],
  );
  if (!notebook) {
    await removeNotebookFromIndex(notebookId);
    return;
  }
  const cells = await loadCells(notebookId);
  await indexNotebook({
    id: notebook.id,
    title: notebook.title,
    cells: cells.map((cell) => cell.source),
    headings: cells
      .filter((cell) => cell.cell_type === 'markdown')
      .flatMap((cell) => cellHeadings(cell.source).map((heading) => heading.text)),
    reader_ids: await readerIds(notebookId, notebook.owner_id),
  });
  await query(`update notebooks set search_dirty = false where id = $1`, [notebookId]);
}

/** Updates the search document in the background, leaving it dirty on failure. */
export function scheduleSearchSync(notebookId: string): void {
  void syncSearchDocument(notebookId).catch((error: unknown) => {
    if (!(error instanceof SearchFailure)) throw error;
  });
}

export function startSearchRetry(): void {
  setInterval(() => {
    void query<{ id: string }>(`select id from notebooks where search_dirty = true limit 20`).then(
      async (dirty) => {
        for (const notebook of dirty) {
          try {
            await syncSearchDocument(notebook.id);
          } catch (error) {
            if (!(error instanceof SearchFailure)) throw error;
            return;
          }
        }
      },
    );
  }, 5000).unref();
}
