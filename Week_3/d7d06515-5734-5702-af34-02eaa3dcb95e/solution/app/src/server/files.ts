// Folders, the file listing, recent drawings and the support set; helpers C2's routes call for Date Modified and Recent.
import { randomUUID } from 'node:crypto';
import { BLOCK_LIBRARY } from '../shared/blocks.ts';
import { COPY, copy } from '../shared/copy.ts';
import { BLOCK_NAMES, LINETYPES, STYLE_NAMES, type FolderItem, type SupportFiles } from '../shared/types.ts';
import { linkStatus, requireCaller, requireUser, type UserRow } from './access.ts';
import { dateTimeLabel, sizeLabel, workspaceNow } from './clock.ts';
import { isUuid, pool, query, transaction, type Queryable } from './db.ts';
import { PLOT_STYLES } from './engine/models.ts';
import { publishAccount } from './events.ts';
import { HttpError, registerRoute, validation } from './http.ts';

const SORTS = ['type', 'name', 'modified', 'size', 'owner', 'shared'] as const;
type Sort = (typeof SORTS)[number];
const SAMPLE_OWNER = 'Corbel Works';
const SAMPLES_FOLDER = 'Sample Files';
const NO_VALUE = '—';
const FOLDER_FORBIDDEN = /[/\\:*?"<>|]/;
const RECENT_LIMIT = 10;

interface FolderRow { id: string; name: string; parent_id: string | null; modified_at: Date }
interface DrawingItemRow { id: string; name: string; modified_at: Date; sample: boolean; size_bytes: number | null }

/** A folder's Date Modified moves when something is created, uploaded or deleted directly inside it. */
export async function touchFolder(client: Queryable, folderId: string, at: Date): Promise<void> {
  await client.query('UPDATE folders SET modified_at = $2 WHERE id = $1', [folderId, at]);
}

/** Records that the account opened a drawing (only the latest 10 are kept) and tells the account's other tabs. */
export async function recordOpened(client: Queryable, userId: string, drawingId: string, at: Date): Promise<void> {
  await client.query(
    `INSERT INTO recents (user_id, drawing_id, opened_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, drawing_id) DO UPDATE SET opened_at = EXCLUDED.opened_at`,
    [userId, drawingId, at],
  );
  await client.query(
    `DELETE FROM recents WHERE user_id = $1 AND drawing_id NOT IN
       (SELECT drawing_id FROM recents WHERE user_id = $1 ORDER BY opened_at DESC LIMIT ${RECENT_LIMIT})`,
    [userId],
  );
  await publishAccount(userId, { type: 'recent' });
}

function folderItem(row: FolderRow, zone: string): FolderItem {
  return {
    id: row.id, kind: 'folder', name: row.name, modified_at: row.modified_at.toISOString(),
    modified_label: dateTimeLabel(row.modified_at, zone), size_bytes: null, size_label: NO_VALUE, owner: 'You', shared: NO_VALUE,
  };
}

/** Drawing rows as listing items; `Shared` when the drawing has an active link on the workspace clock. */
async function drawingItems(rows: readonly DrawingItemRow[], user: UserRow): Promise<FolderItem[]> {
  if (rows.length === 0) return [];
  const now = await workspaceNow(user.workspace_id);
  const shares = await query<{ drawing_id: string; revoked_at: Date | null; expires_at: Date | null }>(
    'SELECT drawing_id, revoked_at, expires_at FROM shares WHERE drawing_id = ANY($1::uuid[])', [rows.map((row) => row.id)]);
  const shared = new Set(shares.filter((share) => linkStatus(share, now) === 'active').map((share) => share.drawing_id));
  return rows.map((row): FolderItem => ({
    id: row.id, kind: 'drawing', name: row.name, modified_at: row.modified_at.toISOString(),
    modified_label: dateTimeLabel(row.modified_at, user.time_zone),
    size_bytes: row.size_bytes, size_label: row.size_bytes === null ? NO_VALUE : sizeLabel(row.size_bytes),
    owner: row.sample ? SAMPLE_OWNER : 'You', shared: shared.has(row.id) ? 'Shared' : NO_VALUE,
  }));
}

const DRAWING_COLUMNS = `d.id, d.name, d.modified_at, d.sample,
  (SELECT f.size_bytes FROM file_versions f WHERE f.drawing_id = d.id ORDER BY f.number DESC LIMIT 1) AS size_bytes`;

const byName = (a: FolderItem, b: FolderItem): number => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const extensionOf = (item: FolderItem): string => (item.kind === 'folder' ? '' : item.name.slice(item.name.lastIndexOf('.') + 1).toUpperCase());

const COMPARE: Record<Sort, (a: FolderItem, b: FolderItem) => number> = {
  type: (a, b) => extensionOf(a).localeCompare(extensionOf(b)),
  name: byName,
  modified: (a, b) => Date.parse(a.modified_at) - Date.parse(b.modified_at),
  size: (a, b) => (a.size_bytes ?? -1) - (b.size_bytes ?? -1),
  owner: (a, b) => a.owner.localeCompare(b.owner),
  shared: (a, b) => a.shared.localeCompare(b.shared),
};

/** Folders first, then the requested column and direction; ties by name A to Z. */
function arrange(items: FolderItem[], sort: Sort, descending: boolean): FolderItem[] {
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const order = COMPARE[sort](a, b);
    return (descending ? -order : order) || byName(a, b);
  });
}

async function findFolder(user: UserRow, id: string, client: Queryable = pool): Promise<FolderRow> {
  const { rows } = id === 'root'
    ? await client.query<FolderRow>('SELECT id, name, parent_id, modified_at FROM folders WHERE workspace_id = $1 AND parent_id IS NULL', [user.workspace_id])
    : isUuid(id)
      ? await client.query<FolderRow>('SELECT id, name, parent_id, modified_at FROM folders WHERE id = $1 AND workspace_id = $2', [id, user.workspace_id])
      : { rows: [] };
  const folder = rows[0];
  if (!folder) throw new HttpError(404, { error: 'not_found' });
  return folder;
}

function folderNameError(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name.length < 1 || [...name].length > 80 || FOLDER_FORBIDDEN.test(name) ? COPY.folderNameInvalid : null;
}

export function registerFileRoutes(): void {
  registerRoute('GET', '/api/folders/:id', async (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.params.id ?? '';
    const samples = id === 'samples';
    const folder = samples ? null : await findFolder(user, id);
    const sort = ctx.query.get('sort') ?? 'modified';
    const order = ctx.query.get('order') ?? 'desc';
    const errors: Record<string, string> = {};
    if (!(SORTS as readonly string[]).includes(sort)) errors.sort = 'Sort by type, name, modified, size, owner or shared.';
    if (order !== 'asc' && order !== 'desc') errors.order = 'Order by asc or desc.';
    if (Object.keys(errors).length > 0) throw validation(errors);
    const folders = folder ? await query<FolderRow>('SELECT id, name, parent_id, modified_at FROM folders WHERE parent_id = $1', [folder.id]) : [];
    const drawings = samples
      ? await query<DrawingItemRow>(`SELECT ${DRAWING_COLUMNS} FROM drawings d WHERE d.workspace_id = $1 AND d.sample AND d.deleted_at IS NULL`, [user.workspace_id])
      : await query<DrawingItemRow>(`SELECT ${DRAWING_COLUMNS} FROM drawings d WHERE d.folder_id = $1 AND d.deleted_at IS NULL`, [folder?.id]);
    const needle = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const items = [...folders.map((row) => folderItem(row, user.time_zone)), ...await drawingItems(drawings, user)]
      .filter((item) => item.name.toLowerCase().includes(needle));
    return {
      status: 200,
      body: {
        folder: folder ? { id: folder.id, name: folder.name, parent_id: folder.parent_id } : { id: 'samples', name: SAMPLES_FOLDER, parent_id: null },
        items: arrange(items, sort as Sort, order === 'desc'),
      },
    };
  });

  registerRoute('POST', '/api/folders', async (ctx) => {
    const user = requireUser(ctx);
    const body = await ctx.json();
    const parentId = typeof body.parent_id === 'string' ? body.parent_id : '';
    const parent = await findFolder(user, parentId);
    const invalid = folderNameError(body.name);
    if (invalid) throw validation({ name: invalid });
    const name = String(body.name).trim();
    const at = await workspaceNow(user.workspace_id);
    const row: FolderRow = { id: randomUUID(), name, parent_id: parent.id, modified_at: at };
    await transaction(async (client) => {
      try {
        await client.query(
          'INSERT INTO folders (id, workspace_id, parent_id, name, name_key, created_at, modified_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
          [row.id, user.workspace_id, parent.id, name, name.toLowerCase(), at],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw validation({ name: copy.folderTaken(name) });
        throw error;
      }
      await touchFolder(client, parent.id, at);
    });
    await publishAccount(user.id, { type: 'files', folder_id: parent.id });
    return { status: 201, body: { folder: { ...folderItem(row, user.time_zone), parent_id: parent.id } } };
  });

  registerRoute('DELETE', '/api/folders/:id', async (ctx) => {
    const user = requireUser(ctx);
    const parentId = await transaction(async (client) => {
      const folder = await findFolder(user, ctx.params.id ?? '', client);
      if (!folder.parent_id) throw new HttpError(403, { error: 'forbidden' });
      const { rows } = await client.query<{ items: number }>(
        `SELECT (SELECT count(*) FROM folders WHERE parent_id = $1)::int
              + (SELECT count(*) FROM drawings WHERE folder_id = $1 AND deleted_at IS NULL)::int AS items`,
        [folder.id],
      );
      if ((rows[0]?.items ?? 0) > 0) throw new HttpError(409, { error: 'folder_not_empty' });
      await client.query('UPDATE drawings SET folder_id = NULL WHERE folder_id = $1', [folder.id]);
      await client.query('DELETE FROM folders WHERE id = $1', [folder.id]);
      await touchFolder(client, folder.parent_id, await workspaceNow(user.workspace_id, client));
      return folder.parent_id;
    });
    await publishAccount(user.id, { type: 'files', folder_id: parentId });
    return { status: 204 };
  });

  registerRoute('GET', '/api/recent', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await query<DrawingItemRow>(
      `SELECT ${DRAWING_COLUMNS} FROM recents r JOIN drawings d ON d.id = r.drawing_id
        WHERE r.user_id = $1 AND d.deleted_at IS NULL ORDER BY r.opened_at DESC LIMIT ${RECENT_LIMIT}`,
      [user.id],
    );
    return { status: 200, body: { items: await drawingItems(rows, user) } };
  });

  registerRoute('GET', '/api/support-files', async (ctx) => {
    requireCaller(ctx);
    const files: SupportFiles = {
      linetypes: [...LINETYPES],
      plot_styles: [...PLOT_STYLES],
      blocks: BLOCK_NAMES.map((name) => ({ name, base_point: BLOCK_LIBRARY[name].base_point })),
      templates: ['Title block A3'],
      text_styles: [...STYLE_NAMES],
    };
    return { status: 200, body: files };
  });
}
