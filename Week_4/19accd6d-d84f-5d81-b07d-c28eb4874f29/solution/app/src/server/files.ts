import { createHash } from "node:crypto";
import type { StoredFile } from "../shared/api";
import { limits } from "./config";
import { pool, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, notFound, storageUnavailable, validationFailed } from "./errors";
import { Context, defineRoute, reply } from "./http";
import type { Route } from "./http";
import { getObject, putObject, StorageUnavailable } from "./storage";
import { newId } from "./session";

export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Stores a file's bytes in MinIO exactly as received, then records it. */
export async function storeFile(db: Db, id: string, ownerId: string, name: string, bytes: Buffer): Promise<StoredFile> {
  await putObject(`files/${id}`, bytes);
  const sha256 = sha256Of(bytes);
  await db.query("INSERT INTO files (id, owner_id, name, bytes, sha256) VALUES ($1, $2, $3, $4, $5)", [id, ownerId, name, bytes.length, sha256]);
  return { id, name, bytes: bytes.length, sha256 };
}

function declaredName(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function fileBytes(id: string): Promise<Buffer> {
  try {
    return await getObject(`files/${id}`);
  } catch (error) {
    throw error instanceof StorageUnavailable ? storageUnavailable("Storage is unavailable.") : error;
  }
}

export const fileRoutes: Route[] = [
  defineRoute<undefined, { name: string; bytes: Buffer }>({
    method: "POST", path: "/api/files", access: "session", body: "raw",
    limit: () => limits.fileMaxBytes,
    tooLarge: (size, limit) => new ApiError(413, "file_too_large", `File too large: ${size} bytes (limit ${limit} bytes).`),
    validate: (body, _, ctx) => {
      const name = declaredName(ctx.req.headers["x-file-name"]);
      if (name.length < 1 || name.length > 200) throw validationFailed({ "X-File-Name": "The file name needs 1 to 200 characters." });
      return { name, bytes: body as Buffer };
    },
    run: async (ctx, _, file) => {
      try {
        return reply(201, { file: await storeFile(await ctx.transaction(), newId("f"), ctx.me().id, file.name, file.bytes) });
      } catch (error) {
        throw error instanceof StorageUnavailable ? storageUnavailable() : error;
      }
    },
  }),
  defineRoute<{ id: string }>({
    method: "GET", path: "/api/files/:id", access: "session",
    resolve: async (ctx: Context) => {
      const row = await queryOne<{ id: string }>(pool, "SELECT id FROM files WHERE id = $1 AND owner_id = $2", [ctx.params.id, ctx.me().id]);
      if (!row) throw notFound();
      return row;
    },
    run: async (_, file) => ({ status: 200, bytes: await fileBytes(file.id) }),
  }),
];
