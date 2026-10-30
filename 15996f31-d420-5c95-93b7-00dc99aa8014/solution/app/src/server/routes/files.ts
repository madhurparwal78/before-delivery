// Short-lived file links (brief: Server boundary → File links). A link is an unguessable token stored hashed,
// valid for FILE_URL_TTL_SECONDS after the 302 that issued it, served with sandboxing headers.

import { Readable } from "node:stream";
import { hashToken, newToken } from "../auth.js";
import { config } from "../config.js";
import { one, pool, type Db } from "../db.js";
import { gone, notFound, type Reply, type Route } from "../http.js";
import { getObject } from "../services/storage.js";

export async function fileRedirect(db: Db, objectKey: string, contentType: string, filename: string): Promise<Reply> {
  const token = newToken();
  await db.query("INSERT INTO file_links (token_hash, object_key, content_type, filename, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))", [
    hashToken(token),
    objectKey,
    contentType,
    filename,
    config.fileUrlTtlSeconds,
  ]);
  return { status: 302, headers: { Location: `/files/${token}` } };
}

export const fileRoutes: Route[] = [
  {
    method: "GET",
    path: "/files/:token",
    body: "none",
    auth: false,
    async handler({ params, now }) {
      const link = await one<{ object_key: string; content_type: string; filename: string; expires_at: Date }>(
        pool,
        "SELECT object_key, content_type, filename, expires_at FROM file_links WHERE token_hash = $1",
        [hashToken(params.token)],
      );
      if (link === null) throw notFound();
      if (now.getTime() >= link.expires_at.getTime()) throw gone("file_link_expired", "This file link has expired. Open the file again from Bloom Desk.");
      const bytes = await getObject(link.object_key);
      return {
        status: 200,
        stream: Readable.from([bytes]),
        headers: {
          "Content-Type": link.content_type,
          "Content-Length": String(bytes.length),
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Disposition": `inline; filename="${link.filename}"`,
          "Cache-Control": "private, no-store",
        },
      };
    },
  },
];
