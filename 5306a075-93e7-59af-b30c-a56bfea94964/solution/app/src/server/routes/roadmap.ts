import type { BoardRelease, ReleaseOrder, Roadmap } from "../../shared/api.js";
import { canJoinRelease, RELEASABLE, releaseIsLocked, releaseTransition, type FeatureStatus, type ReleaseStatus } from "../../shared/lifecycles.js";
import { monthLabel, monthOf } from "../../shared/months.js";
import { db, type Queryable } from "../db.js";
import { applyMove, maxIndex, scopeChangeAllowed, writeScopeSnapshot, type BoardList } from "../domain/board.js";
import { youAskedWeShipped } from "../domain/emails.js";
import { loadFeatures } from "../domain/features.js";
import { ApiError, conflict, forbidden, invalid, notFound, storageUnavailable } from "../http/errors.js";
import { ANY, H, HP, member, type MemberCtx, type Router } from "../http/router.js";
import { asObject, Fields } from "../http/validate.js";
import { StorageUnavailable } from "../services/storage.js";
import { kick } from "../services/workers.js";
import { audit, loadRelease, releaseRows, toRelease, type ReleaseRow } from "./records.js";

const RELEASE_NAME = { min: 1, max: 120, message: "Add a release name." };

async function releaseOf(ctx: MemberCtx): Promise<ReleaseRow> {
  const [row] = await releaseRows(db, ctx.session.workspace.id, ctx.params.id ?? "");
  if (!row) throw notFound();
  return row;
}

const shipped = (name: string) => conflict("release_shipped", `${name} has shipped and can't change.`);

async function lockedList(tx: Queryable, id: string): Promise<BoardList & { name: string; targetDate: string; snapshotVersion: number | null }> {
  const [row] = await tx.query<{ id: string; name: string; target_date: string; status: ReleaseStatus; order_version: number; snapshot_version: number | null }>(
    "SELECT id, name, target_date, status, order_version, snapshot_version FROM releases WHERE id = $1 FOR UPDATE",
    [id],
  );
  if (!row) throw notFound();
  const members = await tx.query<{ id: string }>("SELECT id FROM features WHERE release_id = $1 ORDER BY position", [id]);
  return {
    id: row.id, name: row.name, targetDate: row.target_date, status: row.status, orderVersion: row.order_version,
    snapshotVersion: row.snapshot_version, featureIds: members.map((m) => m.id),
  };
}

const orderOf = (list: BoardList): ReleaseOrder => ({ releaseId: list.id, orderVersion: list.orderVersion, featureIds: list.featureIds });

/** Writes a release's scope snapshot or answers 503, so the release never reports a scope storage did not confirm. */
async function snapshot(list: { id: string; name: string; targetDate: string }, version: number, ids: string[], names: Map<string, string>): Promise<void> {
  try {
    await writeScopeSnapshot(list, version, ids.map((id) => ({ id, name: names.get(id) ?? "" })));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable();
    throw error;
  }
}

function releaseFields(fields: Fields, existing: ReleaseRow | null): { name: string; targetDate: string; isPublic: boolean } {
  return {
    name: existing && !fields.has("name") ? existing.name : fields.text("name", RELEASE_NAME),
    targetDate: existing && !fields.has("targetDate") ? existing.target_date : fields.date("targetDate", "Pick a target date."),
    isPublic: existing && !fields.has("isPublic") ? existing.is_public : fields.boolean("isPublic", "Choose public or internal."),
  };
}

export function roadmapRoutes(router: Router): void {
  router.add("/api/roadmap", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace;
        const features = await loadFeatures(db, ws.id);
        const columns = new Map<string, BoardRelease[]>();
        for (const row of await releaseRows(db, ws.id)) {
          const release = toRelease(row);
          const board: BoardRelease = {
            ...release,
            features: release.featureIds.map((id, i) => {
              const f = features.summary(id);
              return { id, name: f.name, status: f.status, position: i + 1 };
            }),
          };
          columns.set(release.targetMonth, [...(columns.get(release.targetMonth) ?? []), board]);
        }
        const roadmap: Roadmap = {
          timeZone: ws.timeZone,
          unscheduled: features.ranked
            .filter((f) => f.releaseId === null && canJoinRelease(f.status))
            .map((f) => ({ id: f.id, name: f.name, status: f.status })),
          columns: [...columns.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, releases]) => ({ month, label: monthLabel(month), releases })),
        };
        return { status: 200, json: roadmap };
      },
    }),
  });

  router.add("/api/releases", {
    POST: member({
      roles: H,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const values = releaseFields(fields, null);
        fields.check();
        const [row] = await db.query<{ id: string }>(
          "INSERT INTO releases (workspace_id, name, target_date, is_public, status) VALUES ($1, $2, $3, $4, 'open') RETURNING id",
          [ws, values.name, values.targetDate, values.isPublic],
        );
        await audit(db, ctx, ws, "release.created", row.id, values);
        return { status: 201, json: { release: await loadRelease(db, ws, row.id) } };
      },
    }),
  });

  router.add("/api/releases/:id", {
    GET: member({ roles: ANY, load: releaseOf, handle: async (_ctx, row) => ({ status: 200, json: { release: toRelease(row) } }) }),
    PATCH: member({
      roles: H,
      load: releaseOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        await db.transaction(async (tx) => {
          const list = await lockedList(tx, row.id);
          if (releaseIsLocked(list.status)) throw shipped(list.name);
          const fields = new Fields(ctx.body);
          const values = releaseFields(fields, row);
          fields.check();
          await tx.query("UPDATE releases SET name = $2, target_date = $3, is_public = $4 WHERE id = $1", [row.id, values.name, values.targetDate, values.isPublic]);
          await audit(tx, ctx, ws, "release.updated", row.id, values);
        });
        return { status: 200, json: { release: await loadRelease(db, ws, row.id) } };
      },
    }),
  });

  router.add("/api/roadmap/moves", {
    POST: member({
      roles: HP,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const role = ctx.session.member.role;
        const fields = new Fields(ctx.body);
        const topLevel = new Set((await db.query<{ id: string }>(
          "SELECT id FROM features WHERE workspace_id = $1 AND parent_feature_id IS NULL", [ws],
        )).map((f) => f.id));
        const releases = new Set((await db.query<{ id: string }>("SELECT id FROM releases WHERE workspace_id = $1", [ws])).map((r) => r.id));
        const featureId = fields.id("featureId", (id) => topLevel.has(id));
        const toReleaseId = fields.raw("toReleaseId") === null || fields.raw("toReleaseId") === undefined ? null : fields.id("toReleaseId", (id) => releases.has(id));
        fields.check();
        const lists = await db.transaction(async (tx) => {
          const [locked] = await tx.query<{ status: FeatureStatus; release_id: string | null }>(
            "SELECT status, release_id FROM features WHERE id = $1 FOR UPDATE", [featureId],
          );
          const sourceId = locked.release_id;
          const ids = [...new Set([sourceId, toReleaseId].filter((id): id is string => id !== null))].sort();
          const touched = new Map<string, Awaited<ReturnType<typeof lockedList>>>();
          for (const id of ids) touched.set(id, await lockedList(tx, id));
          const source = sourceId === null ? null : touched.get(sourceId) ?? null;
          const target = toReleaseId === null ? null : touched.get(toReleaseId) ?? null;
          if (!scopeChangeAllowed(role, source, target)) throw forbidden("Only a head of product can change a frozen release's scope.");
          for (const list of touched.values()) if (releaseIsLocked(list.status)) throw shipped(list.name);
          const expected = asObject(ctx.body.expectedOrderVersions);
          const stale = [...touched.values()].some((list) => {
            const version = expected?.[list.id];
            return typeof version === "number" && Number.isInteger(version) && version !== list.orderVersion;
          });
          if (stale) {
            throw conflict("order_conflict", "The board changed while you were moving this feature.", { current: [...touched.values()].map(orderOf) });
          }
          if (target && !canJoinRelease(locked.status)) {
            throw conflict("feature_not_planned", "Plan this feature before it joins a release.");
          }
          if (expected === null || [...touched.values()].some((list) => !Number.isInteger(expected[list.id]))) {
            fields.fail("expectedOrderVersions", "Send the current order version of every release this move touches.");
          }
          const toIndex = target ? fields.integer("toIndex", 0, maxIndex(featureId, target), "Drop the feature inside the list.") : 0;
          fields.check();
          const after = applyMove(featureId, source, target, toIndex);
          const membershipChanged = source?.id !== target?.id;
          const names = new Map([...(await loadFeatures(tx, ws)).summaries.values()].map((f) => [f.id, f.name]));
          for (const list of after) {
            let snapshotVersion = list.snapshotVersion;
            if (membershipChanged && list.status === "frozen") {
              snapshotVersion = (snapshotVersion ?? 0) + 1;
              await snapshot(list, snapshotVersion, list.featureIds, names);
            }
            await tx.query("UPDATE releases SET order_version = $2, snapshot_version = $3 WHERE id = $1", [list.id, list.orderVersion, snapshotVersion]);
            for (const [i, id] of list.featureIds.entries()) await tx.query("UPDATE features SET release_id = $2, position = $3 WHERE id = $1", [id, list.id, i]);
          }
          if (target === null) await tx.query("UPDATE features SET release_id = NULL, position = NULL WHERE id = $1", [featureId]);
          await audit(tx, ctx, ws, "roadmap.moved", featureId, { from: sourceId, to: toReleaseId, toIndex });
          return after;
        });
        return { status: 200, json: { releases: lists.map(orderOf) } };
      },
    }),
  });

  router.add("/api/releases/:id/freeze", {
    POST: member({
      roles: H,
      load: releaseOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        await db.transaction(async (tx) => {
          const list = await lockedList(tx, row.id);
          if (releaseIsLocked(list.status)) throw shipped(list.name);
          if (releaseTransition(list.status, "freeze") === null) throw conflict("invalid_transition", `${list.name} is already frozen.`);
          const names = new Map([...(await loadFeatures(tx, ws)).summaries.values()].map((f) => [f.id, f.name]));
          await snapshot(list, 1, list.featureIds, names);
          await tx.query("UPDATE releases SET status = 'frozen', snapshot_version = 1 WHERE id = $1", [row.id]);
          await audit(tx, ctx, ws, "release.frozen", row.id, { features: list.featureIds });
        });
        return { status: 200, json: { release: await loadRelease(db, ws, row.id) } };
      },
    }),
  });

  router.add("/api/releases/:id/ship", {
    POST: member({
      roles: H,
      load: releaseOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace;
        const header = ctx.req.headers["idempotency-key"];
        const key = typeof header === "string" && /^[\x20-\x7e]{1,200}$/.test(header) ? header : null;
        const reply = await db.transaction(async (tx) => {
          const list = await lockedList(tx, row.id);
          const [stored] = key === null ? [] : await tx.query<{ release_id: string; status_code: number; body: unknown }>(
            "SELECT release_id, status_code, body FROM idempotency_keys WHERE workspace_id = $1 AND key = $2", [ws.id, key],
          );
          if (stored && stored.release_id === row.id) return { status: stored.status_code, json: stored.body };
          if (releaseIsLocked(list.status)) throw shipped(list.name);
          if (releaseTransition(list.status, "ship") === null) throw conflict("invalid_transition", `Freeze ${list.name} before shipping it.`);
          if (key === null) throw invalid({ "Idempotency-Key": "Send an Idempotency-Key of 1 to 200 printable characters." });
          if (stored) throw new ApiError(422, "idempotency_key_reused", "This Idempotency-Key was already used for another release.");
          await tx.query("UPDATE features SET status = 'released' WHERE release_id = $1 AND status = ANY($2::text[])", [row.id, RELEASABLE]);
          await tx.query("UPDATE releases SET status = 'shipped', shipped_at = now_s() WHERE id = $1", [row.id]);
          const features = await loadFeatures(tx, ws.id);
          const requests = await tx.query<{ contact_id: string; name: string; email: string; feature_ids: string[] }>(
            `SELECT c.id AS contact_id, c.name, c.email, json_agg(DISTINCT i.feature_id) AS feature_ids
               FROM insights i JOIN notes n ON n.id = i.note_id JOIN contacts c ON c.id = n.contact_id
              WHERE i.feature_id IN (SELECT id FROM features WHERE release_id = $1)
              GROUP BY c.id, c.name, c.email ORDER BY c.id`,
            [row.id],
          );
          for (const request of requests) {
            const asked = list.featureIds.filter((id) => request.feature_ids.includes(id)).map((id) => features.summary(id));
            const email = youAskedWeShipped({
              contactName: request.name, workspaceName: ws.name, releaseName: list.name, targetMonth: monthOf(list.targetDate),
              features: asked.map((f) => ({ name: f.name, publicDescription: f.publicDescription })),
            });
            await tx.query(
              "INSERT INTO outbox (workspace_id, release_id, recipient_name, recipient_email, subject, text_body, html_body) VALUES ($1, $2, $3, $4, $5, $6, $7)",
              [ws.id, row.id, request.name, request.email, email.subject, email.text, email.html],
            );
          }
          const body = { release: await loadRelease(tx, ws.id, row.id), emailsQueued: requests.length };
          await tx.query("INSERT INTO idempotency_keys (workspace_id, key, release_id, status_code, body) VALUES ($1, $2, $3, 200, $4)", [ws.id, key, row.id, body]);
          await audit(tx, ctx, ws.id, "release.shipped", row.id, { emailsQueued: requests.length, features: list.featureIds });
          return { status: 200, json: body };
        });
        kick("outbox");
        return reply;
      },
    }),
  });
}
