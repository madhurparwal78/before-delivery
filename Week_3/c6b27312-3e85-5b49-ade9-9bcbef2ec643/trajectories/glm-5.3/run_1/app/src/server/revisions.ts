import { Buffer } from "node:buffer";
import { AppCtx } from "./ctx.js";
import { httpError } from "./http.js";
import { newId } from "./auth.js";
import { parseStored, buildTape } from "./domain.js";
import { evaluate } from "./evaluate.js";
import { canonicalJson, digestOf } from "../shared/canonical.js";
import type { Values, Solid } from "../shared/records.js";
import { STORAGE_OUTAGE_COPY } from "./http.js";
import { thumbnailSvg } from "./thumbnail.js";

export interface RevisionWriteResult {
  revision: Record<string, unknown>;
  label: string;
}

/** Storage-confirmed revision creation: all objects first, then one transaction. */
export async function createRevision(
  ctx: AppCtx,
  opts: {
    partSlug: string;
    parentRevisionId: string | null;
    authorId: string;
    values: Values;
    source: string;
    message: string;
    restoredFrom?: string | null;
    forkedFrom?: { revisionId: string; operation: number } | null;
    evaluationId?: string | null;
  }
): Promise<{ id: string; label: number; digest: string }> {
  // Evaluate against the source.
  const parsed = parseStored(opts.source);
  const ev = evaluate(parsed, opts.values, ctx.config.evalTimeoutMs);
  let digest: string, volume: number, bbox: [number, number, number], faces: number, solid: Solid;
  if ("ok" in ev) {
    digest = ev.ok.digest;
    volume = ev.ok.volume;
    bbox = ev.ok.bbox;
    faces = ev.ok.faces;
    solid = ev.ok.solid;
  } else {
    throw httpError(422, "evaluation_failed", ev.fail.diagnostics[0]?.message ?? "Evaluation failed.", { diagnostics: ev.fail.diagnostics });
  }
  // Store objects: source, solid, tape solids, thumbnail.
  const sourceKey = `sources/${digestOf(opts.source)}.tine`;
  const digests = new Set<string>();
  const tape = buildTape(opts.source, parsed, opts.values);
  for (const entry of tape.operations) digests.add(entry.digest);
  digests.add(digest);
  // PostgreSQL holds the source text; MinIO holds the stored copy.
  await ctx.db.query(
    `insert into sources (key, bytes) values ($1,$2) on conflict (key) do nothing`,
    [sourceKey, Buffer.from(opts.source, "utf8")]
  );
  try {
    await ctx.putObject(sourceKey, Buffer.from(opts.source, "utf8"), "text/plain");
    for (const d of digests) {
      const solidJson = canonicalJson(solidFor(d, tape.operations, digest, solid));
      await ctx.putObject(`solids/${d}.json`, Buffer.from(solidJson, "utf8"), "application/json");
    }
    for (const d of digests) {
      if (!(await ctx.s3.headObject(`thumbnails/${d}.svg`))) {
        await ctx.putObject(`thumbnails/${d}.svg`, Buffer.from(thumbnailSvg(solidFor(d, tape.operations, digest, solid)), "utf8"), "image/svg+xml");
      }
    }
  } catch {
    throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
  }
  // One transaction: revision row, tape row, outbox event.
  const client = await ctx.db.connect();
  try {
    await client.query("begin");
    const next = await client.query(
      `select coalesce(max(label), 0) + 1 as n from revisions where part_slug = $1`, [opts.partSlug]);
    const label = next.rows[0]!.n;
    const id = newId("rev");
    const evalId = opts.evaluationId ?? newId("eval");
    await client.query(
      `insert into revisions (id, part_slug, label, parent_id, author_id, values, source_key, evaluation_id, geometry_digest, message, restored_from, forked_from)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, opts.partSlug, label, opts.parentRevisionId, opts.authorId, JSON.stringify(opts.values), sourceKey, evalId, digest, opts.message, opts.restoredFrom ?? null, opts.forkedFrom ? JSON.stringify(opts.forkedFrom) : null]
    );
    await client.query(
      `insert into evaluations (id, part_slug, viewer_id, seq, status, geometry_digest, volume, bbox, faces, solid, diagnostics, finished_at)
       values ($1,$2,$3,$4,'succeeded',$5,$6,$7,$8,$9,'[]', now())
       on conflict (id) do nothing`,
      [evalId, opts.partSlug, opts.authorId, 0, digest, volume, JSON.stringify(bbox), faces, JSON.stringify(solid)]
    );
    await client.query(
      `insert into tapes (revision_id, n, operations) values ($1,$2,$3)
       on conflict (revision_id) do nothing`,
      [id, tape.operations.length - 1, JSON.stringify(tape.operations.map(stripSolid))]
    );
    await ctx.outbox(client, "revision", opts.partSlug, null, {
      type: "revision",
      revision: { id, label: `r${label}`, partSlug: opts.partSlug },
      authorDisplayName: null,
      digestChanged: true,
    });
    // Room effects: approvals follow the head's geometry (DP-39).
    const rooms = await client.query(`select id, state, required_approvals from rooms where part_slug = $1 and state <> 'closed'`, [opts.partSlug]);
    for (const room of rooms.rows) {
      const approvals = await client.query(
        `select count(*)::int as n from approvals where room_id = $1 and geometry_digest = $2`,
        [room.id, digest]
      );
      const counted = approvals.rows[0]!.n;
      const newState = counted >= room.required_approvals ? "approved" : "open";
      let reason: "reset" | "carried" | "matched" | null = null;
      if (newState !== room.state) {
        reason = counted > 0 ? "matched" : "reset";
        await client.query(`update rooms set state = $1 where id = $2`, [newState, room.id]);
      } else if (counted > 0) {
        reason = "carried";
      }
      if (reason) {
        const roomJson = await roomJsonOf(client, room.id);
        await ctx.outbox(client, "approvals", opts.partSlug, room.id as string, {
          type: "approvals", room: roomJson, reason, label: `r${label}`, displayName: null,
        });
      }
    }
    await client.query("commit");
    return { id, label, digest };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

function stripSolid(op: { solid?: unknown }): Omit<typeof op, "solid"> {
  const { solid: _solid, ...rest } = op;
  return rest;
}

/** The room JSON inside a revision-write transaction, for the approvals event. */
async function roomJsonOf(tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, roomId: string): Promise<Record<string, unknown>> {
  const room = (await tx.query(`select * from rooms where id = $1`, [roomId])).rows[0]!;
  const head = (await tx.query(`select id, geometry_digest from revisions where part_slug = $1 order by label desc limit 1`, [room.part_slug])).rows[0]!;
  const approvals = (await tx.query(
    `select reviewer_id, revision_id, geometry_digest, at from approvals where room_id = $1 order by at asc, reviewer_id asc`, [roomId]
  )).rows;
  const counted = approvals.filter((a) => a.geometry_digest === head.geometry_digest);
  const reviewers = (await tx.query(
    `select rr.email, rr.user_id, u.display_name from room_reviewers rr left join users u on u.id = rr.user_id where rr.room_id = $1`, [roomId]
  )).rows;
  return {
    id: room.id,
    partSlug: room.part_slug,
    baseRevisionId: null,
    headRevisionId: head.id,
    title: room.title,
    state: room.state,
    requiredApprovals: room.required_approvals,
    approvals: counted.map((a) => ({ reviewerId: a.reviewer_id, revisionId: a.revision_id, geometryDigest: a.geometry_digest, at: a.at })),
    reviewers: reviewers.map((rr) => ({ email: rr.email, userId: rr.user_id, ...(rr.display_name ? { displayName: rr.display_name } : {}) })),
    createdBy: room.created_by,
  };
}

/** The stored solid JSON for a digest: the tape's or the final one. */
function solidFor(digest: string, tapeOps: { digest: string; solid: Solid }[], finalDigest: string, finalSolid: Solid): Solid {
  if (digest === finalDigest) return finalSolid;
  return tapeOps.find((t) => t.digest === digest)?.solid ?? { ops: [] };
}

