import type { Response } from "express";
import { one } from "../db.ts";
import { ApiError } from "../errors.ts";
import { sha256, type PhotoRow, type OrderRow } from "../store.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { param } from "../context.ts";

/**
 * GET /files/{token} — serves photos and the signed report only to holders of
 * a short-lived link, always as inert bytes.
 */
export async function serveFile(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const token = param(req, "token");
  const link = await one<{ token_hash: string; kind: "photo" | "report"; photo_id: string | null; order_id: string | null; expires_at: Date }>(
    services.pool,
    "SELECT * FROM file_links WHERE token_hash = $1",
    [sha256(token)],
  );
  if (!link) throw ApiError.notFound();
  if (link.expires_at.getTime() <= Date.now()) {
    throw new ApiError(410, "file_link_expired", "That file link has expired. Open it again from Bloom Desk.");
  }

  let bytes: Uint8Array;
  let contentType: string;
  let filename: string;
  if (link.kind === "photo" && link.photo_id) {
    const photo = await one<PhotoRow>(services.pool, "SELECT * FROM photos WHERE id = $1", [link.photo_id]);
    if (!photo) throw ApiError.notFound();
    bytes = await services.storage.get(photo.s3_key);
    contentType = photo.content_type;
    filename = `${photo.id}.${photo.ext}`;
  } else {
    const order = await one<OrderRow>(services.pool, "SELECT * FROM orders WHERE id = $1", [link.order_id]);
    if (!order || !order.report_key || order.signed_at === null) throw ApiError.notFound();
    bytes = await services.storage.get(order.report_key);
    contentType = "application/pdf";
    filename = `${order.report_key.split("/").pop() ?? "report"}`;
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).end(Buffer.from(bytes));
}
