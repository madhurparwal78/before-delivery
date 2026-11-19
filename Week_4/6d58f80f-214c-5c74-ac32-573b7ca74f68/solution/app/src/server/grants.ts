// Timed partner grants (brief: Business rules, Grants). The grant end edge is decided by `grantActive` only.
import type pg from "pg";
import { first, pool, rows, tx, isUniqueViolation, type Db } from "./db.js";
import { addDays, daysBetween, isCompanyDate, now, today } from "./clock.js";
import {
  bodyObject, conflict, directoryUnavailable, forbidden, invalid, notFound, route, sendEmpty, sendJson,
} from "./http.js";
import { newId, isId } from "./ids.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { inForce } from "./policies.js";
import { DirectoryUnavailable, findPerson } from "./directory.js";
import { Viewer, type FileRow, type FolderRow } from "./access.js";
import type { CompanyDate, Grant, GrantEndedReason, ItemType, Named, Notice, Person, Role } from "../shared/api.js";

export interface GrantRow {
  id: string;
  item_type: ItemType;
  item_id: string;
  person_id: string;
  person_name: string;
  person_firm: string;
  role: Role;
  end_date: CompanyDate;
  status: "active" | "ended";
  ended_reason: GrantEndedReason | null;
}

const MAX_GRANT_DAYS = 365;
export const GRANT_COLUMNS = "id, item_type, item_id, person_id, person_name, person_firm, role, end_date, status, ended_reason";

/** A grant gives access through every instant of its end date and nothing from the next Phoenix midnight. */
function grantActive(grant: Pick<GrantRow, "status" | "end_date">, day: CompanyDate): boolean {
  return grant.status === "active" && grant.end_date >= day;
}

export async function activeGrantsOf(db: Db, personId: string, day: CompanyDate): Promise<GrantRow[]> {
  const all = await rows<GrantRow>(db, `SELECT ${GRANT_COLUMNS} FROM grants WHERE person_id = $1 AND status = 'active'`, [personId]);
  return all.filter((g) => grantActive(g, day));
}

interface Item {
  type: ItemType;
  id: string;
  name: string;
  /** The folder whose project decides who may share: the folder itself, or the file's folder. */
  folderId: string;
  file: FileRow | null;
}

async function itemOf(db: Db, type: unknown, id: unknown): Promise<Item | null> {
  if (!isId(id)) return null;
  if (type === "folder") {
    const folder = await first<FolderRow>(db, "SELECT id, name, parent_id, owner_id, owner_name FROM folders WHERE id = $1", [id]);
    return folder ? { type, id, name: folder.name, folderId: folder.id, file: null } : null;
  }
  if (type === "file") {
    const file = await first<FileRow>(db, "SELECT * FROM files WHERE id = $1 AND binned_date IS NULL", [id]);
    return file ? { type, id, name: file.name, folderId: file.folder_id, file } : null;
  }
  return null;
}

async function itemName(db: Db, grant: GrantRow): Promise<string> {
  const table = grant.item_type === "folder" ? "folders" : "files";
  return (await first<{ name: string }>(db, `SELECT name FROM ${table} WHERE id = $1`, [grant.item_id]))?.name ?? "";
}

async function presentGrant(db: Db, grant: GrantRow, day: CompanyDate = today()): Promise<Grant> {
  return {
    id: grant.id,
    itemType: grant.item_type,
    itemId: grant.item_id,
    itemName: await itemName(db, grant),
    person: { id: grant.person_id, name: grant.person_name, firm: grant.person_firm },
    role: grant.role,
    endDate: grant.end_date,
    daysLeft: daysBetween(day, grant.end_date),
    status: grant.status,
    endedReason: grant.ended_reason,
  };
}

function grantDetail(grant: GrantRow, name: string) {
  return {
    person: { id: grant.person_id, name: grant.person_name },
    role: grant.role,
    endDate: grant.end_date,
    item: { type: grant.item_type, name },
  };
}

function itemColumns(grant: GrantRow): { fileId: string | null; folderId: string | null } {
  return grant.item_type === "file" ? { fileId: grant.item_id, folderId: null } : { fileId: null, folderId: grant.item_id };
}

/** What the partner still has on the grant's item, read after the change inside the same transaction. */
async function roleAfter(client: pg.PoolClient, grant: GrantRow): Promise<Role | null> {
  const partner: Person = { id: grant.person_id, name: grant.person_name, email: "", firm: grant.person_firm, kind: "partner", staffRole: null };
  const viewer = await Viewer.load(client, partner);
  if (grant.item_type === "folder") return viewer.folderRole(grant.item_id);
  const file = await first<FileRow>(client, "SELECT * FROM files WHERE id = $1", [grant.item_id]);
  return file ? viewer.fileRole(file) : null;
}

/**
 * Ends an active grant once; false when another process got there first. The partner keeps exactly what their
 * remaining grants give, and an open screen hears the matching notice.
 */
export async function endGrant(client: pg.PoolClient, grant: GrantRow, reason: GrantEndedReason, actor: Named | null): Promise<boolean> {
  const ended = await client.query("UPDATE grants SET status = 'ended', ended_reason = $2 WHERE id = $1 AND status = 'active'", [grant.id, reason]);
  if (!ended.rowCount) return false;
  const name = await itemName(client, grant);
  await record(client, {
    actor, action: reason === "removed" ? "access_removed" : "access_ended", ...itemColumns(grant), detail: grantDetail(grant, name),
  });
  let notice: Notice | null = null;
  if (reason === "removed") notice = { kind: "removed", item: name };
  if (reason === "date") {
    const left = await roleAfter(client, grant);
    if (left === null) notice = { kind: "access_ended", item: name, date: grant.end_date };
    else if (grant.role === "editor" && left === "viewer") notice = { kind: "editor_ended", item: name, date: grant.end_date };
  }
  await publish(client, { kind: "grants", itemType: grant.item_type, itemId: grant.item_id, personId: grant.person_id, notice });
  return true;
}

/** Sweep step: grants whose end date has passed end with reason `date`. */
export async function endDueGrants(): Promise<void> {
  const day = today();
  const due = (await rows<GrantRow>(pool, `SELECT ${GRANT_COLUMNS} FROM grants WHERE status = 'active'`))
    .filter((g) => !grantActive(g, day));
  for (const grant of due) await tx((client) => endGrant(client, grant, "date", null));
}

function checkEndDate(value: unknown, day: CompanyDate): CompanyDate | { error: string } {
  const max = addDays(day, MAX_GRANT_DAYS);
  if (!isCompanyDate(value) || value < day || value > max) return { error: `Choose a date from ${day} to ${max}.` };
  return value;
}

function checkRole(value: unknown): value is Role {
  return value === "viewer" || value === "editor";
}

/** Steps 4–5 for a grant row: partners never see grants; staff who are not owner or controller get 403. */
async function grantForChange(session: { person: Person }, id: string | undefined): Promise<{ grant: GrantRow; viewer: Viewer }> {
  const viewer = await Viewer.load(pool, session.person);
  if (!viewer.staff || !isId(id)) throw notFound();
  const grant = await first<GrantRow>(pool, `SELECT ${GRANT_COLUMNS} FROM grants WHERE id = $1`, [id]);
  if (!grant) throw notFound();
  const item = await itemOf(pool, grant.item_type, grant.item_id);
  if (!item) throw notFound();
  if (!viewer.canShareIn(item.folderId)) throw forbidden();
  if (!grantActive(grant, viewer.today)) throw conflict("grant_ended");
  return { grant, viewer };
}

export function register(): void {
  route("GET", "/api/grants", async ({ res, url, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const item = await itemOf(pool, url.searchParams.get("itemType"), url.searchParams.get("itemId"));
    if (!item) throw notFound();
    const day = today();
    const list = (await rows<GrantRow>(pool, `SELECT ${GRANT_COLUMNS} FROM grants WHERE item_id = $1 AND status = 'active' ORDER BY person_name`, [item.id]))
      .filter((g) => grantActive(g, day));
    sendJson(res, 200, { grants: await Promise.all(list.map((g) => presentGrant(pool, g, day))) });
  });

  route("GET", "/api/grants/defaults", async ({ res, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const day = today();
    sendJson(res, 200, {
      today: day,
      defaultEndDate: addDays(day, await inForce(pool, "partner_grant_days", day)),
      maxEndDate: addDays(day, MAX_GRANT_DAYS),
    });
  });

  route("POST", "/api/grants", async (ctx) => {
    const { res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const item = await itemOf(pool, body.itemType, body.itemId);
    if (!item) throw notFound();
    const visible = item.file ? viewer.fileRole(item.file) !== null : viewer.canSeeFolder(item.id);
    if (!visible) throw notFound();
    if (!viewer.canShareIn(item.folderId)) throw forbidden();
    if (typeof body.personId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.personId)) throw notFound();
    let person: Person | null;
    try {
      person = await findPerson(body.personId);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (!person) throw notFound();
    const existing = await first<GrantRow>(pool, `SELECT ${GRANT_COLUMNS} FROM grants WHERE item_id = $1 AND person_id = $2 AND status = 'active'`, [item.id, person.id]);
    if (existing && grantActive(existing, viewer.today)) throw conflict("grant_exists");
    const fields: Record<string, string> = {};
    if (person.kind !== "partner") fields.personId = "Only outside partners get timed access.";
    const role = checkRole(body.role) ? body.role : null;
    if (!role) fields.role = "Choose viewer or editor.";
    let endDate: CompanyDate | null = null;
    if (body.endDate !== undefined) {
      const checked = checkEndDate(body.endDate, viewer.today);
      if (typeof checked === "string") endDate = checked;
      else fields.endDate = checked.error;
    }
    if (Object.keys(fields).length || !role) throw invalid(fields);
    const partner = person;
    const day = viewer.today;
    const grant = await tx(async (client) => {
      if (existing) await endGrant(client, existing, "date", null);
      const row: GrantRow = {
        id: newId(), item_type: item.type, item_id: item.id, person_id: partner.id, person_name: partner.name,
        person_firm: partner.firm, role,
        end_date: endDate ?? addDays(day, await inForce(client, "partner_grant_days", day)),
        status: "active", ended_reason: null,
      };
      await client.query(
        `INSERT INTO grants (${GRANT_COLUMNS}, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [row.id, row.item_type, row.item_id, row.person_id, row.person_name, row.person_firm, row.role, row.end_date, row.status, null, now()]);
      await record(client, { actor: session.person, action: "shared", ...itemColumns(row), detail: grantDetail(row, item.name) });
      await publish(client, { kind: "grants", itemType: row.item_type, itemId: row.item_id, personId: row.person_id, notice: null });
      return row;
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw conflict("grant_exists");
      throw error;
    });
    sendJson(res, 201, { grant: await presentGrant(pool, grant, day) });
  });

  route("PATCH", "/api/grants/:id", async (ctx) => {
    const { res, session, params } = ctx;
    const { grant, viewer } = await grantForChange(session, params.id);
    const body = bodyObject(ctx);
    const fields: Record<string, string> = {};
    if (body.role !== undefined && !checkRole(body.role)) fields.role = "Choose viewer or editor.";
    let endDate = grant.end_date;
    if (body.endDate !== undefined) {
      const checked = checkEndDate(body.endDate, viewer.today);
      if (typeof checked === "string") endDate = checked;
      else fields.endDate = checked.error;
    }
    if (Object.keys(fields).length) throw invalid(fields);
    const role = checkRole(body.role) ? body.role : grant.role;
    const updated = await tx(async (client) => {
      const changed = await client.query<GrantRow>(`UPDATE grants SET role = $2, end_date = $3 WHERE id = $1 AND status = 'active' RETURNING ${GRANT_COLUMNS}`, [grant.id, role, endDate]);
      const row = changed.rows[0];
      if (!row) throw conflict("grant_ended");
      const name = await itemName(client, row);
      await record(client, { actor: session.person, action: "access_changed", ...itemColumns(row), detail: grantDetail(row, name) });
      const lowered = grant.role === "editor" && role === "viewer";
      await publish(client, {
        kind: "grants", itemType: row.item_type, itemId: row.item_id, personId: row.person_id,
        notice: lowered ? { kind: "view_only", item: name } : null,
      });
      return row;
    });
    sendJson(res, 200, { grant: await presentGrant(pool, updated) });
  });

  route("DELETE", "/api/grants/:id", async ({ res, session, params }) => {
    const { grant } = await grantForChange(session, params.id);
    await tx(async (client) => {
      if (!await endGrant(client, grant, "removed", session.person)) throw conflict("grant_ended");
    });
    sendEmpty(res);
  });

  route("GET", "/api/shared", async ({ res, session }) => {
    if (session.person.kind !== "partner") throw forbidden();
    const viewer = await Viewer.load(pool, session.person);
    const items = [];
    for (const grant of viewer.directGrants()) {
      const item = await itemOf(pool, grant.item_type, grant.item_id);
      if (!item) continue;
      const folder = viewer.folders.get(grant.item_id);
      items.push({
        itemType: grant.item_type,
        folder: grant.item_type === "folder" && folder ? viewer.folder(folder) : null,
        file: item.file ? viewer.file(item.file) : null,
        role: grant.role,
        endDate: grant.end_date,
        daysLeft: daysBetween(viewer.today, grant.end_date),
      });
    }
    items.sort((a, b) => (a.folder?.name ?? a.file?.name ?? "").localeCompare(b.folder?.name ?? b.file?.name ?? ""));
    sendJson(res, 200, { items });
  });
}
