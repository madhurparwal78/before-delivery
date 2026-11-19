// Who may see and do what (brief: People and capabilities; Partner access; What partners see of hidden folders).
// Effective access, a partner's access end date and hidden-folder naming are decided here and nowhere else.
import type { Db } from "./db.js";
import { rows } from "./db.js";
import { activeGrantsOf, type GrantRow } from "./grants.js";
import { today as companyToday } from "./clock.js";
import { HIDDEN_FOLDER_NAME, mayShare } from "../shared/rules.js";
import type { CompanyDate, DriveFile, Folder, Named, Person, Role, ShownFolder } from "../shared/api.js";

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

export interface FileRow {
  id: string;
  name: string;
  folder_id: string;
  size: number;
  content_type: string;
  modified_at: Date;
  locked: boolean;
  binned_date: CompanyDate | null;
  retention_days: number | null;
}

const PREVIEWABLE = new Set(["image/png", "image/jpeg", "application/pdf"]);

export function isPreviewable(contentType: string): boolean {
  return PREVIEWABLE.has(contentType.split(";")[0]!.trim().toLowerCase());
}

function higher(a: Role | null, b: Role | null): Role | null {
  if (a === "editor" || b === "editor") return "editor";
  return a ?? b;
}

export class Viewer {
  readonly staff: boolean;

  private constructor(
    readonly person: Person,
    readonly today: CompanyDate,
    readonly folders: Map<string, FolderRow>,
    private readonly counts: Map<string, number>,
    private readonly grants: GrantRow[],
  ) {
    this.staff = person.kind === "staff";
  }

  static async load(db: Db, person: Person, day: CompanyDate = companyToday()): Promise<Viewer> {
    // One query at a time: `db` may be a transaction's client, which runs a single query at once.
    const folders = await rows<FolderRow>(db, "SELECT id, name, parent_id, owner_id, owner_name FROM folders");
    const counts = await rows<{ folder_id: string; n: number }>(db,
      "SELECT folder_id, count(*)::int AS n FROM files WHERE binned_date IS NULL GROUP BY folder_id");
    const grants = person.kind === "partner" ? await activeGrantsOf(db, person.id, day) : [];
    return new Viewer(person, day, new Map(folders.map((f) => [f.id, f])),
      new Map(counts.map((c) => [c.folder_id, c.n])), grants);
  }

  get isController(): boolean {
    return this.staff && this.person.staffRole === "controller";
  }

  get isAdmin(): boolean {
    return this.staff && this.person.staffRole === "admin";
  }

  /** The folder and its ancestors, nearest first. */
  lineage(folderId: string): FolderRow[] {
    const out: FolderRow[] = [];
    for (let f = this.folders.get(folderId); f; f = f.parent_id ? this.folders.get(f.parent_id) : undefined) out.push(f);
    return out;
  }

  project(folderId: string): FolderRow | undefined {
    return this.lineage(folderId).at(-1);
  }

  private grantsOn(itemId: string): GrantRow[] {
    return this.grants.filter((g) => g.item_id === itemId);
  }

  private grantsCovering(folderId: string): GrantRow[] {
    return this.lineage(folderId).flatMap((f) => this.grantsOn(f.id).filter((g) => g.item_type === "folder"));
  }

  folderRole(folderId: string): Role | null {
    if (!this.folders.has(folderId)) return null;
    if (this.staff) return "editor";
    return this.grantsCovering(folderId).reduce<Role | null>((role, g) => higher(role, g.role), null);
  }

  private fileGrants(file: Pick<FileRow, "id" | "folder_id">): GrantRow[] {
    return [...this.grantsOn(file.id).filter((g) => g.item_type === "file"), ...this.grantsCovering(file.folder_id)];
  }

  /** Binned files are visible to no partner, and to staff only on the bin routes. */
  fileRole(file: Pick<FileRow, "id" | "folder_id" | "binned_date">): Role | null {
    if (file.binned_date !== null) return null;
    if (this.staff) return "editor";
    return this.fileGrants(file).reduce<Role | null>((role, g) => higher(role, g.role), null);
  }

  /** The latest end date among the active grants that give the partner's current role on the file. */
  fileAccessEnds(file: Pick<FileRow, "id" | "folder_id" | "binned_date">): CompanyDate | null {
    if (this.staff) return null;
    const role = this.fileRole(file);
    const giving = this.fileGrants(file).filter((g) => g.role === role).map((g) => g.end_date).sort();
    return giving.at(-1) ?? null;
  }

  canSeeFolder(folderId: string): boolean {
    return this.folderRole(folderId) !== null;
  }

  /** A project's owner or a document controller may share inside it and offer it. */
  canShareIn(folderId: string): boolean {
    return mayShare(this.person, this.project(folderId)?.owner_id ?? null);
  }

  shownFolder(folderId: string | null): ShownFolder {
    const folder = folderId ? this.folders.get(folderId) : undefined;
    if (!folder || !this.canSeeFolder(folder.id)) return { id: null, name: HIDDEN_FOLDER_NAME };
    return { id: folder.id, name: folder.name };
  }

  /** Visible folders from the highest visible one down to `folderId`. */
  path(folderId: string): Named[] {
    const out: Named[] = [];
    for (const f of this.lineage(folderId)) {
      if (!this.canSeeFolder(f.id)) break;
      out.unshift({ id: f.id, name: f.name });
    }
    return out;
  }

  visibleFolders(): FolderRow[] {
    return [...this.folders.values()].filter((f) => this.canSeeFolder(f.id));
  }

  folder(row: FolderRow): Folder {
    const project = this.project(row.id) ?? row;
    const role = this.folderRole(row.id);
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id ? this.shownFolder(row.parent_id).id : null,
      projectId: row.parent_id ? this.shownFolder(project.id).id : null,
      owner: { id: project.owner_id ?? "", name: project.owner_name ?? "" },
      fileCount: this.counts.get(row.id) ?? 0,
      access: role ?? "viewer",
    };
  }

  file(row: FileRow): DriveFile {
    const shown = this.shownFolder(row.folder_id);
    return {
      id: row.id,
      name: row.name,
      folderId: shown.id,
      folderName: shown.name,
      size: row.size,
      contentType: row.content_type,
      modifiedAt: row.modified_at.toISOString(),
      locked: row.locked,
      access: this.fileRole({ ...row, binned_date: null }) ?? "viewer",
      previewable: isPreviewable(row.content_type),
      accessEnds: this.fileAccessEnds(row),
    };
  }

  /** The partner's direct grants (Shared with me). */
  directGrants(): GrantRow[] {
    return this.grants;
  }
}
