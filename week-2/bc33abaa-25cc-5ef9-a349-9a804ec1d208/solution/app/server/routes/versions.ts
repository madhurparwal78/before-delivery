// Versions, review links, exports and the public review and embed endpoints.
import { readFileSync } from "node:fs";
import type { PublishedPayload } from "../../shared/api-types.js";
import { graphHash, isName, type Graph } from "../../shared/graph.js";
import { isoSecond, localTime } from "../../shared/format.js";
import { authorOf, randomToken, secretHash, type Caller } from "../auth.js";
import { audit } from "../audit.js";
import { one, pool, rows, transaction } from "../db.js";
import { conflict, gone, invalid, invalidTransition, linkExpired, notFound, unavailable } from "../errors.js";
import { bytes, json, noContent, publicRoute, route } from "../http.js";
import { authorize, authorizeApproval } from "../domain/permissions.js";
import { graphAt, loadScene } from "../domain/history.js";
import { assertWritable, effectiveState, currentSubscription } from "../domain/subscription.js";
import { REVIEWABLE, nextState, type VersionMove } from "../domain/versions.js";
import { enqueueMail } from "../services/mail.js";
import { getObject, keys, putObject } from "../services/storage.js";
import { announceVersions, cachedEmbed, publishedPayload, readSnapshot, rememberEmbed, versionsOut, type VersionRow } from "../publish.js";
import { loadWorkspace } from "../workspace.js";
import { zip } from "../zip.js";
import { bodyOf, newId } from "./account.js";

const DAY_MS = 86_400_000;
const VIEWER_HTML = readFileSync(new URL("./viewer.html", import.meta.url));

async function loadVersion(caller: Caller, versionId: string): Promise<VersionRow> {
  const version = await one<VersionRow>(pool, "SELECT * FROM versions WHERE id = $1 AND workspace_id = $2", [versionId, caller.workspaceId]);
  if (!version) throw notFound();
  return version;
}

function instantWithin(value: unknown, field: string, minMs: number, maxMs: number, message: string): Date {
  const at = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  const lead = at.getTime() - Date.now();
  if (Number.isNaN(lead) || lead < minMs || lead > maxMs) throw invalid({ [field]: message });
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

route("GET", "/api/scenes/:sceneId/versions", async ({ caller, params }) => {
  const scene = await loadScene(pool, caller.workspaceId, params.sceneId);
  authorize(caller, "scene.read");
  const versions = await rows<VersionRow>(pool, "SELECT * FROM versions WHERE scene_id = $1 ORDER BY number", [scene.id]);
  return json(200, { versions: await versionsOut(pool, versions) });
});

route("POST", "/api/scenes/:sceneId/versions", async (ctx) => {
  const { caller } = ctx;
  const scene = await loadScene(pool, caller.workspaceId, ctx.params.sceneId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  const label = bodyOf(ctx).label;
  if (!isName(label, 60)) throw invalid({ label: "Use 1 to 60 characters" });
  const id = newId("ver");
  const seq = scene.latest_seq;
  const snapshot = { seq, graph: scene.graph, hash: graphHash(scene.graph) };
  await putObject(keys.snapshot(caller.workspaceId, scene.id, id), Buffer.from(JSON.stringify(snapshot)), "application/json");
  const author = authorOf(caller);
  const version = await transaction(async (client) => {
    await client.query("SELECT id FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
    const [row] = await rows<VersionRow>(client,
      `INSERT INTO versions (id, scene_id, workspace_id, number, label, state, seq, created_by_kind, created_by_id, created_by_name, created_at)
       VALUES ($1, $2, $3, (SELECT coalesce(max(number), 0) + 1 FROM versions WHERE scene_id = $2), $4, 'draft', $5, $6, $7, $8, now()) RETURNING *`,
      [id, scene.id, caller.workspaceId, label, seq, author.kind, author.id, author.name]);
    await audit(client, caller.workspaceId, author, "version.saved", { type: "version", id });
    return row;
  });
  await announceVersions(pool, [version]);
  const [out] = await versionsOut(pool, [version]);
  return json(201, out);
});

async function move(caller: Caller, version: VersionRow, step: VersionMove, action: string, extra: { publishAt?: Date | null } = {}): Promise<VersionRow> {
  const state = nextState(version.state, step);
  const updated = await transaction(async (client) => {
    const [row] = await rows<VersionRow>(client,
      `UPDATE versions SET state = $2, publish_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE publish_at END,
       scheduled_by = CASE WHEN $3::boolean THEN $5 ELSE scheduled_by END WHERE id = $1 AND state = $6 RETURNING *`,
      [version.id, state, "publishAt" in extra, extra.publishAt ?? null, extra.publishAt ? caller.id : null, version.state]);
    if (!row) throw invalidTransition(version.state, state);
    await audit(client, caller.workspaceId, authorOf(caller), action, { type: "version", id: version.id });
    return row;
  });
  await announceVersions(pool, [updated]);
  return updated;
}

const versionReply = async (row: VersionRow) => json(200, (await versionsOut(pool, [row]))[0]);

route("POST", "/api/versions/:versionId/submit", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  return versionReply(await move(caller, version, "submit", "version.submitted"));
});

route("POST", "/api/versions/:versionId/approve", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorizeApproval(caller, version.created_by_id);
  await assertWritable(caller.workspaceId);
  if (version.state !== "in_review") throw conflict("not_in_review");
  const inserted = await transaction(async (client) => {
    const added = await client.query("INSERT INTO approvals (version_id, member_id, member_name, at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
      [version.id, caller.id, caller.name]);
    if (added.rowCount) await audit(client, caller.workspaceId, authorOf(caller), "version.approved", { type: "version", id: version.id });
    return (added.rowCount ?? 0) > 0;
  });
  if (inserted) await announceVersions(pool, [version]);
  return versionReply(version);
});

route("POST", "/api/versions/:versionId/schedule", async (ctx) => {
  const { caller } = ctx;
  const version = await loadVersion(caller, ctx.params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  nextState(version.state, "schedule");
  const approved = await one(pool, "SELECT 1 FROM approvals WHERE version_id = $1 AND member_id <> $2", [version.id, version.created_by_id]);
  if (!approved) throw conflict("approval_required");
  const other = await one(pool, "SELECT 1 FROM versions WHERE scene_id = $1 AND state = 'scheduled' AND id <> $2", [version.scene_id, version.id]);
  if (other) throw conflict("another_version_scheduled");
  const publishAt = instantWithin(bodyOf(ctx).publishAt, "publishAt", 5_000, 365 * DAY_MS, "Pick a time between 5 seconds and 365 days from now");
  if (!(await readSnapshot(version))) throw unavailable("file_storage");
  const updated = await move(caller, version, "schedule", "version.scheduled", { publishAt });
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const scene = await loadScene(pool, caller.workspaceId, version.scene_id);
  if (caller.kind === "member") {
    const when = localTime(isoSecond(publishAt), ws.time_zone);
    await enqueueMail(pool, {
      to: [caller.email], subject: `Scheduled: ${scene.name} v${version.number} goes live ${when}`,
      body: `${scene.name} v${version.number} · ${version.label} is scheduled to go live ${when}.\n\nOrrery Studio`,
    });
  }
  return versionReply(updated);
});

route("POST", "/api/versions/:versionId/unschedule", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  return versionReply(await move(caller, version, "unschedule", "version.unscheduled", { publishAt: null }));
});

route("POST", "/api/versions/:versionId/withdraw", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  return versionReply(await move(caller, version, "withdraw", "version.withdrawn"));
});

// --- Exports ---------------------------------------------------------------------------------------------------

const ASSET_EXTENSIONS: Record<string, string> = { "model/gltf-binary": "glb", "image/png": "png", "image/jpeg": "jpg" };

route("POST", "/api/versions/:versionId/exports", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (version.state !== "published" || !version.published_at) throw conflict("not_published");
  const scene = await loadScene(pool, caller.workspaceId, version.scene_id);
  const graph = await graphAt(scene, version.seq);
  const payload = publishedPayload(scene.name, version, version.published_at, graph);
  const assetIds = [...new Set(graph.nodes.flatMap((n) => (n.assetId ? [n.assetId] : [])))];
  const assets = await rows<{ id: string; content_type: string }>(pool, "SELECT id, content_type FROM assets WHERE workspace_id = $1 AND id = ANY($2)", [caller.workspaceId, assetIds]);
  const entries: { name: string; data: Buffer }[] = [{ name: "scene.json", data: Buffer.from(JSON.stringify(payload, null, 2)) }, { name: "viewer.html", data: VIEWER_HTML }];
  for (const asset of assets) {
    const file = await getObject(keys.asset(caller.workspaceId, asset.id));
    if (file) entries.push({ name: `assets/${asset.id}.${ASSET_EXTENSIONS[asset.content_type] ?? "bin"}`, data: file });
  }
  const archive = zip(entries);
  const id = newId("exp");
  await putObject(keys.exportBundle(caller.workspaceId, id), archive, "application/zip");
  await transaction(async (client) => {
    await client.query("INSERT INTO exports (id, workspace_id, version_id, bytes, created_at) VALUES ($1, $2, $3, $4, now())", [id, caller.workspaceId, version.id, archive.length]);
    await audit(client, caller.workspaceId, authorOf(caller), "export.created", { type: "export", id });
  });
  return json(201, { id, versionId: version.id, bytes: archive.length });
});

route("GET", "/api/exports/:exportId", async ({ caller, params }) => {
  const exported = await one<{ id: string; version_id: string }>(pool, "SELECT id, version_id FROM exports WHERE id = $1 AND workspace_id = $2", [params.exportId, caller.workspaceId]);
  if (!exported) throw notFound();
  authorize(caller, "scene.read");
  const archive = await getObject(keys.exportBundle(caller.workspaceId, exported.id));
  if (!archive) throw notFound();
  return bytes(archive, "application/zip", { "Content-Disposition": `attachment; filename="orrery-export-${exported.id}.zip"` });
});

// --- Review links ----------------------------------------------------------------------------------------------

interface LinkRow { id: string; workspace_id: string; version_id: string; expires_at: Date; revoked_at: Date | null; created_by_kind: "member" | "agent"; created_by_id: string; created_by_name: string }

const linkStatus = (l: LinkRow, now: Date) => (l.revoked_at ? "revoked" : l.expires_at <= now ? "expired" : "active");

route("GET", "/api/versions/:versionId/review-links", async ({ caller, params }) => {
  const version = await loadVersion(caller, params.versionId);
  authorize(caller, "scene.read");
  const now = new Date();
  const links = await rows<LinkRow>(pool, "SELECT * FROM review_links WHERE version_id = $1 ORDER BY created_at", [version.id]);
  return json(200, {
    links: links.map((l) => ({ id: l.id, expiresAt: isoSecond(l.expires_at), status: linkStatus(l, now),
      createdBy: { kind: l.created_by_kind, id: l.created_by_id, name: l.created_by_name } })),
  });
});

const linkReply = (link: LinkRow, token: string, status = 200) =>
  json(status, { id: link.id, token, url: `/review/${token}`, expiresAt: isoSecond(link.expires_at) });

route("POST", "/api/versions/:versionId/review-links", async (ctx) => {
  const { caller } = ctx;
  const version = await loadVersion(caller, ctx.params.versionId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (!(await loadWorkspace(pool, caller.workspaceId)).review_links_enabled) throw conflict("review_links_disabled");
  if (!REVIEWABLE.includes(version.state)) throw conflict("version_not_reviewable");
  const expiresAt = instantWithin(bodyOf(ctx).expiresAt, "expiresAt", 10_000, 30 * DAY_MS, "Pick a time between 10 seconds and 30 days from now");
  const token = randomToken(32);
  const author = authorOf(caller);
  const link = await transaction(async (client) => {
    const [row] = await rows<LinkRow>(client,
      `INSERT INTO review_links (id, workspace_id, version_id, token_hash, expires_at, created_by_kind, created_by_id, created_by_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [newId("rl"), caller.workspaceId, version.id, secretHash(token), expiresAt, author.kind, author.id, author.name]);
    await audit(client, caller.workspaceId, author, "review_link.created", { type: "review_link", id: row.id });
    return row;
  });
  return linkReply(link, token, 201);
});

async function loadLink(caller: Caller, linkId: string): Promise<LinkRow> {
  const link = await one<LinkRow>(pool, "SELECT * FROM review_links WHERE id = $1 AND workspace_id = $2", [linkId, caller.workspaceId]);
  if (!link) throw notFound();
  return link;
}

route("POST", "/api/review-links/:linkId/regenerate", async ({ caller, params }) => {
  const link = await loadLink(caller, params.linkId);
  authorize(caller, "version.manage");
  await assertWritable(caller.workspaceId);
  if (link.revoked_at) throw conflict("invalid_transition", { from: "revoked", to: "active" });
  const token = randomToken(32);
  await transaction(async (client) => {
    await client.query("UPDATE review_links SET token_hash = $2 WHERE id = $1", [link.id, secretHash(token)]);
    await audit(client, caller.workspaceId, authorOf(caller), "review_link.regenerated", { type: "review_link", id: link.id });
  });
  return linkReply(link, token);
});

route("DELETE", "/api/review-links/:linkId", async ({ caller, params }) => {
  const link = await loadLink(caller, params.linkId);
  authorize(caller, "version.manage");
  await transaction(async (client) => {
    await client.query("UPDATE review_links SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [link.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "review_link.revoked", { type: "review_link", id: link.id });
  });
  return noContent();
});

/** A link opens only its own version's snapshot while it is unrevoked, current, enabled and the version unpublished. */
export async function reviewTarget(token: string): Promise<{ version: VersionRow; sceneName: string; graph: Graph }> {
  const link = await one<LinkRow>(pool, "SELECT * FROM review_links WHERE token_hash = $1", [secretHash(token)]);
  if (!link || link.revoked_at) throw notFound();
  const ws = await loadWorkspace(pool, link.workspace_id);
  const version = await one<VersionRow>(pool, "SELECT * FROM versions WHERE id = $1", [link.version_id]);
  if (!ws.review_links_enabled || !version || !REVIEWABLE.includes(version.state)) throw notFound();
  if (link.expires_at <= new Date()) throw linkExpired();
  const scene = await loadScene(pool, link.workspace_id, version.scene_id);
  return { version, sceneName: scene.name, graph: await graphAt(scene, version.seq) };
}

publicRoute("GET", "/api/review/:token", async ({ params }) => {
  const { version, sceneName, graph } = await reviewTarget(params.token);
  return json(200, { scene: { name: sceneName }, version: { number: version.number, label: version.label, state: version.state }, graph });
});

// --- Embeds ----------------------------------------------------------------------------------------------------

/** The scene's current published version and its payload; withdrawn or cancelled answers gone. */
export async function embedTarget(embedId: string) {
  const scene = await one<{ id: string; workspace_id: string; name: string }>(pool, "SELECT id, workspace_id, name FROM scenes WHERE embed_id = $1", [embedId]);
  if (!scene) throw notFound();
  const sub = await currentSubscription(scene.workspace_id);
  if (effectiveState(sub, new Date()) === "cancelled") throw gone();
  const version = await one<VersionRow>(pool, "SELECT * FROM versions WHERE scene_id = $1 AND state = 'published' ORDER BY number DESC LIMIT 1", [scene.id]);
  if (!version || !version.published_at) throw gone();
  let payload = cachedEmbed(embedId, version.id);
  if (!payload) {
    const stored = await getObject(keys.published(scene.workspace_id, embedId));
    if (!stored) throw gone();
    const parsed: PublishedPayload = JSON.parse(stored.toString("utf8"));
    rememberEmbed(embedId, version.id, parsed);
    payload = parsed;
  }
  return { scene, version, payload };
}

publicRoute("GET", "/api/embed/:embedId", async ({ params }) => json(200, (await embedTarget(params.embedId)).payload));

publicRoute("GET", "/api/embed/:embedId/assets/:assetId", async ({ params }) => {
  const { scene, payload } = await embedTarget(params.embedId);
  if (!payload.graph.nodes.some((n) => n.assetId === params.assetId)) throw notFound();
  const asset = await one<{ content_type: string }>(pool, "SELECT content_type FROM assets WHERE id = $1 AND workspace_id = $2", [params.assetId, scene.workspace_id]);
  const file = asset ? await getObject(keys.asset(scene.workspace_id, params.assetId)) : null;
  if (!asset || !file) throw notFound();
  return bytes(file, asset.content_type, { "Cache-Control": "public, max-age=3600" });
});

