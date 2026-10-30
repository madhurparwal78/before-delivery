import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import { loadReleases, releaseToJson, writeSnapshot } from "./roadmap.js";

const KEY_RE = /^[\x20-\x7E]{1,200}$/;

export const shipRoutes: Route[] = [
  {
    pattern: route("releases/:id/freeze"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query<{ status: string; snapshot_version: number | null }>(
          "SELECT status, snapshot_version FROM releases WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        if (row.rows[0]!.status === "shipped") throw errors.releaseShipped();
        if (row.rows[0]!.status !== "open") {
          throw errors.invalidTransition({ from: row.rows[0]!.status, to: "frozen" });
        }
        // The snapshot is written to storage first; only then is the release
        // frozen (DP-25).
        await writeSnapshot(client, workspaceId, id);
        await client.query("UPDATE releases SET status = 'frozen' WHERE id = $1", [id]);
        await audit(client, workspaceId, ctx.member!.id, "freeze_release", "release", id, null);
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
    pattern: route("releases/:id/ship"),
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const key = ctx.req.headers["idempotency-key"];
      const keyHeader = Array.isArray(key) ? key[0] : key;
      if (keyHeader === undefined || !KEY_RE.test(keyHeader)) {
        throw errors.validationFailed({ "Idempotency-Key": "Send an idempotency key." });
      }

      const client = await ctx.pool.connect();
      try {
        // An idempotent replay returns its stored response ahead of any state
        // check (DP-26).
        const replay = await client.query<{
          status_code: number;
          response_body: unknown;
          release_id: string;
        }>(
          `SELECT status_code, response_body, release_id FROM idempotency_records
           WHERE workspace_id = $1 AND idempotency_key = $2`,
          [workspaceId, keyHeader],
        );
        if (replay.rowCount !== 0) {
          const row = replay.rows[0]!;
          if (row.release_id !== id) throw errors.idempotencyKeyReused();
          return {
            status: row.status_code,
            body: row.response_body,
          };
        }

        await client.query("BEGIN");
        const row = await client.query<{
          status: string;
          name: string;
          snapshot_version: number | null;
        }>(
          "SELECT status, name, snapshot_version FROM releases WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        const release = row.rows[0]!;
        if (release.status === "open") {
          throw errors.invalidTransition({ from: "open", to: "shipped" });
        }
        if (release.status === "shipped") throw errors.releaseShipped();

        const scope = await latestScope(client, id, release.snapshot_version);
        const featureIds = scope.features.map((f) => f.id);
        if (featureIds.length > 0) {
          await client.query(
            "UPDATE features SET status = 'released' WHERE id = ANY($1) AND workspace_id = $2",
            [featureIds, workspaceId],
          );
        }
        await client.query("UPDATE releases SET status = 'shipped', shipped_at = now() WHERE id = $1", [
          id,
        ]);

        // One email per distinct requesting contact, content fixed at ship
        // time (DP-27). The board order comes from the release's feature
        // positions at ship time.
        const featureOrder = await client.query<{
          id: string;
          name: string;
          public_description: string;
          release_position: number;
        }>(
          `SELECT id, name, public_description, release_position FROM features
           WHERE id = ANY($1) AND workspace_id = $2
           ORDER BY release_position, created_at`,
          [featureIds, workspaceId],
        );
        const contactRows = await client.query<{
          contact_id: string;
          contact_name: string;
          contact_email: string;
          feature_id: string;
        }>(
          `SELECT DISTINCT ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
                  i.feature_id
           FROM insights i
           JOIN notes n ON n.id = i.note_id
           JOIN contacts ct ON ct.id = n.contact_id
           WHERE i.feature_id = ANY($1) AND i.workspace_id = $2`,
          [featureIds, workspaceId],
        );
        const ws = await client.query<{ name: string }>(
          "SELECT name FROM workspaces WHERE id = $1",
          [workspaceId],
        );
        const workspaceName = ws.rows[0]?.name ?? "";
        const byContact = new Map<
          string,
          { name: string; email: string; featureIds: string[] }
        >();
        for (const row2 of contactRows.rows) {
          const entry = byContact.get(row2.contact_id) ?? {
            name: row2.contact_name,
            email: row2.contact_email,
            featureIds: [],
          };
          entry.featureIds.push(row2.feature_id);
          byContact.set(row2.contact_id, entry);
        }
        for (const entry of byContact.values()) {
          // Board order at ship time, listing only that contact's features.
          const ordered = featureOrder.rows.filter((f) => entry.featureIds.includes(f.id));
          const lines = ordered.map((f) => `${f.name} — ${f.public_description}`);
          const subject = `You asked, we shipped: ${release.name}`;
          const month = scope.targetDate.slice(0, 7);
          const [year, mm] = month.split("-");
          const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ];
          const monthText = `${monthNames[Number.parseInt(mm ?? "1", 10) - 1] ?? ""} ${year}`;
          const textBody =
            `Hi ${entry.name},\n\n` +
            `You asked for these, and they are now live in ${release.name} (${monthText}):\n` +
            `${lines.map((l) => `- ${l}`).join("\n")}\n\n` +
            `— The ${workspaceName} product team\n`;
          const htmlBody =
            `<p>Hi ${escapeText(entry.name)},</p>` +
            `<p>You asked for these, and they are now live in <strong>${escapeText(release.name)}</strong> (${escapeText(monthText)}):</p>` +
            `<ul>${ordered
              .map(
                (f) =>
                  `<li><strong>${escapeText(f.name)}</strong> — ${escapeText(f.public_description)}</li>`,
              )
              .join("")}</ul>` +
            `<p>— The ${escapeText(workspaceName)} product team</p>`;
          await client.query(
            `INSERT INTO outbox (id, workspace_id, release_id, to_email, to_name, subject, text_body, html_body)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              workspaceId,
              id,
              entry.email,
              entry.name,
              subject,
              textBody,
              htmlBody,
            ],
          );
        }
        const emailsQueued = byContact.size;
        await audit(client, workspaceId, ctx.member!.id, "ship_release", "release", id, {
          emailsQueued,
        });
        const releases = await loadReleases(client, workspaceId);
        const found = releases.find((r) => r.id === id);
        if (found === undefined) throw errors.notFound();
        const responseBody = { release: releaseToJson(found), emailsQueued };
        await client.query(
          `INSERT INTO idempotency_records (workspace_id, idempotency_key, release_id, status_code, response_body)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, keyHeader, id, 200, JSON.stringify(responseBody)],
        );
        await client.query("COMMIT");
        return { status: 200, body: responseBody };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

interface ScopeFeature {
  id: string;
  name: string;
  position: number;
}

interface ScopeSnapshot {
  releaseId: string;
  name: string;
  targetDate: string;
  features: ScopeFeature[];
}

async function latestScope(
  client: PoolClient,
  releaseId: string,
  snapshotVersion: number | null,
): Promise<ScopeSnapshot> {
  const row = await client.query<{ name: string; target_date: string }>(
    "SELECT name, target_date::text AS target_date FROM releases WHERE id = $1",
    [releaseId],
  );
  const release = row.rows[0];
  if (release === undefined || snapshotVersion === null) {
    throw errors.invalidTransition({ from: "open", to: "shipped" });
  }
  const features = await client.query<{ id: string; name: string; release_position: number }>(
    `SELECT id, name, release_position FROM features
     WHERE release_id = $1 AND status <> 'archived'
     ORDER BY release_position, created_at`,
    [releaseId],
  );
  return {
    releaseId,
    name: release.name,
    targetDate: release.target_date,
    features: features.rows.map((f) => ({ id: f.id, name: f.name, position: f.release_position })),
  };
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
