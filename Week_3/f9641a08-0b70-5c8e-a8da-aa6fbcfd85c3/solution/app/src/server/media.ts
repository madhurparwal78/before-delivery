import type { IncomingMessage, ServerResponse } from "node:http";
import { one, pool } from "./db";
import { fail } from "./errors";
import { readObject } from "./storage";
import { VIEWS, studySvg, type View } from "./studies";

function notFound(res: ServerResponse): void {
  const error = fail("not_found");
  res.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(error.body));
}

/** `/media/products/<image id>` (uploaded, from MinIO) and `/media/studies/...` (generated, shipped with the app). */
export async function serveMedia(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const error = fail("method_not_allowed");
    res.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(error.body));
    return;
  }
  const study = /^\/media\/studies\/([^/]+)\/([^/]+)\/([a-z]+)\.svg$/.exec(path);
  if (study) {
    const [, slug, colour, view] = study;
    const product = await one<{ category: string }>(pool, "SELECT category FROM products WHERE slug = $1 AND status = 'published'", [slug]);
    const name = VIEWS.find((v) => v.toLowerCase() === view);
    if (!product || !colour || !name) return notFound(res);
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(studySvg(product.category, colour, name as View));
    return;
  }
  const image = /^\/media\/products\/([0-9a-f-]{36})$/.exec(path);
  if (!image) return notFound(res);
  const row = await one<{ storage_key: string; content_type: string }>(pool, "SELECT storage_key, content_type FROM product_images WHERE id = $1", [image[1]]);
  const bytes = row ? await readObject(row.storage_key) : null;
  if (!row || !bytes) return notFound(res);
  res.writeHead(200, { "Content-Type": row.content_type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
  res.end(bytes);
}
