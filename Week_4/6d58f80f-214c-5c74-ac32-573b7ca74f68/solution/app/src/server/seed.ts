// The seed (brief: Seed data): runs once, when the database holds no folders; all or nothing; one process per
// database (an advisory lock); directory people are upserted by email; every object is stored before its row.
import type pg from "pg";
import { pool } from "./db.js";
import { addDays, now, today } from "./clock.js";
import { newId } from "./ids.js";
import { upsertPerson, type SeedPerson } from "./directory.js";
import { deleteObject, objectKey, putObject } from "./storage.js";
import { blueprintPng, drawingSheetPdf } from "./seedArt.js";
import type { LedgerAction, LedgerDetail, Person, Role } from "../shared/api.js";

const SEED_LOCK = 26_142_631;
/** The shared demo password every seeded person signs in with (brief: Seed data). */
const DEMO_PASSWORD = "Lintel-demo-2026!";

const PEOPLE: SeedPerson[] = [
  { name: "Marisol Okafor", email: "marisol.okafor@lintelworks.test", kind: "staff", firm: "Lintelworks", staffRole: "engineer" },
  { name: "Dev Halvorsen", email: "dev.halvorsen@lintelworks.test", kind: "staff", firm: "Lintelworks", staffRole: "engineer" },
  { name: "Ines Whitcombe", email: "ines.whitcombe@lintelworks.test", kind: "staff", firm: "Lintelworks", staffRole: "controller" },
  { name: "Tomas Achterberg", email: "tomas.achterberg@lintelworks.test", kind: "staff", firm: "Lintelworks", staffRole: "admin" },
  { name: "Aiko Brandt", email: "aiko.brandt@mesquiterow.test", kind: "partner", firm: "Mesquite Row Architects", staffRole: null },
  { name: "Callum Reyes-Tran", email: "callum.reyes-tran@southerncross-review.test", kind: "partner", firm: "Southern Cross Review", staffRole: null },
  { name: "Rosa Tilden", email: "rosa.tilden@pimasteel.test", kind: "partner", firm: "Pima Steel Erectors", staffRole: null },
];

type Who = "marisol" | "dev" | "ines" | "tomas" | "aiko" | "callum" | "rosa";
const WHO: Who[] = ["marisol", "dev", "ines", "tomas", "aiko", "callum", "rosa"];

interface ProjectPlan {
  name: string;
  owner: Who;
  code: string;
  folders: { name: string; files: { name: string; locked?: boolean }[] }[];
}

const PROJECTS: ProjectPlan[] = [
  {
    name: "2614 Saguaro Medical Office", owner: "marisol", code: "S",
    folders: [
      { name: "Calculations", files: [{ name: "Gravity calcs rev B.pdf" }, { name: "Lateral calcs rev A.pdf" }, { name: "Wind load summary.pdf" }] },
      { name: "Drawings", files: [
        { name: "S-101 Foundation Plan.pdf", locked: true }, { name: "S-201 Second Floor Framing.pdf", locked: true },
        { name: "S-202 Roof Framing.pdf" }, { name: "S-501 Typical Details.pdf" }, { name: "S-502 Moment Frame Details.pdf" }] },
      { name: "Site photos", files: [{ name: "Footing pour 2026-10-14.png" }, { name: "Rebar inspection 2026-10-21.png" }] },
      { name: "Issued", files: [{ name: "IFC Set 2026-10-01.pdf" }, { name: "Transmittal 2026-10-01.pdf" }] },
      { name: "Reports", files: [] },
    ],
  },
  {
    name: "2631 Rillito Bridge Retrofit", owner: "dev", code: "B",
    folders: [
      { name: "Calculations", files: [{ name: "Pier capacity check.pdf" }] },
      { name: "Drawings", files: [{ name: "B-101 General Arrangement.pdf" }] },
      { name: "Reports", files: [{ name: "Condition survey 2026-09.pdf" }] },
    ],
  },
];

const BIN_FILE = { project: 0, folder: "Site photos", name: "Old site photo 2026-08-30.png" };

const GRANTS: { who: Who; project: number; folder: string | null; role: Role; days: number }[] = [
  { who: "aiko", project: 0, folder: "Drawings", role: "editor", days: 30 },
  { who: "callum", project: 0, folder: null, role: "viewer", days: 60 },
  { who: "callum", project: 0, folder: "Calculations", role: "editor", days: 14 },
  { who: "rosa", project: 0, folder: "Issued", role: "viewer", days: 7 },
  { who: "rosa", project: 1, folder: "Reports", role: "editor", days: 3 },
];

const SEED_POLICY_FROM = "2026-01-01";
const SEED_POLICY_DAYS = 30;
const HANDOVER_DAYS = 7;

async function hasFolders(db: pg.PoolClient | pg.Pool): Promise<boolean> {
  return (await db.query("SELECT 1 FROM folders LIMIT 1")).rowCount !== 0;
}

interface PlannedFile {
  id: string;
  name: string;
  folderId: string;
  contentType: string;
  bytes: Buffer;
  locked: boolean;
  owner: Who;
  binned: boolean;
}

function contents(name: string, project: string, sheet: string, date: string, drawnBy: string): { contentType: string; bytes: Buffer } {
  if (name.endsWith(".png")) return { contentType: "image/png", bytes: blueprintPng(name) };
  return { contentType: "application/pdf", bytes: drawingSheetPdf({ title: name, project, sheet, date, drawnBy }) };
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").toUpperCase();
}

/** Seeds an empty database; true once the database holds the seed (now or from before). */
export async function seedIfEmpty(): Promise<boolean> {
  if (await hasFolders(pool)) return true;
  const client = await pool.connect();
  const stored: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
    if (await hasFolders(client)) return true;
    const people = new Map<Who, Person>();
    for (const [i, who] of WHO.entries()) {
      const plan = PEOPLE[i];
      if (plan) people.set(who, await upsertPerson(plan, DEMO_PASSWORD));
    }
    const person = (who: Who): Person => {
      const found = people.get(who);
      if (!found) throw new Error(`seed person ${who} missing`);
      return found;
    };
    const day = today();
    const folderIds = new Map<string, string>();
    const files: PlannedFile[] = [];
    for (const [p, project] of PROJECTS.entries()) {
      folderIds.set(`${p}/`, newId());
      for (const folder of project.folders) {
        const folderId = newId();
        folderIds.set(`${p}/${folder.name}`, folderId);
        const listed = [...folder.files, ...(p === BIN_FILE.project && folder.name === BIN_FILE.folder ? [{ name: BIN_FILE.name }] : [])];
        listed.forEach((file, i) => {
          const sheet = `${project.code}-${String(files.length + 1).padStart(3, "0")}`;
          const drawn = initials(person(project.owner).name);
          files.push({
            id: newId(), name: file.name, folderId, ...contents(file.name, project.name, sheet, day, drawn),
            locked: "locked" in file && file.locked === true, owner: project.owner, binned: file.name === BIN_FILE.name && i >= folder.files.length,
          });
        });
      }
    }
    for (const file of files) {
      await putObject(objectKey(file.id), file.bytes, file.contentType);
      stored.push(file.id);
    }
    let tick = now().getTime();
    const ledger = (actor: Person | null, action: LedgerAction, fileId: string | null, folderId: string | null, detail: LedgerDetail) =>
      client.query("INSERT INTO ledger (at, actor_id, actor_name, action, file_id, folder_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [new Date(tick++), actor?.id ?? null, actor?.name ?? null, action, fileId, folderId, JSON.stringify(detail)]);
    await client.query("BEGIN");
    const tomas = person("tomas");
    for (const kind of ["bin_retention_days", "partner_grant_days"] as const) {
      await client.query("INSERT INTO policies (id, kind, days, effective_from, created_at) VALUES ($1, $2, $3, $4, $5)",
        [newId(), kind, SEED_POLICY_DAYS, SEED_POLICY_FROM, now()]);
      await ledger(tomas, "policy_scheduled", null, null, { kind, days: SEED_POLICY_DAYS, effectiveFrom: SEED_POLICY_FROM });
    }
    for (const [p, project] of PROJECTS.entries()) {
      const owner = person(project.owner);
      const projectId = folderIds.get(`${p}/`) ?? "";
      await client.query("INSERT INTO folders (id, name, parent_id, owner_id, owner_name, created_at) VALUES ($1, $2, NULL, $3, $4, $5)",
        [projectId, project.name, owner.id, owner.name, now()]);
      await ledger(owner, "folder_created", null, projectId, { name: project.name });
      for (const folder of project.folders) {
        const id = folderIds.get(`${p}/${folder.name}`) ?? "";
        await client.query("INSERT INTO folders (id, name, parent_id, owner_id, owner_name, created_at) VALUES ($1, $2, $3, NULL, NULL, $4)",
          [id, folder.name, projectId, now()]);
        await ledger(owner, "folder_created", null, id, { name: folder.name, folder: { id: projectId, name: project.name } });
      }
    }
    const nameOf = (folderId: string) => [...folderIds.entries()].find(([, id]) => id === folderId)?.[0].split("/")[1] ?? "";
    for (const file of files) {
      await client.query(
        `INSERT INTO files (id, name, folder_id, size, content_type, modified_at, locked, binned_date, retention_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [file.id, file.name, file.folderId, file.bytes.length, file.contentType, new Date(tick), file.locked,
          file.binned ? day : null, file.binned ? SEED_POLICY_DAYS : null]);
      const owner = person(file.owner);
      await ledger(owner, "uploaded", file.id, file.folderId, { name: file.name, folder: { id: file.folderId, name: nameOf(file.folderId) } });
      if (file.locked) await ledger(person("ines"), "locked", file.id, file.folderId, { name: file.name });
      if (file.binned) await ledger(owner, "binned", file.id, file.folderId, { name: file.name, folder: { id: file.folderId, name: nameOf(file.folderId) }, retentionDays: SEED_POLICY_DAYS });
    }
    for (const grant of GRANTS) {
      const project = PROJECTS[grant.project];
      if (!project) continue;
      const itemId = folderIds.get(`${grant.project}/${grant.folder ?? ""}`) ?? "";
      const partner = person(grant.who);
      const endDate = addDays(day, grant.days);
      await client.query(
        `INSERT INTO grants (id, item_type, item_id, person_id, person_name, person_firm, role, end_date, status, ended_reason, created_at)
         VALUES ($1, 'folder', $2, $3, $4, $5, $6, $7, 'active', NULL, $8)`,
        [newId(), itemId, partner.id, partner.name, partner.firm, grant.role, endDate, now()]);
      await ledger(person(project.owner), "shared", null, itemId, {
        person: { id: partner.id, name: partner.name }, role: grant.role, endDate, item: { type: "folder", name: grant.folder ?? project.name },
      });
    }
    const dev = person("dev"), marisol = person("marisol");
    const rillito = folderIds.get("1/") ?? "";
    const lapseDate = addDays(day, HANDOVER_DAYS);
    await client.query(
      `INSERT INTO handovers (id, folder_id, from_id, from_name, to_id, to_name, offered_date, lapse_date, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'offered', $9)`,
      [newId(), rillito, dev.id, dev.name, marisol.id, marisol.name, day, lapseDate, now()]);
    await ledger(dev, "handover_offered", null, rillito, { from: { id: dev.id, name: dev.name }, to: { id: marisol.id, name: marisol.name }, lapseDate });
    await client.query("COMMIT");
    stored.length = 0;
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    for (const id of stored) await deleteObject(objectKey(id)).catch(() => undefined);
    console.error("seed not applied yet:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
