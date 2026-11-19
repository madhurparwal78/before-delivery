import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { WORKBOOK_COLUMNS, parseDelimited } from "../csv.js";
import { luhnValid } from "../stamps.js";
import { readMultipart } from "./pins-photos.js";
import { assertOrigin, WORKBOOK_LIMIT } from "../request.js";
import { s3 } from "../providers/s3.js";
import { sha256 } from "../config.js";

export const workbookRouter = Router({ mergeParams: true });

type PreviewRow = { row: number; status: "new" | "matched" | "refused"; reason: string | null; client: string; piece: string; stamp: string };

workbookRouter.post("/preview", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const parts = await readMultipart(req);
  const file = parts.get("file");
  if (!file) throw err.field({ file: apiMessages.fieldRequired });
  const bytes = file.value as Buffer;
  if (bytes.length > WORKBOOK_LIMIT) throw err.tooLarge(apiMessages.workbookTooBig);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw err.field({ file: apiMessages.workbookEncoding });
  }
  const parsed = parseDelimited(text);
  const header = parsed.header.map((h) => h.trim());
  for (const col of header) {
    if (!(WORKBOOK_COLUMNS as readonly string[]).includes(col)) {
      throw err.field({ file: apiMessages.workbookExtraColumn.replace("<name>", col) });
    }
  }
  for (const col of WORKBOOK_COLUMNS) {
    if (!header.includes(col)) {
      throw err.field({ file: apiMessages.workbookMissingColumn.replace("<name>", col) });
    }
  }
  const rows: PreviewRow[] = [];
  const counts = { new: 0, matched: 0, refused: 0 };
  const rawRows = parsed.raw as string[][];
  for (let i = 0; i < rawRows.length; i++) {
    const record = i + 2; // header is row 1
    const cells = rawRows[i]!;
    let status: PreviewRow["status"] = "new";
    let reason: string | null = null;
    if (cells.length !== 7) {
      status = "refused";
      reason = apiMessages.workbookFields.replace("<n>", String(record));
    } else {
      const [client, piece, , , stamp, material] = cells;
      if (stamp === "" || !/^\d{8}$/.test(stamp) || !luhnValid(stamp)) {
        status = "refused";
        reason = apiMessages.workbookStamp.replace("<n>", String(record));
      } else if ((piece ?? "").trim() === "") {
        status = "refused";
        reason = apiMessages.workbookTitle.replace("<n>", String(record));
      } else if (material && material.trim() !== "") {
        const known = await q1<{ code: string }>("SELECT code FROM materials WHERE desk_id=$1 AND code=$2", [session.deskId, material.trim()]);
        if (!known) {
          status = "refused";
          reason = apiMessages.workbookMaterial.replace("<n>", String(record)).replace("<code>", material.trim());
        }
      }
      if (status !== "refused") {
        const existing = await q1<{ id: string }>("SELECT id FROM pieces WHERE desk_id=$1 AND stamp_number=$2", [session.deskId, stamp]);
        status = existing ? "matched" : "new";
      }
    }
    counts[status] += 1;
    rows.push({ row: record, status, reason, client: cells[0] ?? "", piece: cells[1] ?? "", stamp: cells[4] ?? "" });
  }
  res.json({ rows, counts });
}));

workbookRouter.post("/save", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const parts = await readMultipart(req);
  const file = parts.get("file");
  if (!file) throw err.field({ file: apiMessages.fieldRequired });
  const bytes = file.value as Buffer;
  if (bytes.length > WORKBOOK_LIMIT) throw err.tooLarge(apiMessages.workbookTooBig);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw err.field({ file: apiMessages.workbookEncoding });
  }
  const parsed = parseDelimited(text);
  const header = parsed.header.map((h) => h.trim());
  for (const col of header) {
    if (!(WORKBOOK_COLUMNS as readonly string[]).includes(col)) {
      throw err.field({ file: apiMessages.workbookExtraColumn.replace("<name>", col) });
    }
  }
  for (const col of WORKBOOK_COLUMNS) {
    if (!header.includes(col)) {
      throw err.field({ file: apiMessages.workbookMissingColumn.replace("<name>", col) });
    }
  }
  const rawRows = parsed.raw as string[][];
  const { newToken } = await import("../config.js");
  let created = 0;
  let matched = 0;
  let refused = 0;
  const stampSeen = new Set<string>();
  for (let i = 0; i < rawRows.length; i++) {
    const record = i + 2;
    const cells = rawRows[i]!;
    if (cells.length !== 7) { refused += 1; continue; }
    const [client, piece, maker, year, stamp, material, notes] = cells;
    if (stamp === "" || !/^\d{8}$/.test(stamp) || !luhnValid(stamp)) { refused += 1; continue; }
    if ((piece ?? "").trim() === "") { refused += 1; continue; }
    if (material && material.trim() !== "") {
      const known = await q1<{ code: string }>("SELECT code FROM materials WHERE desk_id=$1 AND code=$2", [session.deskId, material.trim()]);
      if (!known) { refused += 1; continue; }
    }
    if (stampSeen.has(stamp)) { matched += 1; continue; }
    const existing = await q1<{ id: string }>("SELECT id FROM pieces WHERE desk_id=$1 AND stamp_number=$2", [session.deskId, stamp]);
    if (existing) { matched += 1; stampSeen.add(stamp); continue; }
    let clientId: string | null = null;
    const clientName = (client ?? "").trim();
    if (clientName !== "") {
      const clientRow = await q1<{ id: string }>("SELECT id FROM clients WHERE desk_id=$1 AND name=$2", [session.deskId, clientName]);
      if (clientRow) clientId = clientRow.id;
      else {
        const id = newToken(8);
        await q("INSERT INTO clients (id, desk_id, name, town, language, email) VALUES ($1,$2,$3,'Turin','it','')", [id, session.deskId, clientName]);
        const { syncEntries } = await import("../sync.js");
        await syncEntries(session.deskId, [{ kind: "client", refId: id, label: clientName, href: `/clients/${id}` }]);
        clientId = id;
      }
    }
    const id = newToken(8);
    await q(
      `INSERT INTO pieces (id, desk_id, client_id, title, maker, year, stamp_number, notes, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received') ON CONFLICT DO NOTHING`,
      [id, session.deskId, clientId, (piece ?? "").trim(), maker ?? "", year ?? "", stamp, notes ?? ""]
    );
    await q("INSERT INTO layouts (piece_id, desk_id, version, placements, used_sqft, used_percent) VALUES ($1,$2,1,$3,0,0) ON CONFLICT (piece_id) DO NOTHING", [
      id, session.deskId, JSON.stringify([]),
    ]);
    const { syncEntries } = await import("../sync.js");
    await syncEntries(session.deskId, [{ kind: "piece", refId: id, label: (piece ?? "").trim(), href: `/pieces/${id}` }]);
    stampSeen.add(stamp);
    created += 1;
  }
  const digest = sha256(bytes);
  const key = `workbooks/${session.deskId}/${digest}.csv`;
  const stored = await s3.put(key, bytes, "text/csv");
  if (!stored) throw err.unavailable(apiMessages.storageDown);
  await q(
    "INSERT INTO workbooks (desk_id, sha256, bytes, rows) VALUES ($1,$2,$3,$4) ON CONFLICT (desk_id) DO UPDATE SET sha256=$2, bytes=$3, rows=$4",
    [session.deskId, digest, bytes.length, rawRows.length]
  );
  const saved = await q1<{ sha256: string }>("SELECT sha256 FROM workbooks WHERE desk_id=$1", [session.deskId]);
  res.json({ created, matched, refused, sha256: saved?.sha256 ?? digest });
}));
