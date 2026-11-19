import { db, type Queryable } from '../db.js';
import { endOfDated, serverNow } from './clock.js';
import { HIDDEN_FOLDER_NAME } from '../../shared/copy.js';
import type { FileRow, FolderRow, GrantRow } from './rows.js';
import type { Person, Role } from '../../shared/types.js';

/** A grant is live through every instant of its end date. Decided here and nowhere else. */
export const grantIsLive = (row: Pick<GrantRow, 'status' | 'end_date'>): boolean =>
  row.status === 'active' && serverNow().getTime() < endOfDated(row.end_date).getTime();

const higher = (a: Role | null, b: Role | null): Role | null => {
  if (a === 'editor' || b === 'editor') return 'editor';
  if (a === 'viewer' || b === 'viewer') return 'viewer';
  return null;
};

/** Everything one caller may see, worked out from the live grants and the folder tree. */
export class AccessView {
  readonly person: Person;
  private readonly folders: Map<string, FolderRow>;
  private readonly liveGrants: GrantRow[];

  constructor(person: Person, folders: Map<string, FolderRow>, liveGrants: GrantRow[]) {
    this.person = person;
    this.folders = folders;
    this.liveGrants = liveGrants;
  }

  get isStaff(): boolean {
    return this.person.kind === 'staff';
  }

  folder(id: string): FolderRow | null {
    return this.folders.get(id) ?? null;
  }

  allFolders(): FolderRow[] {
    return [...this.folders.values()];
  }

  /** The folders from the top down to and including `id`. */
  chain(id: string): FolderRow[] {
    const out: FolderRow[] = [];
    let current = this.folders.get(id) ?? null;
    while (current !== null) {
      out.unshift(current);
      current = current.parent_id === null ? null : this.folders.get(current.parent_id) ?? null;
    }
    return out;
  }

  projectOf(folderId: string): FolderRow | null {
    return this.chain(folderId)[0] ?? null;
  }

  ownerIdOf(folderId: string): string | null {
    return this.projectOf(folderId)?.owner_id ?? null;
  }

  folderAccess(id: string): Role | null {
    if (!this.folders.has(id)) return null;
    if (this.isStaff) return 'editor';
    const ids = new Set(this.chain(id).map((folder) => folder.id));
    let role: Role | null = null;
    for (const grant of this.liveGrants) {
      if (grant.item_type === 'folder' && ids.has(grant.item_id)) role = higher(role, grant.role);
    }
    return role;
  }

  fileAccess(file: FileRow): Role | null {
    if (this.isStaff) return 'editor';
    if (file.state === 'binned') return null;
    let role = this.folderAccess(file.folder_id);
    for (const grant of this.liveGrants) {
      if (grant.item_type === 'file' && grant.item_id === file.id) role = higher(role, grant.role);
    }
    return role;
  }

  /** The end date of the live grants that give the caller their current role on a file. */
  accessEndsFor(file: FileRow): string | null {
    if (this.isStaff) return null;
    const role = this.fileAccess(file);
    if (role === null) return null;
    const folderIds = new Set(this.chain(file.folder_id).map((folder) => folder.id));
    let latest: string | null = null;
    for (const grant of this.liveGrants) {
      if (grant.role !== role) continue;
      const covers =
        (grant.item_type === 'file' && grant.item_id === file.id) ||
        (grant.item_type === 'folder' && folderIds.has(grant.item_id));
      if (covers && (latest === null || grant.end_date > latest)) latest = grant.end_date;
    }
    return latest;
  }

  accessEndsForFolder(id: string): string | null {
    if (this.isStaff) return null;
    const role = this.folderAccess(id);
    if (role === null) return null;
    const ids = new Set(this.chain(id).map((folder) => folder.id));
    let latest: string | null = null;
    for (const grant of this.liveGrants) {
      if (grant.role !== role || grant.item_type !== 'folder' || !ids.has(grant.item_id)) continue;
      if (latest === null || grant.end_date > latest) latest = grant.end_date;
    }
    return latest;
  }

  visibleFolders(): FolderRow[] {
    return this.allFolders().filter((folder) => this.folderAccess(folder.id) !== null);
  }

  /** Folders a partner cannot see are named "another folder" and carry no id. */
  folderRef(id: string | null): { id: string | null; name: string } {
    if (id === null) return { id: null, name: HIDDEN_FOLDER_NAME };
    const folder = this.folders.get(id);
    if (folder === undefined || this.folderAccess(id) === null) {
      return { id: null, name: HIDDEN_FOLDER_NAME };
    }
    return { id: folder.id, name: folder.name };
  }

  /** The visible part of the path down to a folder, highest visible folder first. */
  pathTo(folderId: string): { id: string; name: string }[] {
    return this.chain(folderId)
      .filter((folder) => this.folderAccess(folder.id) !== null)
      .map((folder) => ({ id: folder.id, name: folder.name }));
  }

  /** Only a project's owner or a document controller shares or hands over inside it. */
  canShareIn(folderId: string): boolean {
    if (!this.isStaff) return false;
    if (this.person.staffRole === 'controller') return true;
    return this.ownerIdOf(folderId) === this.person.id;
  }

  directGrants(): GrantRow[] {
    return this.liveGrants;
  }
}

export const loadFolders = async (tx: Queryable = db): Promise<Map<string, FolderRow>> => {
  const { rows } = await tx.query<FolderRow>(
    'SELECT id, name, parent_id, owner_id FROM folders',
  );
  return new Map(rows.map((row) => [row.id, row]));
};

export const loadAccessView = async (person: Person, tx: Queryable = db): Promise<AccessView> => {
  const folders = await loadFolders(tx);
  if (person.kind === 'staff') return new AccessView(person, folders, []);
  const { rows } = await tx.query<GrantRow>(
    `SELECT id, item_type, item_id, person_id, role, end_date, status, ended_reason
       FROM grants WHERE person_id = $1 AND status = 'active'`,
    [person.id],
  );
  return new AccessView(person, folders, rows.filter(grantIsLive));
};
