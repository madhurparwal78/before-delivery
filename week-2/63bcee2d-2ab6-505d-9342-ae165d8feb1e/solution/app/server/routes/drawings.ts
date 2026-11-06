import { createHash } from "node:crypto";
import { memberById, memberRef, requireRole, type Member } from "../auth.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { revisionLetter } from "../domain/revisions.js";
import { conflict, notFound, validation } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { knownId, visibleProject, type Project } from "../scope.js";
import { csvFile } from "../services/csv.js";
import { acceptFile, fileHeaders } from "../services/files.js";
import { deleteObject, getObject, putObject } from "../services/storage.js";
import { zip } from "../services/zip.js";

// The drawing register: sheets, their revisions and transmittal sets (brief: Drawing register).

const SHEET_CODE = /^[A-Z0-9.-]{1,20}$/;
const PURPOSES = ["for_construction", "for_tender", "for_information"] as const;
const SUPERSEDED_COPY = "Only current revisions can be issued.";

interface RevisionRow {
  sheet_id: string;
  ordinal: number;
  revision: string;
  state: string;
  bytes: number;
  sha256: string;
  content_type: string;
  extension: string;
  original_name: string;
  note: string;
  uploaded_by: string;
  uploaded_at: Date;
}

interface SheetRow {
  id: string;
  project_id: string;
  code: string;
  title: string;
}

const sheetKey = (projectId: string, code: string, revision: string, extension: string): string =>
  `projects/${projectId}/sheets/${code}/${revision}.${extension}`;

/** Members by id, for the `uploadedBy` and `issuedBy` references. */
async function references(db: Db, ids: string[]): Promise<Map<string, ReturnType<typeof memberRef>>> {
  const found = new Map<string, ReturnType<typeof memberRef>>();
  for (const id of new Set(ids)) {
    const member = await memberById(db, id);
    if (member) found.set(id, memberRef(member));
  }
  return found;
}

function revisionJson(row: RevisionRow, people: Map<string, ReturnType<typeof memberRef>>) {
  return {
    revision: row.revision, state: row.state, bytes: Number(row.bytes), sha256: row.sha256, contentType: row.content_type,
    originalName: row.original_name, note: row.note, uploadedBy: people.get(row.uploaded_by) ?? null,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

async function sheetJson(db: Db, sheet: SheetRow) {
  const revisions = await rows<RevisionRow>(db, "SELECT * FROM sheet_revisions WHERE sheet_id = $1 ORDER BY ordinal", [sheet.id]);
  const people = await references(db, revisions.map((r) => r.uploaded_by));
  return {
    id: sheet.id, code: sheet.code, title: sheet.title,
    currentRevision: revisions.find((r) => r.state === "current")?.revision ?? null,
    revisions: revisions.map((r) => revisionJson(r, people)),
  };
}

/** A sheet the member may see through its project, else 404. */
async function visibleSheet(db: Db, member: Member, id: string): Promise<{ sheet: SheetRow; project: Project }> {
  const sheet = await one<SheetRow>(db, "SELECT id, project_id, code, title FROM sheets WHERE id = $1", [knownId(id)]);
  if (!sheet) throw notFound();
  return { sheet, project: await visibleProject(db, member, sheet.project_id) };
}

interface TransmittalRow {
  id: string;
  project_id: string;
  number: string;
  purpose: string;
  issued_at: Date;
  issued_by: string;
  sheets: { code: string; revision: string; bytes: number; sha256: string }[];
  zip_bytes: number;
  zip_sha256: string;
}

function transmittalJson(row: TransmittalRow, people: Map<string, ReturnType<typeof memberRef>>) {
  return {
    id: row.id, number: row.number, purpose: row.purpose, issuedAt: new Date(row.issued_at).toISOString(),
    issuedBy: people.get(row.issued_by) ?? null, sheets: row.sheets, zipBytes: Number(row.zip_bytes), zipSha256: row.zip_sha256,
  };
}

const zipKey = (projectId: string, number: string): string => `projects/${projectId}/transmittals/${number}.zip`;

/** Writes the object, then the records; a failed record write removes the object so nothing partial is left. */
async function storeThenRecord<T>(key: string, data: Buffer, contentType: string, write: () => Promise<T>): Promise<T> {
  await putObject(key, data, contentType);
  try {
    return await write();
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/sheets", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      const sheets = await rows<SheetRow>(pool, "SELECT id, project_id, code, title FROM sheets WHERE project_id = $1 ORDER BY code", [project.id]);
      const list = [];
      for (const sheet of sheets) list.push(await sheetJson(pool, sheet));
      return ok({ sheets: list });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/sheet-revisions", auth: "member", body: "multipart",
    handler: async (ctx) => {
      const member = ctx.me;
      const project = await visibleProject(pool, member, ctx.params.id);
      requireRole(member, "director", "project_lead", "designer");
      const form = ctx.multipart();
      const fields = new Fields(form.fields);
      const code = form.fields.sheetCode ?? "";
      if (!code) fields.fail("sheetCode", "Sheet code is required.");
      else if (!SHEET_CODE.test(code)) fields.fail("sheetCode", "Sheet code can be at most 20 capital letters, digits, hyphens and dots.");
      const existing = code ? await one<SheetRow>(pool, "SELECT id, project_id, code, title FROM sheets WHERE project_id = $1 AND code = $2", [project.id, code]) : undefined;
      const title = existing ? existing.title : fields.text("title", "Title", { max: 120, oneLine: true });
      const note = fields.text("note", "Note", { min: 0, max: 1000 });
      const accepted = acceptFile(fields, form.files.file?.[0], "Sheet file");
      // A refused file has its reason among the field errors already.
      if (!accepted) throw validation(fields.errors);
      fields.done();
      const saved = await tx(async (client) => {
        await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [project.id]);
        const sheet = await one<SheetRow>(client, "SELECT id, project_id, code, title FROM sheets WHERE project_id = $1 AND code = $2", [project.id, code]);
        const ordinal = sheet
          ? (await rows<{ next: number }>(client, "SELECT max(ordinal) + 1 AS next FROM sheet_revisions WHERE sheet_id = $1", [sheet.id]))[0].next
          : 0;
        const revision = revisionLetter(ordinal);
        return storeThenRecord(sheetKey(project.id, code, revision, accepted.kind), accepted.data, accepted.contentType, async () => {
          const target = sheet ?? (await rows<SheetRow>(client,
            "INSERT INTO sheets (project_id, code, title) VALUES ($1, $2, $3) RETURNING id, project_id, code, title", [project.id, code, title]))[0];
          await client.query("UPDATE sheet_revisions SET state = 'superseded' WHERE sheet_id = $1 AND state = 'current'", [target.id]);
          await client.query(
            `INSERT INTO sheet_revisions (sheet_id, ordinal, revision, state, bytes, sha256, content_type, extension, original_name, note, uploaded_by)
             VALUES ($1, $2, $3, 'current', $4, $5, $6, $7, $8, $9, $10)`,
            [target.id, ordinal, revision, accepted.bytes, accepted.sha256, accepted.contentType, accepted.kind, accepted.name, note, member.id]);
          const json = await sheetJson(client, target);
          return { sheet: json, revision: json.revisions.find((r) => r.revision === revision) };
        });
      });
      return ok(saved, 201);
    },
  },
  {
    method: "PATCH", path: "/api/sheets/:id/revisions/:revision", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const { sheet } = await visibleSheet(pool, member, ctx.params.id);
      requireRole(member, "director", "project_lead", "designer");
      return tx(async (client) => {
        const row = await one<RevisionRow>(client, "SELECT * FROM sheet_revisions WHERE sheet_id = $1 AND revision = $2 FOR UPDATE",
          [sheet.id, ctx.params.revision]);
        if (!row) throw notFound();
        if (row.state === "superseded") throw conflict("superseded_read_only");
        const fields = new Fields(record(ctx.json()));
        const note = fields.text("note", "Note", { min: 0, max: 1000 });
        fields.done();
        const [updated] = await rows<RevisionRow>(client, "UPDATE sheet_revisions SET note = $3 WHERE sheet_id = $1 AND revision = $2 RETURNING *",
          [sheet.id, row.revision, note]);
        return ok({ revision: revisionJson(updated, await references(client, [updated.uploaded_by])) });
      });
    },
  },
  {
    method: "GET", path: "/api/sheets/:id/revisions/:revision/file", auth: "member",
    handler: async (ctx) => {
      const { sheet } = await visibleSheet(pool, ctx.me, ctx.params.id);
      const row = await one<RevisionRow>(pool, "SELECT * FROM sheet_revisions WHERE sheet_id = $1 AND revision = $2", [sheet.id, ctx.params.revision]);
      if (!row) throw notFound();
      const data = await getObject(sheetKey(sheet.project_id, sheet.code, row.revision, row.extension));
      return { status: 200, body: data, headers: { ...fileHeaders(row.content_type), "Content-Disposition": `inline; filename="${sheet.code}_${row.revision}.${row.extension}"` } };
    },
  },
  {
    method: "POST", path: "/api/projects/:id/transmittals", auth: "member", idempotent: true,
    handler: async (ctx) => {
      const member = ctx.me;
      const project = await visibleProject(pool, member, ctx.params.id);
      requireRole(member, "director", "project_lead", "designer");
      const body = record(ctx.json());
      const fields = new Fields(body);
      ctx.requireIdempotencyKey(fields);
      const purpose = fields.oneOf("purpose", "Purpose", PURPOSES);
      const current = await rows<RevisionRow & { code: string; project_id: string }>(pool,
        `SELECT r.*, s.code, s.project_id FROM sheet_revisions r JOIN sheets s ON s.id = r.sheet_id
         WHERE s.project_id = $1 AND r.state = 'current' ORDER BY s.code`, [project.id]);
      let chosen = current;
      if (body.sheetRevisions !== undefined) {
        const asked = Array.isArray(body.sheetRevisions) ? body.sheetRevisions.map(record) : [];
        chosen = [];
        for (const item of asked) {
          const match = current.find((r) => r.sheet_id === item.sheetId && r.revision === item.revision);
          if (!match) {
            fields.fail("sheetRevisions", SUPERSEDED_COPY);
            break;
          }
          if (!chosen.includes(match)) chosen.push(match);
        }
      }
      if (!chosen.length && !fields.has("sheetRevisions")) fields.fail("sheetRevisions", "Choose at least one current revision.");
      fields.done();
      const transmittal = await tx(async (client) => {
        await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [project.id]);
        const last = await one<{ n: number | null }>(client, "SELECT max(sequence) AS n FROM transmittals WHERE project_id = $1", [project.id]);
        const sequence = Number(last?.n ?? 0) + 1;
        const number = `T-${String(sequence).padStart(3, "0")}`;
        const entries: { name: string; data: Buffer }[] = [];
        const manifest: string[][] = [];
        const listed: TransmittalRow["sheets"] = [];
        for (const revision of chosen) {
          const data = await getObject(sheetKey(project.id, revision.code, revision.revision, revision.extension));
          const name = `${revision.code}_${revision.revision}.${revision.extension}`;
          const sha256 = createHash("sha256").update(data).digest("hex");
          entries.push({ name, data });
          manifest.push([revision.code, revision.revision, name, String(data.length), sha256]);
          listed.push({ code: revision.code, revision: revision.revision, bytes: data.length, sha256 });
        }
        entries.push({ name: "manifest.csv", data: Buffer.from(csvFile(["sheet", "revision", "file", "bytes", "sha256"], manifest), "utf8") });
        const archive = zip(entries);
        return storeThenRecord(zipKey(project.id, number), archive, "application/zip", async () => {
          const [row] = await rows<TransmittalRow>(client,
            `INSERT INTO transmittals (project_id, sequence, number, purpose, issued_by, sheets, zip_bytes, zip_sha256)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [project.id, sequence, number, purpose, member.id, JSON.stringify(listed), archive.length,
              createHash("sha256").update(archive).digest("hex")]);
          return transmittalJson(row, await references(client, [member.id]));
        });
      });
      return ok({ transmittal }, 201);
    },
  },
  {
    method: "GET", path: "/api/projects/:id/transmittals", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      const list = await rows<TransmittalRow>(pool, "SELECT * FROM transmittals WHERE project_id = $1 ORDER BY sequence", [project.id]);
      const people = await references(pool, list.map((t) => t.issued_by));
      return ok({ transmittals: list.map((t) => transmittalJson(t, people)) });
    },
  },
  {
    method: "GET", path: "/api/transmittals/:id/zip", auth: "member",
    handler: async (ctx) => {
      const row = await one<TransmittalRow>(pool, "SELECT * FROM transmittals WHERE id = $1", [knownId(ctx.params.id)]);
      if (!row) throw notFound();
      await visibleProject(pool, ctx.me, row.project_id);
      const data = await getObject(zipKey(row.project_id, row.number));
      return { status: 200, body: data, headers: { "Content-Type": "application/zip", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${row.number}.zip"` } };
    },
  },
];
