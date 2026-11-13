import { ApiError, MESSAGES } from '../shared/errors.js';
import { type Role, roleAtLeast } from '../shared/transitions.js';
import { one, query } from './db.js';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

interface RoleRow {
  role: Role;
}

/** A folder role, inherited from the parent folder unless set there. */
export async function roleForFolder(username: string | null, folderId: string): Promise<Role | null> {
  if (!username) return null;
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const direct = await one<RoleRow>('select role from folder_roles where folder_id = $1 and username = $2', [current, username]);
    if (direct) return direct.role;
    const folder: FolderRow | null = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [current]);
    current = folder ? folder.parent_id : null;
  }
  return null;
}

export async function folderRoles(folderId: string): Promise<{ username: string; role: Role }[]> {
  const rows: { username: string; role: Role }[] = [];
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const direct = await query<{ username: string; role: Role }>(
      'select username, role from folder_roles where folder_id = $1',
      [current],
    );
    for (const row of direct) {
      if (!rows.some((existing) => existing.username === row.username)) rows.push(row);
    }
    const folder: FolderRow | null = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [current]);
    current = folder ? folder.parent_id : null;
  }
  return rows;
}

export function notFound(): ApiError {
  return new ApiError('not_found', MESSAGES.notFound);
}

export function requireSignedIn(username: string | null): string {
  if (!username) throw new ApiError('unauthenticated', MESSAGES.unauthenticated);
  return username;
}

export function requireRole(role: Role | null, wanted: Role): Role {
  if (!role) throw notFound();
  if (!roleAtLeast(role, wanted)) {
    if (wanted === 'edit' && (role === 'view' || role === 'markup')) {
      throw new ApiError('read_only', MESSAGES.readOnly);
    }
    throw new ApiError('forbidden', MESSAGES.forbidden);
  }
  return role;
}
