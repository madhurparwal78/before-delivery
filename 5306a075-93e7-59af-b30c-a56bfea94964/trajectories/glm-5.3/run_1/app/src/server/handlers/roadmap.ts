import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FeatureStatus, Release, ReleaseStatus, Roadmap } from "../../shared/types.js";
import { errors, NO_SUCH_RECORD } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import { storage } from "../services.js";
import { iso } from "./session.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The month label, for example "March 2027". */
export function monthLabel(month: string): string {
  const [year, mm] = month.split("-");
  const index = Number.parseInt(mm ?? "1", 10);
  return `${MONTH_NAMES[index - 1] ?? ""} ${year}`;
}

interface ReleaseRow {
  id: string;
  name: string;
  target_date: string;
  status: ReleaseStatus;
  is_public: boolean;
  order_version: number;
  snapshot_version: number | null;
  shipped_at: Date | null;
  emails_queued: number;
  emails_sent: number;
}

interface ReleaseWithFeatures extends ReleaseRow {
  features: Array<{ id: string; name: string; status: FeatureStatus; position: number }>;
}

export async function loadReleases(
  client: PoolClient,
  workspaceId: string,
): Promise<ReleaseWithFeatures[]> {
  const releases = await loadReleasesQuery(client, workspaceId);
  const features = await client.query<{
    id: string;
    release_id: string;
    name: string;
    status: FeatureStatus;
    release_position: number;
  }>(
    `SELECT id, release_id, name, status, release_position FROM features
     WHERE workspace_id = $1 AND release_id IS NOT NULL AND status <> 'archived'
     ORDER BY release_position, created_at`,
    [workspaceId],
  );
  const byRelease = new Map<string, Array<{ id: string; release_id: string; name: string; status: FeatureStatus; release_position: number }>>();
  for (const f of features.rows) {
    const list = byRelease.get(f.release_id) ?? [];
    list.push(f);
    byRelease.set(f.release_id, list);
  }
  return releases.map((r) => ({
    ...r,
    features: (byRelease.get(r.id) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      position: f.release_position,
    })),
  }));
}

async function loadReleasesQuery(
  client: PoolClient,
  workspaceId: string
): Promise<ReleaseRow[]> {
  const result = await client.query<ReleaseRow>(
    `SELECT r.id, r.name, r.target_date::text AS target_date, r.status, r.is_public, r.order_version,
            r.snapshot_version, r.shipped_at,
            (SELECT count(*)::int FROM outbox o WHERE o.release_id = r.id) AS emails_queued,
            (SELECT count(*)::int FROM outbox o WHERE o.release_id = r.id AND o.sent_at IS NOT NULL) AS emails_sent
     FROM releases r WHERE r.workspace_id = $1
     ORDER BY r.target_date, r.created_at`,
    [workspaceId],
  );
  return result.rows;
}

export function releaseToJson(r: ReleaseWithFeatures): Release {
  return {
    id: r.id,
    name: r.name,
    targetDate: r.target_date,
    targetMonth: r.target_date.slice(0, 7),
    status: r.status,
    isPublic: r.is_public,
    orderVersion: r.order_version,
    snapshotVersion: r.snapshot_version,
    featureIds: r.features.map((f) => f.id),
    shippedAt: r.shipped_at === null ? null : iso(r.shipped_at),
    emails: { queued: r.emails_queued, sent: r.emails_sent },
  };
}

function isHeadOfProduct(ctx: RequestContext): boolean {
  return ctx.member?.role === "head_of_product";
}

export const roadmapRoutes: Route[] = [
  {
    pattern: route("roadmap"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const client = await ctx.pool.connect();
      try {
        const ws = await client.query<{ time_zone: string }>(
          "SELECT time_zone FROM workspaces WHERE id = $1",
          [workspaceId],
        );
        const releases = await loadReleases(client, workspaceId);
        const unscheduled = await client.query<{ id: string; name: string; status: FeatureStatus }>(
          `SELECT id, name, status FROM features
           WHERE workspace_id = $1 AND release_id IS NULL AND status IN ('planned', 'in_progress')
           ORDER BY created_at`,
          [workspaceId],
        );
        const columnsMap = new Map<string, ReleaseWithFeatures[]>();
        for (const r of releases) {
          const month = r.target_date.slice(0, 7);
          const list = columnsMap.get(month) ?? [];
          list.push(r);
          columnsMap.set(month, list);
        }
        const columns = [...columnsMap.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([month, rels]) => ({
            month,
            label: monthLabel(month),
            releases: rels.map((r) => ({
              ...releaseToJson(r),
              features: r.features.map((f) => ({
                id: f.id,
                name: f.name,
                status: f.status,
                position: f.position,
              })),
            })),
          }));
        const roadmap: Roadmap = {
          timeZone: ws.rows[0]?.time_zone ?? "UTC",
          unscheduled: unscheduled.rows,
          columns,
        };
        return { status: 200, body: roadmap };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("releases"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      const targetDate = typeof ctx.body.targetDate === "string" ? ctx.body.targetDate : "";
      const isPublic = ctx.body.isPublic === true;
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 120) fields.name = "Add a release name.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !isRealDate(targetDate)) {
        fields.targetDate = "Pick a real date.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const id = randomUUID();
      await ctx.pool.query(
        `INSERT INTO releases (id, workspace_id, name, target_date, status, is_public, order_version)
         VALUES ($1, $2, $3, $4, 'open', $5, 1)`,
        [id, workspaceId, name, targetDate, isPublic],
      );
      await audit(ctx.pool, workspaceId, ctx.member!.id, "create_release", "release", id, { name });
      const client = await ctx.pool.connect();
      try {
        const releases = await loadReleases(client, workspaceId);
        const created = releases.find((r) => r.id === id);
        if (created === undefined) throw errors.notFound();
        return { status: 201, body: { release: releaseToJson(created) } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("releases/:id"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const client = await ctx.pool.connect();
      try {
        const releases = await loadReleases(client, ctx.member!.workspaceId);
        const found = releases.find((r) => r.id === ctx.params.id);
        if (found === undefined) throw errors.notFound();
        return { status: 200, body: { release: releaseToJson(found) } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("releases/:id"),
    methods: ["PATCH"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const name = ctx.body.name;
      const targetDate = ctx.body.targetDate;
      const isPublic = ctx.body.isPublic;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query<{ name: string; target_date: string; status: string; is_public: boolean }>(
          "SELECT name, target_date::text AS target_date, status, is_public FROM releases WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        if (row.rows[0]!.status === "shipped") throw errors.releaseShipped();
        const fields: Record<string, string> = {};
        if (name !== undefined) {
          if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) {
            fields.name = "Add a release name.";
          }
        }
        if (targetDate !== undefined) {
          if (typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !isRealDate(targetDate)) {
            fields.targetDate = "Pick a real date.";
          }
        }
        if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
        await client.query(
          `UPDATE releases SET
             name = COALESCE($1, name),
             target_date = COALESCE($2, target_date),
             is_public = COALESCE($3, is_public)
           WHERE id = $4`,
          [
            name === undefined ? null : (name as string).trim(),
            targetDate === undefined ? null : targetDate,
            isPublic === undefined ? null : isPublic === true,
            id,
          ],
        );
        await audit(client, workspaceId, ctx.member!.id, "edit_release", "release", id, null);
        await client.query("COMMIT");
        const releases = await loadReleases(client, workspaceId);
        const found = releases.find((r) => r.id === id);
        if (found === undefined) throw errors.notFound();
        return { status: 200, body: { release: releaseToJson(found) } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("roadmap/moves"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const featureId = typeof ctx.body.featureId === "string" ? ctx.body.featureId : null;
      if (featureId === null) throw errors.validationFailed({ featureId: NO_SUCH_RECORD });
      const toReleaseId =
        ctx.body.toReleaseId === null
          ? null
          : typeof ctx.body.toReleaseId === "string"
            ? ctx.body.toReleaseId
            : null;
      const toIndex = ctx.body.toIndex;
      const expected = ctx.body.expectedOrderVersions;

      const fields: Record<string, string> = {};
      if (toIndex === undefined || !Number.isInteger(toIndex) || (toIndex as number) < 0) {
        fields.toIndex = "Pick a position.";
      }
      if (expected === undefined || expected === null || typeof expected !== "object" || Array.isArray(expected)) {
        fields.expectedOrderVersions = "Name the current order versions.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const feature = await client.query<{
          id: string;
          name: string;
          status: FeatureStatus;
          release_id: string | null;
          release_position: number;
        }>(
          `SELECT id, name, status, release_id, release_position FROM features
           WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [featureId, workspaceId],
        );
        const featureRow = feature.rows[0];
        if (featureRow === undefined) throw errors.validationFailed({ featureId: NO_SUCH_RECORD });

        // Resolve the source and target releases.
        const touchedIds = new Set<string>();
        if (featureRow.release_id !== null) touchedIds.add(featureRow.release_id);
        if (toReleaseId !== null) touchedIds.add(toReleaseId);
        const releases = await client.query<{
          id: string;
          name: string;
          status: ReleaseStatus;
          order_version: number;
          feature_ids: string[];
        }>(
          `SELECT r.id, r.name, r.status, r.order_version,
                  COALESCE(
                    (SELECT array_agg(f.id ORDER BY f.release_position, f.created_at)
                     FROM features f WHERE f.release_id = r.id AND f.status <> 'archived'),
                    '{}'
                  ) AS feature_ids
           FROM releases r WHERE r.workspace_id = $1`,
          [workspaceId],
        );
        const releaseById = new Map(releases.rows.map((r) => [r.id, r]));
        if (toReleaseId !== null && !releaseById.has(toReleaseId)) {
          throw errors.validationFailed({ toReleaseId: NO_SUCH_RECORD });
        }

        // Order versions must be named for every touched release (DP-23).
        const named = expected as Record<string, unknown>;
        for (const releaseId of touchedIds) {
          if (!Number.isInteger(named[releaseId])) {
            throw errors.validationFailed({ expectedOrderVersions: "Name the current order versions." });
          }
        }

        const source = featureRow.release_id === null ? null : releaseById.get(featureRow.release_id);
        const target = toReleaseId === null ? null : releaseById.get(toReleaseId);

        // Roles, release states and statuses in the published precedence
        // (DP-23): a frozen-scope change by a product manager gets 403 even
        // when the versions are outdated.
        const membershipChange = featureRow.release_id !== toReleaseId;
        if (membershipChange && (source?.status === "frozen" || target?.status === "frozen")) {
          if (!isHeadOfProduct(ctx)) throw errors.forbidden();
        }
        if (source?.status === "shipped") throw errors.releaseShipped();
        if (target?.status === "shipped") throw errors.releaseShipped();
        if (toReleaseId !== null && !["planned", "in_progress"].includes(featureRow.status)) {
          throw errors.featureNotPlanned();
        }

        // Version check last, before any write.
        const current = [...touchedIds].map((releaseId) => {
          const r = releaseById.get(releaseId)!;
          return { releaseId: r.id, orderVersion: r.order_version, featureIds: r.feature_ids };
        });
        for (const releaseId of touchedIds) {
          const r = releaseById.get(releaseId)!;
          if ((named[releaseId] as number) !== r.order_version) {
            throw errors.orderConflict(current);
          }
        }

        // toIndex must be from 0 to the target's length after removal.
        if (toReleaseId !== null) {
          const targetIds = target?.feature_ids ?? [];
          const without = targetIds.filter((fid) => fid !== featureId);
          if ((toIndex as number) > without.length) {
            throw errors.validationFailed({ toIndex: "Pick a position in the list." });
          }
        }

        // Apply the move.
        if (toReleaseId === null) {
          // Unscheduled is always in rank order; toIndex is ignored.
          await client.query(
            "UPDATE features SET release_id = NULL, release_position = 0 WHERE id = $1",
            [featureId],
          );
        } else {
          const targetIds = [...(target?.feature_ids ?? [])];
          const without = targetIds.filter((fid) => fid !== featureId);
          without.splice(toIndex as number, 0, featureId);
          for (let i = 0; i < without.length; i++) {
            await client.query(
              "UPDATE features SET release_id = $1, release_position = $2 WHERE id = $3",
              [toReleaseId, i, without[i]],
            );
          }
        }
        // Reindex the source release.
        if (featureRow.release_id !== null && featureRow.release_id !== toReleaseId) {
          const remaining = (source?.feature_ids ?? []).filter((fid) => fid !== featureId);
          for (let i = 0; i < remaining.length; i++) {
            await client.query(
              "UPDATE features SET release_position = $1 WHERE id = $2",
              [i, remaining[i]],
            );
          }
        }
        for (const releaseId of touchedIds) {
          await client.query(
            "UPDATE releases SET order_version = order_version + 1 WHERE id = $1",
            [releaseId],
          );
        }
        // A frozen release's membership change writes the next snapshot (DP-25).
        if (membershipChange) {
          for (const releaseId of touchedIds) {
            const r = releaseById.get(releaseId)!;
            if (r.status === "frozen") {
              await writeSnapshot(client, workspaceId, releaseId);
            }
          }
        }
        await audit(client, workspaceId, ctx.member!.id, "move_feature", "feature", featureId, {
          toReleaseId,
          toIndex,
        });
        await client.query("COMMIT");
        const after = await client.query<{
          id: string;
          order_version: number;
          feature_ids: string[];
        }>(
          `SELECT r.id, r.order_version,
                  COALESCE(
                    (SELECT array_agg(f.id ORDER BY f.release_position, f.created_at)
                     FROM features f WHERE f.release_id = r.id AND f.status <> 'archived'),
                    '{}'
                  ) AS feature_ids
           FROM releases r WHERE r.id = ANY($1)`,
          [[...touchedIds]],
        );
        return {
          status: 200,
          body: {
            releases: after.rows.map((r) => ({
              releaseId: r.id,
              orderVersion: r.order_version,
              featureIds: r.feature_ids,
            })),
          },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map((p) => Number.parseInt(p, 10));
  if (y === undefined || m === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Write the next scope snapshot to storage; false when storage is down. */
export async function writeSnapshot(
  client: PoolClient,
  workspaceId: string,
  releaseId: string,
): Promise<boolean> {
  const row = await client.query<{
    id: string;
    name: string;
    target_date: string;
    snapshot_version: number | null;
  }>(
    "SELECT id, name, target_date::text AS target_date, snapshot_version FROM releases WHERE id = $1 AND workspace_id = $2",
    [releaseId, workspaceId],
  );
  const release = row.rows[0];
  if (release === undefined) throw errors.notFound();
  const features = await client.query<{ id: string; name: string; release_position: number }>(
    `SELECT id, name, release_position FROM features
     WHERE release_id = $1 AND status <> 'archived'
     ORDER BY release_position, created_at`,
    [releaseId],
  );
  const nextVersion = (release.snapshot_version ?? 0) + 1;
  const payload = {
    releaseId: release.id,
    name: release.name,
    targetDate: release.target_date,
    snapshotVersion: nextVersion,
    frozenAt: iso(new Date()),
    features: features.rows.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.release_position,
    })),
  };
  const key = `releases/${releaseId}/scope-v${nextVersion}.json`;
  const ok = await storage.put(key, Buffer.from(JSON.stringify(payload), "utf-8"), "application/json");
  if (!ok) throw errors.storageUnavailable();
  await client.query(
    "UPDATE releases SET snapshot_version = $1 WHERE id = $2",
    [nextVersion, releaseId],
  );
  return true;
}
