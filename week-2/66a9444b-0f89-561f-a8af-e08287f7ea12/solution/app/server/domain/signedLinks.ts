// Short-lived signed links for private files. The token names the record, never an object key; it is
// signed with APP_SECRET and expires SIGNED_READ_SECONDS after issue.
import { config } from "../config.ts";
import { sign, signatureMatches } from "../auth.ts";
import { ApiError, notFound, route } from "../http.ts";
import { storageUp } from "../services/storage.ts";
import { ServiceDown } from "../services/serviceDown.ts";
import { artworkOriginalBytes } from "./entries.ts";
import { proofBytes } from "./proofs.ts";
import { isoUtc } from "./time.ts";

type LinkTarget = { kind: "proof" | "artwork"; id: string };

export async function signedLink(target: LinkTarget): Promise<{ url: string; expires_at: string }> {
  if (!(await storageUp())) throw new ServiceDown("minio");
  const expires = Date.now() + config.time.signedReadSeconds * 1000;
  const payload = Buffer.from(JSON.stringify({ k: target.kind, i: target.id, e: expires })).toString("base64url");
  return { url: `/api/files/${payload}.${sign(payload)}`, expires_at: isoUtc(expires) };
}

route("GET", "/api/files/:token", "public", async (ctx) => {
  const [payload, signature] = ctx.params.token!.split(".");
  if (!payload || !signature || !signatureMatches(payload, signature)) throw notFound();
  const target = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { k: LinkTarget["kind"]; i: string; e: number };
  if (Date.now() >= target.e) throw new ApiError(410, "link_expired");
  const file = target.k === "proof" ? await proofBytes(target.i) : await artworkOriginalBytes(target.i);
  if (!file) throw notFound();
  return { status: 200, bytes: file.bytes, contentType: file.contentType, headers: { "Cache-Control": "no-store", "Content-Disposition": "inline" } };
});
