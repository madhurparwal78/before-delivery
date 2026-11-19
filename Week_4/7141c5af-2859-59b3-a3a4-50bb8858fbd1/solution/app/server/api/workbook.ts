import { createHash, randomUUID } from "node:crypto";
import { query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { csvFile } from "../domain/csv.ts";
import { judgeRows, parseWorkbook, type WorkbookRow } from "../domain/workbook.ts";
import { invalid, unavailable } from "../http/errors.ts";
import { bytes, type Ctx, json, route } from "../http/router.ts";
import { ProviderDown } from "../providers/call.ts";
import { entryOfClient, entryOfPiece, type SearchEntry, syncEntries } from "../providers/meili.ts";
import { putObject } from "../providers/s3.ts";
import type { Queryable } from "../db/pool.ts";
import { insertPiece } from "./pieces.ts";

const WORKBOOK_FILE = { bytes: 2_000_000, message: copy("F-82") };
const LIST_HEADER = ["piece", "client", "material", "code", "lot", "hides", "notes"];

function fileOf(ctx: Ctx): { bytes: Buffer; parsed: Exclude<ReturnType<typeof parseWorkbook>, { refused: string }> } {
  const file = ctx.form?.file;
  if (!file) throw invalid("file", copy("F-04"));
  const parsed = parseWorkbook(file.bytes);
  if ("refused" in parsed) throw invalid("file", parsed.refused);
  return { bytes: file.bytes, parsed };
}

async function judged(deskId: string, parsed: Parameters<typeof judgeRows>[0], on?: Queryable): Promise<WorkbookRow[]> {
  const stamps = await query<{ stamp_number: string }>("SELECT stamp_number FROM pieces WHERE desk_id = $1 AND stamp_number IS NOT NULL", [deskId], on);
  const codes = await query<{ code: string }>("SELECT code FROM materials WHERE desk_id = $1", [deskId], on);
  return judgeRows(parsed, new Set(stamps.map((row) => row.stamp_number)), new Set(codes.map((row) => row.code)));
}

function counts(rows: readonly WorkbookRow[]): { new: number; matched: number; refused: number } {
  const count = (status: WorkbookRow["status"]): number => rows.filter((row) => row.status === status).length;
  return { new: count("new"), matched: count("matched"), refused: count("refused") };
}

export function register(): void {
  route({
    method: "POST",
    pattern: "/api/workbook/preview",
    body: "multipart",
    file: WORKBOOK_FILE,
    handle: async (ctx) => {
      const rows = await judged(ctx.deskId, fileOf(ctx).parsed);
      return json(200, {
        rows: rows.map(({ row, status, reason, fields }) => ({ row, status, reason, client: fields.client, piece: fields.piece, stamp: fields.stamp })),
        counts: counts(rows),
      });
    },
  });

  route({
    method: "POST",
    pattern: "/api/workbook/save",
    body: "multipart",
    file: WORKBOOK_FILE,
    handle: async (ctx) => {
      const { bytes: file, parsed } = fileOf(ctx);
      const sha256 = createHash("sha256").update(file).digest("hex");
      try {
        await putObject(`workbooks/${ctx.deskId}/${sha256}.csv`, file, "text/csv");
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreUnavailable", copy("F-27"));
        throw error;
      }
      const entries: SearchEntry[] = [];
      const rows = await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`workbook:${ctx.deskId}`]);
        const decided = await judged(ctx.deskId, parsed, client);
        for (const { status, fields } of decided) {
          if (status === "new") entries.push(...(await savePiece(ctx.deskId, fields, client)));
        }
        return decided;
      });
      syncEntries(entries);
      const total = counts(rows);
      return json(200, { created: total.new, matched: total.matched, refused: total.refused, sha256 });
    },
  });

  route({
    method: "GET",
    pattern: "/api/materials-list.csv",
    handle: async (ctx) => {
      const rows = await query<{ title: string; client: string; material: string | null; code: string | null; lot: string | null; hides: number | null; notes: string | null }>(
        `SELECT p.title, c.name AS client, COALESCE(e.material_name, m.name) AS material, e.material_code AS code, e.lot, e.hides, p.notes
         FROM pieces p JOIN clients c ON c.id = p.client_id
         LEFT JOIN LATERAL (SELECT * FROM estimates WHERE piece_id = p.id AND state IN ('open', 'signedOff') ORDER BY version DESC LIMIT 1) e ON true
         LEFT JOIN materials m ON m.desk_id = p.desk_id AND m.code = e.material_code
         WHERE p.desk_id = $1 AND p.state <> 'archived' AND c.state NOT IN ('erasing', 'erased')
         ORDER BY p.title, p.id`,
        [ctx.deskId],
      );
      const lines = rows.map((row) => [row.title, row.client, row.material ?? "", row.code ?? "", row.lot ?? "", row.hides?.toString() ?? "", row.notes ?? ""]);
      return bytes(200, "text/csv; charset=utf-8", csvFile([LIST_HEADER, ...lines]), { "Content-Disposition": 'attachment; filename="materials-list.csv"' });
    },
  });
}

/** A new row: its client matched by exact name or made new, and every text stored exactly as written. */
async function savePiece(deskId: string, fields: WorkbookRow["fields"], on: Queryable): Promise<SearchEntry[]> {
  const [held] = await query<{ id: string }>(
    `SELECT id FROM clients WHERE desk_id = $1 AND name = $2 AND state NOT IN ('erasing', 'erased') ORDER BY created_at LIMIT 1`,
    [deskId, fields.client],
    on,
  );
  const clientId = held?.id ?? randomUUID();
  if (!held) {
    await query("INSERT INTO clients (id, desk_id, name, town, language) VALUES ($1, $2, $3, 'Turin', 'it')", [clientId, deskId, fields.client], on);
  }
  const id = await insertPiece(on, deskId, clientId, {
    title: fields.piece,
    maker: fields.maker || null,
    year: fields.year || null,
    stampNumber: fields.stamp,
    widthCm: null,
    depthCm: null,
    heightCm: null,
    weightKg: null,
    dueDate: null,
    notes: fields.notes || null,
  });
  return [entryOfPiece(deskId, { id, title: fields.piece }), ...(held ? [] : [entryOfClient(deskId, { id: clientId, name: fields.client })])];
}
