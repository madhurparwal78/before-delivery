import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { fieldError } from '../shared/errors.ts';
import { emptyDrawingState } from '../shared/model/index.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import type { DrawingListing, FolderSummary, Role } from '../shared/types.ts';
import { requireUser } from './auth.ts';
import { objectBody } from './body.ts';
import { db } from './db.ts';
import { createDrawing } from './drawings.ts';
import { nameField } from './fields.ts';
import { requireRole, roleOnFolder } from './roles.ts';
import { route } from './router.ts';
import { sheetListing } from './sheets.ts';

route('GET', '/api/folders', async (ctx) => {
  // Every folder where the person has an entry, and below it every folder that has none of its own (it inherits).
  const rows = await db.query<FolderSummary>(
    `WITH RECURSIVE reach AS (
       SELECT f.id, f.name, f.parent_id, r.role, f.created_at FROM folder_roles r JOIN folders f ON f.id = r.folder_id WHERE r.username = $1
       UNION ALL
       SELECT c.id, c.name, c.parent_id, p.role, c.created_at FROM folders c JOIN reach p ON c.parent_id = p.id
        WHERE NOT EXISTS (SELECT 1 FROM folder_roles r WHERE r.folder_id = c.id AND r.username = $1))
     SELECT id, name, parent_id, role FROM reach ORDER BY created_at, id`,
    [requireUser(ctx).username],
  );
  return ctx.reply(200, { folders: rows });
});

route('POST', '/api/folders', async (ctx) => {
  const user = requireUser(ctx);
  const body = objectBody(ctx.json());
  const parentId = body.parent_id ?? null;
  if (typeof parentId === 'string') requireRole(await roleOnFolder(ctx, parentId), MINIMUM_ROLE.createSubfolder);
  else if (parentId !== null) throw fieldError('parent_id', copy.invalidValue('parent_id'));
  const folder: FolderSummary = { id: randomUUID(), name: nameField(body), parent_id: parentId, role: 'manage' };
  await db.tx(async (q) => {
    await q.query('INSERT INTO folders (id, name, parent_id) VALUES ($1, $2, $3)', [folder.id, folder.name, folder.parent_id]);
    await q.query('INSERT INTO folder_roles (folder_id, username, role) VALUES ($1, $2, $3)', [folder.id, user.username, folder.role]);
  });
  return ctx.reply(201, folder);
});

route('GET', '/api/folders/:id/drawings', async (ctx) => {
  await roleOnFolder(ctx, ctx.params.id);
  const rows = await db.query<{ id: string; name: string; xref_sources: string[] }>(
    'SELECT id, name, xref_sources FROM drawings WHERE folder_id = $1 ORDER BY created_at, id', [ctx.params.id],
  );
  const sheets = await sheetListing(rows.map((row) => row.id));
  const drawings: DrawingListing[] = rows.map((row) => ({ id: row.id, name: row.name, xref_sources: row.xref_sources, sheets: sheets.get(row.id) ?? [] }));
  return ctx.reply(200, { drawings });
});

route('POST', '/api/folders/:id/drawings', async (ctx) => {
  const role: Role = await roleOnFolder(ctx, ctx.params.id);
  requireRole(role, MINIMUM_ROLE.createDrawing);
  const drawing = await createDrawing(ctx.params.id, nameField(objectBody(ctx.json())), emptyDrawingState());
  return ctx.reply(201, { id: drawing.id, name: drawing.name, revision: drawing.state.revision });
});
