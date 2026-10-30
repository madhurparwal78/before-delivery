// Versions, published payloads and go-live by the server's clock.
import { randomBytes } from "node:crypto";
import type { PublishedPayload, Version, VersionState } from "../shared/api-types.js";
import { isoSecond } from "../shared/format.js";
import type { Graph } from "../shared/graph.js";
import { SCHEDULER } from "./auth.js";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { pool, rows, transaction, type Db } from "./db.js";
import { announce } from "./events.js";
import { enqueueMail } from "./services/mail.js";
import { getObject, keys, putObject } from "./services/storage.js";
import { isReadOnly, currentSubscription } from "./domain/subscription.js";
import { nextState } from "./domain/versions.js";

export interface VersionRow {
  id: string; scene_id: string; workspace_id: string; number: number; label: string; state: VersionState; seq: number;
  created_by_kind: "member" | "agent"; created_by_id: string; created_by_name: string; publish_at: Date | null;
  published_at: Date | null; scheduled_by: string | null; has_thumbnail: boolean; created_at: Date;
}

interface Approval { version_id: string; member_id: string; member_name: string; at: Date }

export async function versionsOut(db: Db, versions: VersionRow[]): Promise<Version[]> {
  if (versions.length === 0) return [];
  const approvals = await rows<Approval>(db, "SELECT * FROM approvals WHERE version_id = ANY($1) ORDER BY at", [versions.map((v) => v.id)]);
  const embeds = await rows<{ id: string; embed_id: string | null }>(db, "SELECT id, embed_id FROM scenes WHERE id = ANY($1)", [[...new Set(versions.map((v) => v.scene_id))]]);
  const embedOf = new Map(embeds.map((s) => [s.id, s.embed_id]));
  return versions.map((v) => ({
    id: v.id, sceneId: v.scene_id, number: v.number, label: v.label, state: v.state, seq: v.seq,
    createdBy: { kind: v.created_by_kind, id: v.created_by_id, name: v.created_by_name },
    approvals: approvals.filter((a) => a.version_id === v.id).map((a) => ({ member: { kind: "member", id: a.member_id, name: a.member_name }, at: isoSecond(a.at) })),
    publishAt: v.publish_at ? isoSecond(v.publish_at) : null,
    publishedAt: v.published_at ? isoSecond(v.published_at) : null,
    embedId: v.state === "published" || v.state === "withdrawn" ? embedOf.get(v.scene_id) ?? null : null,
  }));
}

export async function announceVersions(db: Db, versions: VersionRow[]): Promise<void> {
  for (const version of await versionsOut(db, versions)) await announce(version.sceneId, "version", { data: version });
}

/** The graph of a version's snapshot as saved to file storage, or null when the snapshot is missing. */
export async function readSnapshot(version: VersionRow): Promise<Graph | null> {
  const raw = await getObject(keys.snapshot(version.workspace_id, version.scene_id, version.id));
  if (!raw) return null;
  const snapshot: { graph: Graph } = JSON.parse(raw.toString("utf8"));
  return snapshot.graph;
}

/** Only the scene name, the version's number, label and publish time, and its snapshot graph. */
export function publishedPayload(sceneName: string, version: VersionRow, publishedAt: Date, graph: Graph): PublishedPayload {
  return { scene: { name: sceneName }, version: { number: version.number, label: version.label, publishedAt: isoSecond(publishedAt) }, graph };
}

const embedCache = new Map<string, { versionId: string; payload: PublishedPayload }>();

export function cachedEmbed(embedId: string, versionId: string): PublishedPayload | null {
  const hit = embedCache.get(embedId);
  return hit && hit.versionId === versionId ? hit.payload : null;
}

export function rememberEmbed(embedId: string, versionId: string, payload: PublishedPayload): void {
  embedCache.set(embedId, { versionId, payload });
}

async function goLive(version: VersionRow): Promise<void> {
  if (isReadOnly(await currentSubscription(version.workspace_id), new Date())) return;
  const snapshot = await readSnapshot(version);
  if (!snapshot) return;
  const changed = await transaction(async (client) => {
    const [claimed] = await rows<VersionRow>(client,
      "SELECT * FROM versions WHERE id = $1 AND state = 'scheduled' FOR UPDATE SKIP LOCKED", [version.id]);
    if (!claimed) return [];
    const [scene] = await rows<{ name: string; embed_id: string | null }>(client, "SELECT name, embed_id FROM scenes WHERE id = $1 FOR UPDATE", [version.scene_id]);
    const embedId = scene.embed_id ?? `emb_${randomBytes(12).toString("hex")}`;
    const publishedAt = new Date();
    const payload = publishedPayload(scene.name, claimed, publishedAt, snapshot);
    await putObject(keys.published(version.workspace_id, embedId), Buffer.from(JSON.stringify(payload)), "application/json");
    await client.query("UPDATE scenes SET embed_id = $2 WHERE id = $1", [version.scene_id, embedId]);
    const withdrawn = await rows<VersionRow>(client,
      "UPDATE versions SET state = 'withdrawn' WHERE scene_id = $1 AND state = 'published' RETURNING *", [version.scene_id]);
    const [published] = await rows<VersionRow>(client,
      "UPDATE versions SET state = $2, published_at = $3 WHERE id = $1 RETURNING *", [version.id, nextState(claimed.state, "publish"), publishedAt]);
    await audit(client, version.workspace_id, SCHEDULER, "version.published", { type: "version", id: version.id });
    const recipients = await rows<{ email: string }>(client, "SELECT DISTINCT email FROM members WHERE id = ANY($1)",
      [[claimed.scheduled_by, claimed.created_by_kind === "member" ? claimed.created_by_id : null].filter((id): id is string => id !== null)]);
    await enqueueMail(client, {
      to: recipients.map((r) => r.email),
      subject: `Published: ${scene.name} v${claimed.number}`,
      body: `${scene.name} v${claimed.number} · ${claimed.label} is live.\n\nPublished at ${isoSecond(publishedAt)}.\n\nEmbed: ${config.publicUrl}/embed/${embedId}\n`,
    });
    rememberEmbed(embedId, version.id, payload);
    return [...withdrawn, published];
  });
  await announceVersions(pool, changed);
}

/** Every scheduled version whose publish time has come goes live; a failure leaves it scheduled for the next pass. */
export async function publishDueVersions(): Promise<void> {
  const due = await rows<VersionRow>(pool, "SELECT * FROM versions WHERE state = 'scheduled' AND publish_at <= $1 ORDER BY publish_at", [new Date()]);
  for (const version of due) {
    try {
      await goLive(version);
    } catch (error) {
      console.error(`go-live of ${version.id} deferred:`, error instanceof Error ? error.message : error);
    }
  }
}
