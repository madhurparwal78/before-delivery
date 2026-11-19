import { db } from '../db.js';
import { forbidden, notFound } from '../http/errors.js';
import type { AuthedCtx } from '../http/api.js';
import type { AccessView } from '../domain/access.js';
import type { FileRow, FolderRow } from '../domain/rows.js';

export const FILE_COLUMNS =
  'id, name, folder_id, size, content_type, modified_at, locked, state';

export const folderOr404 = async (ctx: AuthedCtx, id: string): Promise<FolderRow> => {
  const view = await ctx.view();
  const folder = view.folder(id);
  if (folder === null || view.folderAccess(id) === null) throw notFound();
  return folder;
};

export const loadFileRow = async (id: string): Promise<FileRow | null> => {
  const { rows } = await db.query<FileRow>(`SELECT ${FILE_COLUMNS} FROM files WHERE id = $1`, [id]);
  return rows[0] ?? null;
};

/** Files are found only while the caller may see them; binned files only inside the bin. */
export const fileOr404 = async (
  ctx: AuthedCtx,
  id: string,
  options: { allowBinned?: boolean } = {},
): Promise<FileRow> => {
  const view = await ctx.view();
  const file = await loadFileRow(id);
  if (file === null) throw notFound();
  if (file.state === 'binned' && options.allowBinned !== true) throw notFound();
  if (file.state === 'binned' && !view.isStaff) throw notFound();
  if (file.state === 'live' && view.fileAccess(file) === null) throw notFound();
  return file;
};

export const requireEditorOnFolder = (view: AccessView, folderId: string): void => {
  if (view.folderAccess(folderId) !== 'editor') throw forbidden();
};

export const requireEditorOnFile = (view: AccessView, file: FileRow): void => {
  if (view.fileAccess(file) !== 'editor') throw forbidden();
};

export const requireStaff = (ctx: AuthedCtx): void => {
  if (ctx.person.kind !== 'staff') throw forbidden();
};

export const requireController = (ctx: AuthedCtx): void => {
  if (ctx.person.staffRole !== 'controller') throw forbidden();
};

export const requireAdmin = (ctx: AuthedCtx): void => {
  if (ctx.person.staffRole !== 'admin') throw forbidden();
};
