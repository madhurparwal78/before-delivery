// Project handovers (brief: Business rules, Handovers). The lapse edge is decided by `handoverStatus` only.
import type pg from "pg";
import { first, isUniqueViolation, pool, rows, tx } from "./db.js";
import { addDays, now, today } from "./clock.js";
import {
  bodyObject, conflict, directoryUnavailable, forbidden, invalid, notFound, route, sendJson,
} from "./http.js";
import { isId, newId } from "./ids.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { DirectoryUnavailable, findPerson } from "./directory.js";
import { Viewer } from "./access.js";
import type { CompanyDate, Handover, HandoverStatus, Person } from "../shared/api.js";

interface HandoverRow {
  id: string;
  folder_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  offered_date: CompanyDate;
  lapse_date: CompanyDate;
  status: HandoverStatus;
}

const MAX_DAYS = 14;
const OTHER_THAN_OWNER = "Choose a staff member other than the current owner.";

/** An offer stays acceptable through all of its lapse date and lapses at the next Phoenix midnight. */
function handoverStatus(row: Pick<HandoverRow, "status" | "lapse_date">, day: CompanyDate): HandoverStatus {
  return row.status === "offered" && row.lapse_date < day ? "lapsed" : row.status;
}

function present(viewer: Viewer, row: HandoverRow): Handover {
  return {
    id: row.id,
    folder: { id: row.folder_id, name: viewer.folders.get(row.folder_id)?.name ?? "" },
    from: { id: row.from_id, name: row.from_name },
    to: { id: row.to_id, name: row.to_name },
    offeredDate: row.offered_date,
    lapseDate: row.lapse_date,
    status: handoverStatus(row, viewer.today),
  };
}

/** The giver, the recipient and document controllers see an offer. */
function canSee(viewer: Viewer, row: HandoverRow): boolean {
  return viewer.staff && (viewer.isController || row.from_id === viewer.person.id || row.to_id === viewer.person.id);
}

/** Lapses an open offer once; ownership stays with the giver, who is told in the app. */
async function lapse(client: pg.PoolClient, row: HandoverRow): Promise<void> {
  const changed = await client.query("UPDATE handovers SET status = 'lapsed' WHERE id = $1 AND status = 'offered'", [row.id]);
  if (!changed.rowCount) return;
  await record(client, { actor: null, action: "handover_lapsed", folderId: row.folder_id, detail: { from: { id: row.from_id, name: row.from_name }, to: { id: row.to_id, name: row.to_name }, lapseDate: row.lapse_date } });
  const folder = await first<{ name: string }>(client, "SELECT name FROM folders WHERE id = $1", [row.folder_id]);
  await publish(client, { kind: "handovers", fromId: row.from_id, toId: row.to_id, notice: { kind: "handover_lapsed", person: row.to_name, folder: folder?.name ?? "" } });
}

/** Sweep step. */
export async function lapseDue(): Promise<void> {
  const day = today();
  const open = await rows<HandoverRow>(pool, "SELECT * FROM handovers WHERE status = 'offered'");
  for (const row of open.filter((r) => handoverStatus(r, day) === "lapsed")) await tx((client) => lapse(client, row));
}

async function decide(viewer: Viewer, id: string | undefined, outcome: "accepted" | "declined"): Promise<Handover> {
  const row = isId(id) ? await first<HandoverRow>(pool, "SELECT * FROM handovers WHERE id = $1", [id]) : undefined;
  if (!row || !canSee(viewer, row)) throw notFound();
  if (row.to_id !== viewer.person.id) throw forbidden();
  const status = handoverStatus(row, viewer.today);
  if (status === "lapsed" && row.status === "offered") await tx((client) => lapse(client, row));
  if (status !== "offered") throw conflict(`handover_${status}`);
  const decided = await tx(async (client) => {
    const changed = await client.query<HandoverRow>("UPDATE handovers SET status = $2 WHERE id = $1 AND status = 'offered' RETURNING *", [row.id, outcome]);
    const updated = changed.rows[0];
    if (!updated) {
      const current = await first<HandoverRow>(client, "SELECT * FROM handovers WHERE id = $1", [row.id]);
      throw conflict(`handover_${current?.status ?? "lapsed"}`);
    }
    const folder = viewer.folders.get(row.folder_id);
    if (outcome === "accepted") {
      await client.query("UPDATE folders SET owner_id = $2, owner_name = $3 WHERE id = $1", [row.folder_id, row.to_id, row.to_name]);
      await publish(client, { kind: "folders", folderIds: [row.folder_id] });
    }
    await record(client, {
      actor: viewer.person, action: outcome === "accepted" ? "handover_accepted" : "handover_declined", folderId: row.folder_id,
      detail: { from: { id: row.from_id, name: row.from_name }, to: { id: row.to_id, name: row.to_name } },
    });
    await publish(client, {
      kind: "handovers", fromId: row.from_id, toId: row.to_id,
      notice: { kind: outcome === "accepted" ? "handover_accepted" : "handover_declined", person: row.to_name, folder: folder?.name ?? "" },
    });
    return updated;
  });
  return present(viewer, decided);
}

export function register(): void {
  route("GET", "/api/handovers", async ({ res, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const viewer = await Viewer.load(pool, session.person);
    const all = await rows<HandoverRow>(pool, "SELECT * FROM handovers ORDER BY created_at DESC, id DESC");
    sendJson(res, 200, { handovers: all.filter((h) => canSee(viewer, h)).map((h) => present(viewer, h)) });
  });

  route("POST", "/api/handovers", async (ctx) => {
    const { res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const folder = isId(body.folderId) ? viewer.folders.get(body.folderId) : undefined;
    if (!folder || !viewer.canSeeFolder(folder.id)) throw notFound();
    if (!viewer.canShareIn(folder.id)) throw forbidden();
    const open = await first<HandoverRow>(pool, "SELECT * FROM handovers WHERE folder_id = $1 AND status = 'offered'", [folder.id]);
    if (open && handoverStatus(open, viewer.today) === "offered") throw conflict("handover_open");
    const fields: Record<string, string> = {};
    if (folder.parent_id !== null) fields.folderId = "Choose a project folder.";
    const days = body.days;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) fields.days = "Enter whole days from 1 to 14.";
    const toPersonId = typeof body.toPersonId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.toPersonId) ? body.toPersonId : null;
    if (!toPersonId || toPersonId === folder.owner_id) fields.toPersonId = OTHER_THAN_OWNER;
    if (Object.keys(fields).length || !toPersonId || typeof days !== "number") throw invalid(fields);
    let person: Person | null;
    try {
      person = await findPerson(toPersonId);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (!person || person.kind !== "staff") throw invalid({ toPersonId: OTHER_THAN_OWNER });
    const day = viewer.today;
    const row: HandoverRow = {
      id: newId(), folder_id: folder.id, from_id: folder.owner_id ?? session.person.id, from_name: folder.owner_name ?? session.person.name,
      to_id: person.id, to_name: person.name, offered_date: day, lapse_date: addDays(day, days), status: "offered",
    };
    await tx(async (client) => {
      if (open) await lapse(client, open);
      await client.query(
        `INSERT INTO handovers (id, folder_id, from_id, from_name, to_id, to_name, offered_date, lapse_date, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [row.id, row.folder_id, row.from_id, row.from_name, row.to_id, row.to_name, row.offered_date, row.lapse_date, row.status, now()]);
      await record(client, { actor: session.person, action: "handover_offered", folderId: folder.id, detail: { from: { id: row.from_id, name: row.from_name }, to: { id: row.to_id, name: row.to_name }, lapseDate: row.lapse_date } });
      await publish(client, { kind: "handovers", fromId: row.from_id, toId: row.to_id, notice: null });
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw conflict("handover_open");
      throw error;
    });
    sendJson(res, 201, { handover: present(viewer, row) });
  });

  route("POST", "/api/handovers/:id/accept", async ({ res, session, params }) => {
    sendJson(res, 200, { handover: await decide(await Viewer.load(pool, session.person), params.id, "accepted") });
  });

  route("POST", "/api/handovers/:id/decline", async ({ res, session, params }) => {
    sendJson(res, 200, { handover: await decide(await Viewer.load(pool, session.person), params.id, "declined") });
  });
}
