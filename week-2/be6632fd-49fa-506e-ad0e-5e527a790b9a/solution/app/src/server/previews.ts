// Press previews (brief: API → Press previews; Business rules → Press previews). Press surfaces carry only the
// press payload fields: no wholesale price, RRP, stockist, internal note, member name or staff email.
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { COPY } from "../shared/copy";
import { marketTime } from "../shared/format";
import { CITY, instantText } from "../shared/time";
import { type Member, randomToken, requireRole, staff } from "./auth";
import { config } from "./config";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { type DropRow, staffDrop } from "./drops";
import { ApiError, type Json, notFound, reply, route, validationFailed } from "./http";
import { looksOf } from "./looks";
import { queueMail } from "./mail";
import { marketStatesOf } from "./pieces";
import { getObject, putObject, storageDown } from "./s3";
import { checkEmail, failed, type Fields, isUuid, requiredText } from "./validate";

interface PreviewRow {
  id: string;
  drop_id: string;
  editor_name: string;
  editor_email: string;
  outlet: string;
  token: string;
  revoked_at: Date | null;
  issued_at: Date;
  expires_at: Date;
}

type LinkState = "active" | "link_revoked" | "link_expired" | "link_replaced" | "drop_withdrawn";

/** The one decision of a preview link's state. */
function linkState(preview: Pick<PreviewRow, "revoked_at" | "expires_at">, replaced: boolean, dropStatus: string, nowMs: number): LinkState {
  if (dropStatus === "withdrawn") return "drop_withdrawn";
  if (replaced) return "link_replaced";
  if (preview.revoked_at) return "link_revoked";
  if (nowMs >= preview.expires_at.getTime()) return "link_expired";
  return "active";
}

const DEAD_COPY: Record<Exclude<LinkState, "active">, string> = {
  drop_withdrawn: COPY.dropWithdrawn,
  link_replaced: COPY.linkReplaced,
  link_revoked: COPY.linkRevoked,
  link_expired: COPY.linkExpired,
};

function previewJson(p: PreviewRow): Json {
  const state = linkState(p, false, "scheduled", Date.now());
  return {
    id: p.id,
    editorName: p.editor_name,
    editorEmail: p.editor_email,
    outlet: p.outlet,
    status: state === "link_revoked" ? "revoked" : state === "link_expired" ? "expired" : "active",
    issuedAt: instantText(p.issued_at.getTime()),
    expiresAt: instantText(p.expires_at.getTime()),
    link: `/press/${p.token}`,
  };
}

async function embargoOf(db: Db, dropId: string): Promise<number> {
  const markets = await marketStatesOf(db, dropId);
  return Math.min(...markets.map((m) => m.goLiveMs ?? Number.POSITIVE_INFINITY));
}

async function sendPreview(db: Db, drop: Pick<DropRow, "id" | "name">, p: PreviewRow): Promise<void> {
  const embargo = await embargoOf(db, drop.id);
  await queueMail(db, {
    toName: p.editor_name,
    toEmail: p.editor_email,
    subject: `Preview: ${drop.name} (embargoed until ${marketTime(embargo)})`,
    body: `Hello ${p.editor_name},\n\nHere is your press preview of ${drop.name}, embargoed until ${marketTime(embargo)}.\n\n${config.publicUrl}/press/${p.token}\n\nThe link expires ${marketTime(p.expires_at.getTime())}.\n`,
  });
}

async function previewOf(db: Db, me: Member, id: string): Promise<{ preview: PreviewRow; drop: DropRow }> {
  const found = isUuid(id) ? await one<PreviewRow>(db, "SELECT p.* FROM previews p JOIN drops d ON d.id = p.drop_id WHERE p.id = $1 AND d.workspace_id = $2 FOR UPDATE OF p", [id, me.workspaceId]) : undefined;
  if (!found) throw notFound();
  return { preview: found, drop: await staffDrop(db, me, found.drop_id) };
}

route("GET", "/api/drops/{dropId}/previews", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "press_lead");
  const items = await rows<PreviewRow>(pool, "SELECT * FROM previews WHERE drop_id = $1 ORDER BY issued_at DESC, editor_name", [drop.id]);
  return reply(200, { items: items.map(previewJson) });
});

route("POST", "/api/drops/{dropId}/previews", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "press_lead");
  const body = ctx.json();
  if (drop.status === "draft") throw new ApiError(409, "drop_not_public", COPY.dropNotPublic);
  if (drop.status === "withdrawn") throw new ApiError(409, "drop_withdrawn_already", COPY.dropWithdrawnAlready);
  const fields: Fields = {};
  const editorName = requiredText(body.editorName, "editorName", 80, fields);
  const editorEmail = checkEmail(body.editorEmail, "editorEmail", fields);
  const outlet = requiredText(body.outlet, "outlet", 80, fields);
  if (failed(fields)) throw validationFailed(fields);
  return tx(async (db) => {
    const issued = nowSeconds();
    const created = (await one<PreviewRow>(
      db,
      "INSERT INTO previews (drop_id, editor_name, editor_email, outlet, token, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [drop.id, editorName, editorEmail, outlet, randomToken(), issued, new Date(issued.getTime() + config.ttl.preview * 1000)],
    )) as PreviewRow;
    await sendPreview(db, drop, created);
    return reply(201, previewJson(created));
  });
});

route("POST", "/api/previews/{previewId}/revoke", "none", async (ctx) => {
  const me = await staff(ctx);
  await previewOf(pool, me, ctx.params.previewId);
  requireRole(me, "press_lead");
  return tx(async (db) => {
    const { preview } = await previewOf(db, me, ctx.params.previewId);
    if (preview.revoked_at) throw new ApiError(409, "preview_revoked", COPY.previewRevoked);
    const revoked = (await one<PreviewRow>(db, "UPDATE previews SET revoked_at = $2 WHERE id = $1 RETURNING *", [preview.id, nowSeconds()])) as PreviewRow;
    return reply(200, previewJson(revoked));
  });
});

route("POST", "/api/previews/{previewId}/regenerate", "none", async (ctx) => {
  const me = await staff(ctx);
  await previewOf(pool, me, ctx.params.previewId);
  requireRole(me, "press_lead");
  return tx(async (db) => {
    const { preview, drop } = await previewOf(db, me, ctx.params.previewId);
    if (preview.revoked_at) throw new ApiError(409, "preview_revoked", COPY.previewRevoked);
    await db.query("INSERT INTO replaced_preview_tokens (token, preview_id) VALUES ($1, $2)", [preview.token, preview.id]);
    const issued = nowSeconds();
    const renewed = (await one<PreviewRow>(db, "UPDATE previews SET token = $2, issued_at = $3, expires_at = $4 WHERE id = $1 RETURNING *", [
      preview.id,
      randomToken(),
      issued,
      new Date(issued.getTime() + config.ttl.preview * 1000),
    ])) as PreviewRow;
    await sendPreview(db, drop, renewed);
    return reply(200, previewJson(renewed));
  });
});

/** A live preview link, or the 410 for its dead state. */
async function livePreview(db: Db, token: string): Promise<{ preview: PreviewRow; drop: DropRow & { brand: string } }> {
  const replaced = await one<{ preview_id: string }>(db, "SELECT preview_id FROM replaced_preview_tokens WHERE token = $1", [token]);
  const preview = await one<PreviewRow>(db, replaced ? "SELECT * FROM previews WHERE id = $1" : "SELECT * FROM previews WHERE token = $1", [replaced ? replaced.preview_id : token]);
  if (!preview) throw notFound();
  const drop = (await one<DropRow & { brand: string }>(db, "SELECT d.*, w.name AS brand FROM drops d JOIN workspaces w ON w.id = d.workspace_id WHERE d.id = $1", [preview.drop_id])) as DropRow & { brand: string };
  const state = linkState(preview, Boolean(replaced), drop.status, Date.now());
  if (state !== "active") throw new ApiError(410, state, DEAD_COPY[state]);
  return { preview, drop };
}

route("GET", "/api/press/{token}", "none", async (ctx) => {
  const { preview, drop } = await livePreview(pool, ctx.params.token);
  const markets = await marketStatesOf(pool, drop.id);
  const story = await one<{ published_html: string | null }>(pool, "SELECT published_html FROM stories WHERE drop_id = $1", [drop.id]);
  const looks = await looksOf(pool, drop.id);
  const embargo = await embargoOf(pool, drop.id);
  return reply(200, {
    brand: drop.brand,
    dropName: drop.name,
    type: drop.type,
    embargoUntil: Number.isFinite(embargo) ? instantText(embargo) : null,
    expiresAt: instantText(preview.expires_at.getTime()),
    markets: markets.map((m) => ({ market: m.market, city: CITY[m.market], goLiveAt: m.goLiveAt })),
    storyHtml: story?.published_html ?? "",
    looks: looks.map((l) => ({
      id: l.id,
      position: l.position,
      title: l.title,
      altText: l.altText,
      imageUrl: `/api/press/${ctx.params.token}/looks/${l.id}/image`,
      width: l.width,
      height: l.height,
    })),
  });
});

route("GET", "/api/press/{token}/looks/{lookId}/image", "none", async (ctx) => {
  const { drop } = await livePreview(pool, ctx.params.token);
  const look = (await looksOf(pool, drop.id)).find((l) => l.id === ctx.params.lookId);
  if (!look) throw notFound();
  return { status: 200, bytes: await getObject(look.objectKey), contentType: look.contentType, headers: { "Cache-Control": "private, max-age=300" } };
});

/** A stored (uncompressed) ZIP archive. */
function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + file.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

route("GET", "/api/press/{token}/zip", "none", async (ctx) => {
  const { preview, drop } = await livePreview(pool, ctx.params.token);
  const embargo = await embargoOf(pool, drop.id);
  const files: Array<{ name: string; data: Buffer }> = [];
  try {
    for (const look of await looksOf(pool, drop.id)) {
      files.push({ name: `look-${String(look.position).padStart(2, "0")}.${look.contentType === "image/jpeg" ? "jpg" : "png"}`, data: await getObject(look.objectKey) });
    }
    const manifest = {
      dropName: drop.name,
      embargoUntil: Number.isFinite(embargo) ? instantText(embargo) : null,
      files: files.map((f) => ({ name: f.name, sizeBytes: f.data.length, sha256: createHash("sha256").update(f.data).digest("hex") })),
    };
    const archive = zip([...files, { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }]);
    await putObject(`press/${preview.id}.zip`, archive, "application/zip");
    return {
      status: 200,
      bytes: archive,
      contentType: "application/zip",
      headers: { "Content-Disposition": `attachment; filename="${drop.slug}-press.zip"` },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw storageDown(COPY.downloadsUnavailable);
    throw error;
  }
});
