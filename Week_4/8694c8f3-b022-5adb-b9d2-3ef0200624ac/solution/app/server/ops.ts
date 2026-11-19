import type { PoolClient } from "pg";
import { recordActivity } from "./activity.ts";
import type { Membership } from "./access.ts";
import { CAN_EDIT, requireMember, requireRole } from "./access.ts";
import type { AccountRow } from "./accounts.ts";
import { CollabOffline } from "./collab.ts";
import type { Collab } from "./collab.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import { insertShaderVersion, loadDocument, persistEffects } from "./documents.ts";
import { ApiError, notFound, validation, writeJson } from "./errors.ts";
import { leaseExpiry } from "../shared/collab.ts";
import type { EventHub } from "./events.ts";
import { openStream } from "./events.ts";
import type { Router } from "./http.ts";
import { integerParam, parsedJson, requireUser } from "./http.ts";
import {
  applyOp, Invalid, isTargetTaken, needsBaseVersion, resolveTarget, stateOf, targetSuits, versionOf,
} from "../shared/ops.ts";
import type { OpEnv } from "../shared/ops.ts";
import { anyRecord, num, object, oneOf, optional, str } from "../shared/schema.ts";
import type { AssetKind, AssetStatus, CommitResult, OpDocument, OpInput, OpType, Person } from "../shared/types.ts";
import { OP_TYPES } from "../shared/types.ts";

const envelopeSchema = object({
  client_op_id: str({ min: 8, max: 64, message: "Client op id must be 8 to 64 characters" }),
  target: str({ min: 1, max: 64, message: "Target is required" }),
  type: oneOf(OP_TYPES, "Unknown op type"),
  base_version: optional(num({ min: 0, integer: true, message: "Base version must be a whole number" })),
  payload: anyRecord("Payload must be an object"),
});

interface StoredOp {
  seq: number;
  target: string;
  type: OpType;
  base_version: number | null;
  payload: Record<string, unknown>;
  response: CommitResult;
}

interface OpRow {
  seq: number;
  client_op_id: string;
  user_id: string;
  display_name: string;
  target: string;
  type: OpType;
  payload: Record<string, unknown>;
  committed_at: Date;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const opDocument = (row: OpRow): OpDocument => ({
  seq: row.seq,
  client_op_id: row.client_op_id,
  actor: { user_id: row.user_id, display_name: row.display_name },
  target: row.target,
  type: row.type,
  payload: row.payload,
  committed_at: row.committed_at.toISOString(),
});

const OP_SELECT = `SELECT o.seq, o.client_op_id, u.id AS user_id, u.display_name, o.target, o.type, o.payload, o.committed_at
                   FROM ops o JOIN users u ON u.id = o.actor_id`;

interface Committed {
  response: CommitResult;
  document: OpDocument | null;
  freedLocks: string[];
}

export class OpLog {
  private readonly db: Database;
  private readonly collab: Collab;
  private readonly hub: EventHub;

  constructor(db: Database, collab: Collab, hub: EventHub) {
    this.db = db;
    this.collab = collab;
    this.hub = hub;
  }

  private async changedBy(tx: PoolClient, setId: string, target: string): Promise<Person> {
    const [latest] = await rows<{ user_id: string; display_name: string }>(
      tx,
      `SELECT u.id AS user_id, u.display_name FROM ops o JOIN users u ON u.id = o.actor_id
       WHERE o.set_id = $1 AND o.target = $2 ORDER BY o.seq DESC LIMIT 1`,
      [setId, target],
    );
    return latest ?? { user_id: "", display_name: "Someone" };
  }

  private async assertNoForeignLock(setId: string, target: string, actorId: string): Promise<void> {
    try {
      const held = await this.collab.lockState(setId, target);
      if (held && held.holderId !== actorId) {
        const [holder] = await rows<{ user_id: string; display_name: string }>(this.db, 
          "SELECT id AS user_id, display_name FROM users WHERE id = $1", [held.holderId],
        );
        throw new ApiError(423, "layer_locked", `This layer is locked by ${holder?.display_name ?? "someone"}`, {
          holder, expires_at: leaseExpiry(held.leaseMs),
        });
      }
    } catch (error) {
      if (!(error instanceof CollabOffline)) throw error;
    }
  }

  private async loadEnvironment(tx: PoolClient, setId: string, op: OpInput): Promise<OpEnv> {
    const assets = await rows<{ id: string; kind: AssetKind; status: AssetStatus }>(
      tx, "SELECT id, kind, status FROM assets WHERE set_id = $1", [setId],
    );
    const sources = new Map<string, string>();
    const from = op.payload["from_version"];
    if (op.type === "shader.restore" && typeof from === "number" && Number.isInteger(from)) {
      const [version] = await rows<{ source: string }>(
        tx, "SELECT source FROM shader_versions WHERE layer_id = $1 AND number = $2", [op.target, from],
      );
      if (version) sources.set(`${op.target}:${from}`, version.source);
    }
    return {
      assets: new Map(assets.map((asset) => [asset.id, { kind: asset.kind, status: asset.status }])),
      shaderSource: (layerId, number) => sources.get(`${layerId}:${number}`),
    };
  }

  /** The one transaction that allocates a sequence number, applies an op, bumps its target's version and logs it. */
  async commit(membership: Membership, actor: AccountRow, clientOpId: string, baseVersion: number | undefined, op: OpInput): Promise<Committed> {
    const committed = await this.db.transaction(async (tx): Promise<Committed> => {
      const doc = await loadDocument(tx, membership.setId, membership.role, true);
      const [previous] = await rows<StoredOp>(
        tx, "SELECT seq, target, type, base_version, payload, response FROM ops WHERE set_id = $1 AND client_op_id = $2",
        [membership.setId, clientOpId],
      );
      if (previous) {
        const same = previous.target === op.target && previous.type === op.type && (previous.base_version ?? undefined) === baseVersion
          && canonical(previous.payload) === canonical(op.payload);
        if (!same) throw new ApiError(409, "op_id_reused", "This client op id was used for a different op");
        return { response: { ...previous.response, replayed: true }, document: null, freedLocks: [] };
      }
      const target = resolveTarget(doc, op);
      if (needsBaseVersion(op.type) && !target) throw notFound();
      if (target?.kind === "layer") await this.assertNoForeignLock(membership.setId, op.target, actor.id);
      if (isTargetTaken(doc, op)) throw new ApiError(409, "id_taken", "That id is already used by another layer or script");
      if (needsBaseVersion(op.type) && target) {
        const currentVersion = versionOf(doc, target);
        if (baseVersion === undefined) throw validation({ base_version: "Base version is required" });
        if (baseVersion < currentVersion) {
          throw new ApiError(409, "stale_version", "Someone changed this first", {
            current_version: currentVersion,
            current: stateOf(doc, target),
            changed_by: await this.changedBy(tx, membership.setId, op.target),
          });
        }
        if (baseVersion > currentVersion) throw validation({ base_version: "Base version is newer than the current version" });
      }
      if (!targetSuits(op)) throw validation({ target: "This op does not apply to that target" });
      const env = await this.loadEnvironment(tx, membership.setId, op);
      let effects;
      try {
        effects = applyOp(doc, op, env);
      } catch (error) {
        if (error instanceof Invalid) throw validation(error.fields);
        throw error;
      }
      const seq = doc.set.head + 1;
      await persistEffects(tx, doc, effects);
      if (effects.shaderSave) {
        const { layer_id: layerId, number, source, restored_from: restoredFrom } = effects.shaderSave;
        await insertShaderVersion(tx, { layerId, setId: membership.setId, number, source: source ?? "", authorId: actor.id, restoredFrom });
      }
      const response: CommitResult = { seq, target: op.target, version: effects.version, replayed: false };
      const [written] = await rows<OpRow>(
        tx,
        `WITH inserted AS (
           INSERT INTO ops (set_id, seq, client_op_id, actor_id, target, type, base_version, payload, response)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
         ) SELECT i.seq, i.client_op_id, u.id AS user_id, u.display_name, i.target, i.type, i.payload, i.committed_at
           FROM inserted i JOIN users u ON u.id = i.actor_id`,
        [membership.setId, seq, clientOpId, actor.id, op.target, op.type, baseVersion ?? null, JSON.stringify(op.payload), JSON.stringify(response)],
      );
      await tx.query("UPDATE sets SET head = $2 WHERE id = $1", [membership.setId, seq]);
      await recordActivity(tx, membership.setId, actor.id, op.type, op.target, effects.summary);
      return { response, document: written ? opDocument(written) : null, freedLocks: effects.freedLocks };
    });
    if (committed.document) {
      await this.hub.publish(membership.setId, { kind: "op", data: committed.document });
      await this.releaseRemovedLocks(membership.setId, actor.id, committed.freedLocks);
    }
    return committed;
  }

  private async releaseRemovedLocks(setId: string, actorId: string, layerIds: string[]): Promise<void> {
    for (const layerId of layerIds) {
      try {
        const freed = await this.collab.releaseLock(setId, layerId, actorId, true);
        if (freed.result === "released") {
          await this.hub.publish(setId, { kind: "lock", data: { layer_id: layerId, holder: null, expires_at: null, reason: "released" } });
        }
      } catch (error) {
        if (!(error instanceof CollabOffline)) throw error;
      }
    }
  }

  async since(setId: string, after: number, limit: number): Promise<OpDocument[]> {
    const found = await rows<OpRow>(this.db, `${OP_SELECT} WHERE o.set_id = $1 AND o.seq > $2 ORDER BY o.seq LIMIT $3`, [setId, after, limit]);
    return found.map(opDocument);
  }

  register(router: Router): void {
    router.add("POST", "/api/sets/:id/ops", { body: "json" }, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, CAN_EDIT);
      const envelope = parsedJson(ctx, envelopeSchema);
      const op: OpInput = { type: envelope.type, target: envelope.target, payload: envelope.payload };
      const { response } = await this.commit(membership, requireUser(ctx), envelope.client_op_id, envelope.base_version, op);
      writeJson(ctx.res, 200, response);
    });

    router.add("GET", "/api/sets/:id/ops", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const after = integerParam(ctx.url, "after") ?? 0;
      const limit = integerParam(ctx.url, "limit") ?? 500;
      if (integerParam(ctx.url, "after") === null) throw validation({ after: "After must be a whole number" });
      if (limit === null || limit < 1 || limit > 500) throw validation({ limit: "Limit must be from 1 to 500" });
      const [set] = await rows<{ head: number }>(this.db, "SELECT head FROM sets WHERE id = $1", [membership.setId]);
      writeJson(ctx.res, 200, { ops: await this.since(membership.setId, after, limit), head: set?.head ?? 0 });
    });

    router.add("GET", "/api/sets/:id/events", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const lastEventId = Number(ctx.req.headers["last-event-id"]);
      let cursor = Number.isInteger(lastEventId) && lastEventId > 0 ? lastEventId : (integerParam(ctx.url, "after") ?? 0);
      const stream = openStream(ctx.res);
      const backlog: OpDocument[] = [];
      let replaying = true;
      const forward = (document: OpDocument): void => {
        if (document.seq <= cursor) return;
        cursor = document.seq;
        stream.send("op", document, document.seq);
      };
      const stop = this.hub.listen(membership.setId, (event) => {
        if (event.kind === "op") {
          if (replaying) backlog.push(event.data);
          else forward(event.data);
        } else {
          stream.send(event.kind, event.data);
        }
      });
      ctx.req.on("close", () => {
        stop();
        stream.close();
      });
      for (const document of await this.since(membership.setId, cursor, 500)) forward(document);
      for (const document of backlog.sort((a, b) => a.seq - b.seq)) forward(document);
      replaying = false;
    });
  }
}
