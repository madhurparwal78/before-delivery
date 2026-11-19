import { createHash, randomUUID } from "node:crypto";
import { one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { photographKey, storedPictureType } from "../domain/files.ts";
import { instant } from "../domain/time.ts";
import { ApiError, conflict, invalid, notFound, unavailable } from "../http/errors.ts";
import { bytes, json, route } from "../http/router.ts";
import { ProviderDown } from "../providers/call.ts";
import { getObject, putObject } from "../providers/s3.ts";
import { pieceOf, pieceResource } from "./resources.ts";

const PHOTOGRAPH_LIMIT = 8_000_000;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);

interface PhotographRow {
  id: string;
  number: number;
  side: string;
  sha256: string;
  bytes: number;
  state: string;
  created_at: Date;
}

function photographBody(row: PhotographRow): Record<string, unknown> {
  return { id: row.id, number: row.number, side: row.side, sha256: row.sha256, bytes: row.bytes, state: row.state, createdAt: instant(row.created_at) };
}

/** What a file's own header bytes say it is; its name and declared type decide nothing. */
function pictureType(file: Buffer): "image/png" | "image/jpeg" | null {
  if (file.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) return "image/png";
  if (file.subarray(0, JPEG_HEADER.length).equals(JPEG_HEADER)) return "image/jpeg";
  return null;
}

function repeatRefusal(number: number): ApiError {
  return conflict("repeatPhotograph", copy("F-26", { n: number }));
}

const storeDown = (): ApiError => unavailable("storeDown", copy("F-27"));

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/pieces/:id/photographs",
    resource: pieceResource,
    handle: async (ctx) => {
      const rows = await query<PhotographRow>("SELECT * FROM photographs WHERE piece_id = $1 ORDER BY number", [ctx.params.id]);
      return json(200, { photographs: rows.map(photographBody) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/pieces/:id/photographs",
    body: "multipart",
    file: { bytes: PHOTOGRAPH_LIMIT, message: copy("F-25") },
    resource: pieceResource,
    handle: async (ctx) => {
      const piece = pieceOf(ctx);
      const file = ctx.form?.file;
      if (!file) throw invalid("file", copy("F-04"));
      const side = ctx.form?.fields.side || "before";
      if (side !== "before" && side !== "after") throw invalid("side", copy("F-08"));
      const type = pictureType(file.bytes);
      if (!type) throw invalid("file", copy("F-24"));
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      const known = await one<{ number: number }>("SELECT number FROM photographs WHERE piece_id = $1 AND sha256 = $2", [piece.id, sha256]);
      if (known) throw repeatRefusal(known.number);
      try {
        await putObject(photographKey(piece.desk_id, piece.id, sha256), file.bytes, type);
      } catch (error) {
        if (error instanceof ProviderDown) throw storeDown();
        throw error;
      }
      const row = await tx(async (client) => {
        await client.query("SELECT 1 FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
        const repeat = await one<{ number: number }>("SELECT number FROM photographs WHERE piece_id = $1 AND sha256 = $2", [piece.id, sha256], client);
        if (repeat) throw repeatRefusal(repeat.number);
        return one<PhotographRow>(
          `INSERT INTO photographs (id, piece_id, number, side, sha256, bytes, state)
           SELECT $1, $2, COALESCE(max(number), 0) + 1, $3, $4, $5, 'stored' FROM photographs WHERE piece_id = $2 RETURNING *`,
          [randomUUID(), piece.id, side, sha256, file.bytes.length],
          client,
        );
      });
      return json(201, { photograph: photographBody(row as PhotographRow) });
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/photographs/:photoId/file",
    resource: pieceResource,
    handle: async (ctx) => {
      const piece = pieceOf(ctx);
      const row = await one<PhotographRow>("SELECT * FROM photographs WHERE id = $1 AND piece_id = $2", [ctx.params.photoId, piece.id]);
      if (!row) throw notFound();
      if (row.state !== "stored") throw storeDown();
      try {
        const file = await getObject(photographKey(piece.desk_id, piece.id, row.sha256));
        return bytes(200, storedPictureType(file), file);
      } catch (error) {
        if (error instanceof ProviderDown) throw storeDown();
        throw error;
      }
    },
  });
}
