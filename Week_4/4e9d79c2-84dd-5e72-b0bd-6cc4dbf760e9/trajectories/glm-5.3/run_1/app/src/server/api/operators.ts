import type { Express, Request, Response } from "express";
import { Buffer } from "node:buffer";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { fetchDirectory } from "../services.js";
import { s3Put, s3Get, objectKeyForPaper } from "../s3.js";
import { addDays } from "../uktime.js";
import { isoDate, tx } from "../repo.js";

export interface OperatorClear {
  clear: boolean;
  reason: string | null;
}

const PAPER_LABEL: Record<string, string> = {
  operatorLicence: "Operator licence",
  publicLiabilityCover: "Public liability cover",
};

export function paperLabel(kind: string): string {
  return PAPER_LABEL[kind] ?? kind;
}

/** Clear for the hire's last day, per DP-18, with the published reason order. */
export async function operatorClearForLastDay(
  db: Ctx["db"],
  deskId: string,
  operatorId: string,
  occasion: string,
  lastDay: string
): Promise<OperatorClear> {
  const op = await db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, operatorId]);
  if (!op.rows[0]) return { clear: false, reason: "We can't find that." };
  if (!op.rows[0].listed) return { clear: false, reason: "No longer listed" };
  const papers = await db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, operatorId]);
  const licence = papers.rows.find((p) => p.kind === "operatorLicence");
  const cover = papers.rows.find((p) => p.kind === "publicLiabilityCover");
  if (!licence) return { clear: false, reason: "Operator licence is missing." };
  if (String(licence.ends_on).slice(0, 10) < lastDay) {
    return { clear: false, reason: `Operator licence ends ${longDate(String(licence.ends_on).slice(0, 10))}, before this hire's last day.` };
  }
  if (!cover) return { clear: false, reason: "Public liability cover is missing." };
  if (String(cover.ends_on).slice(0, 10) < lastDay) {
    return { clear: false, reason: `Public liability cover ends ${longDate(String(cover.ends_on).slice(0, 10))}, before this hire's last day.` };
  }
  if (occasion === "school") {
    const dbs = op.rows[0].dbs_checked_on ? String(op.rows[0].dbs_checked_on).slice(0, 10) : null;
    if (!dbs) return { clear: false, reason: "Driver DBS check is missing." };
    const cutoff = addDays(lastDay, -365 * 3 - (needsLeapAdjust(lastDay) ? 1 : 0));
    if (dbs <= cutoff) return { clear: false, reason: "Driver DBS check is older than three years on this hire's last day." };
  }
  return { clear: true, reason: null };
}

function needsLeapAdjust(_lastDay: string): boolean {
  return false;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function registerOperatorApi(app: Express, ctx: Ctx): void {
  app.get("/api/operators", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 ORDER BY id", [deskId]);
    res.json({ operators: await Promise.all(r.rows.map((x) => operatorOut(ctx, x))) });
  });

  app.post("/api/operators/refresh", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const dir = await fetchDirectory(ctx.cfg);
    if (!dir) {
      throw errors.state("directory", "The directory could not be read. Your list has not changed.");
    }
    await tx(ctx.db, async (client) => {
      const current = await client.query("SELECT id FROM operators WHERE desk_id=$1", [deskId]);
      const ids = new Set(current.rows.map((x) => String(x.id)));
      for (const op of dir) {
        if (ids.has(op.id)) {
          await client.query(
            "UPDATE operators SET name=$2, town=$3, email=$4, telephone=$5, sizes=$6, listed=TRUE WHERE desk_id=$1 AND id=$7",
            [deskId, op.name, op.town, op.email, op.telephone, op.sizes, op.id]
          );
          ids.delete(op.id);
        } else {
          await client.query(
            "INSERT INTO operators (desk_id, id, name, town, email, telephone, sizes, listed) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)",
            [deskId, op.id, op.name, op.town, op.email, op.telephone, op.sizes]
          );
        }
      }
      for (const missing of ids) {
        await client.query("UPDATE operators SET listed=FALSE WHERE desk_id=$1 AND id=$2", [deskId, missing]);
      }
    });
    const r = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 ORDER BY id", [deskId]);
    res.json({ operators: await Promise.all(r.rows.map((x) => operatorOut(ctx, x))) });
  });

  app.post("/api/operators/:id/papers", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const opId = req.params.id;
    const op = await ctx.db.query("SELECT id FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
    if (!op.rows[0]) throw errors.notFound();
    const { fields, fileBuffer } = await readMultipart(req);
    const kind = fields.get("kind") ?? "";
    if (kind !== "operatorLicence" && kind !== "publicLiabilityCover") {
      throw errors.invalid({ kind: "This file is not a PDF, JPEG or PNG." });
    }
    const endsOn = fields.get("endsOn") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw errors.invalid({ endsOn: "Enter a date as DD/MM/YYYY." });
    if (!fileBuffer || fileBuffer.length === 0) throw errors.invalid({ file: "This file is not a PDF, JPEG or PNG." });
    const type = sniffType(fileBuffer);
    if (!type) throw errors.invalid({ file: "This file is not a PDF, JPEG or PNG." });
    const existing = await ctx.db.query("SELECT paper_id FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, opId, kind]);
    const paperId = (existing.rows[0]?.paper_id as string | undefined) ?? "PP-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const key = objectKeyForPaper(deskId, opId, kind, paperId);
    await s3Put(ctx.cfg, key, fileBuffer, type);
    await ctx.db.query(
      `INSERT INTO papers (desk_id, operator_id, kind, ends_on, stored, object_key, stored_type, paper_id) VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7)
       ON CONFLICT (desk_id, operator_id, kind) DO UPDATE SET ends_on=$4, stored=TRUE, object_key=$5, stored_type=$6`,
      [deskId, opId, kind, endsOn, key, type, paperId]
    );
    const after = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, opId, kind]);
    res.status(201).json(paperOut(after.rows[0]));
  });

  app.get("/api/operators/:id/papers/:kind/file", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const kind = req.params.kind;
    if (kind !== "operatorLicence" && kind !== "publicLiabilityCover") throw errors.notFound();
    const r = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2 AND kind=$3", [deskId, req.params.id, kind]);
    if (!r.rows[0] || !r.rows[0].object_key) throw errors.notFound();
    const bytes = await s3Get(ctx.cfg, String(r.rows[0].object_key));
    if (!bytes) throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    res.setHeader("Content-Type", String(r.rows[0].stored_type ?? "application/octet-stream"));
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  });

  app.put("/api/operators/:id/dbs", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const checkedOn = typeof body.checkedOn === "string" ? body.checkedOn : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) throw errors.invalid({ checkedOn: "Enter a date as DD/MM/YYYY." });
    const r = await ctx.db.query("UPDATE operators SET dbs_checked_on=$3 WHERE desk_id=$1 AND id=$2 RETURNING *", [deskId, req.params.id, checkedOn]);
    if (!r.rows[0]) throw errors.notFound();
    res.json(await operatorOut(ctx, r.rows[0]));
  });

  app.get("/api/hires/:id/operators", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const occasion = String(hire.rows[0].occasion);
    const lastDay = await lastDayOfHire(ctx, deskId, hire.rows[0]);
    const asked = await ctx.db.query("SELECT operator_id FROM bids WHERE desk_id=$1 AND enquiry_id=$2", [deskId, hire.rows[0].reference]);
    const rows: { id: string; name: string; clear: boolean; reason: string | null }[] = [];
    for (const opId of asked.rows.map((x) => String(x.operator_id))) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
      if (!op.rows[0]) continue;
      const c = await operatorClearForLastDay(ctx.db, deskId, opId, occasion, lastDay);
      rows.push({ id: opId, name: String(op.rows[0].name), clear: c.clear, reason: c.reason });
    }
    res.json({ operators: rows });
  });
}

export async function lastDayOfHire(_ctx: Ctx, _deskId: string, hire: Record<string, unknown>): Promise<string> {
  const ret = hire.return_instant as Date | null;
  const dep = hire.depart_instant as Date;
  const instant = ret ?? dep;
  return isoDate(new Date(instant));
}

async function operatorOut(ctx: Ctx, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const papers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [row.desk_id, row.id]);
  return {
    id: String(row.id),
    name: String(row.name),
    town: row.town ? String(row.town) : null,
    email: row.email ? String(row.email) : null,
    telephone: row.telephone ? String(row.telephone) : null,
    sizes: (row.sizes as number[]) ?? [],
    listed: Boolean(row.listed),
    papers: papers.rows.map(paperOut),
    dbsCheckedOn: row.dbs_checked_on ? isoDate(row.dbs_checked_on) : null,
  };
}

function paperOut(p: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: String(p.kind),
    endsOn: isoDate(p.ends_on),
    stored: Boolean(p.stored),
    objectKey: p.object_key ? String(p.object_key) : null,
  };
}

/** Papers are judged by first bytes, never name or stated type. */
export function sniffType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  return null;
}

/** A tiny multipart reader for one file part, sized before it is read. */
export async function readMultipart(req: Request): Promise<{ fields: Map<string, string>; fileBuffer: Buffer | null; fileName: string | null }> {
  const type = (req.headers["content-type"] ?? "");
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
  if (!m) throw errors.unsupportedType();
  const boundary = "--" + (m[1] ?? m[2]);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > 5_100_000) throw errors.tooLarge();
    chunks.push(b);
  }
  const body = Buffer.concat(chunks);
  const fields = new Map<string, string>();
  let fileBuffer: Buffer | null = null;
  let fileName: string | null = null;
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const next = body.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    const part = body.slice(idx + boundary.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      idx = next;
      continue;
    }
    const head = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const nameM = /name="([^"]*)"/.exec(head);
    const fileM = /filename="([^"]*)"/.exec(head);
    if (fileM) {
      fileName = fileM[1];
      fileBuffer = Buffer.from(content);
      if (fileBuffer.length > 5_000_000) throw errors.tooLarge();
    } else if (nameM) {
      fields.set(nameM[1], content.toString("utf8"));
    }
    idx = next;
  }
  return { fields, fileBuffer, fileName };
}
