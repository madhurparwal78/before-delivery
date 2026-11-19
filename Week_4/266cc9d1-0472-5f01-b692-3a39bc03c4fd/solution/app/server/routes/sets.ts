// Findings sets: create, read, submit, close, revise, the review-link actions and the evidence pack.
import { firstRow, newId, type Db } from "../db.js";
import { loadCorridor, type CorridorRecord } from "../domain/corridor.js";
import { reviewLinkEmail } from "../domain/emails.js";
import { buildEvidence, evidenceKey } from "../domain/evidence.js";
import { deriveFinding, findingsOf } from "../domain/finding.js";
import {
  latestLink,
  linkJson,
  loadSet,
  setJson,
  transition,
  type LinkRow,
  type SetRow,
} from "../domain/findingsSet.js";
import { expiryFrom, linkStatus, linkUrl, mintToken } from "../domain/reviewLink.js";
import { frozenCounts } from "../../shared/findingsSetRules.js";
import { fail } from "../http/errors.js";
import { json, noInput, staffRoute, type Reply, type Route, type StaffContext } from "../http/pipeline.js";
import { monitor } from "../monitor.js";
import { deliverRecorded, recordEmail } from "../outbox.js";
import { getObject, putObject, sha256Hex } from "../storage.js";

interface Loaded {
  set: SetRow;
  corridor: CorridorRecord;
}

async function loadLocked(ctx: StaffContext): Promise<Loaded> {
  const set = await loadSet(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", true);
  return { set, corridor: await loadCorridor(ctx.db, ctx.staff.tenantId, set.corridor_id) };
}

/** Mints a link for the set and records its email; returns the outbox id to attempt after commit. */
async function mintLink(db: Db, set: SetRow, corridor: CorridorRecord, frozen: { finding_count: number; violation_count: number }): Promise<{ link: LinkRow; emailId: number }> {
  const mintedAt = new Date();
  const token = mintToken();
  const found = await db.query<LinkRow>(
    `INSERT INTO review_links (id, set_id, token, minted_at, expires_at) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, set_id, token, expires_at, revoked_at`,
    [newId("lnk"), set.id, token, mintedAt, expiryFrom(mintedAt)],
  );
  const link = firstRow(found);
  const emailId = await linkEmail(db, link, set, corridor, frozen);
  return { link, emailId };
}

function linkEmail(db: Db, link: LinkRow, set: SetRow, corridor: CorridorRecord, frozen: { finding_count: number; violation_count: number }): Promise<number> {
  return recordEmail(db, reviewLinkEmail(corridor, set.revision, linkUrl(link.token), link.expires_at, frozen), link.id);
}

function frozenOf(set: SetRow): { finding_count: number; violation_count: number } {
  return { finding_count: set.frozen_finding_count ?? 0, violation_count: set.frozen_violation_count ?? 0 };
}

function requireLiveLink(link: LinkRow | null): LinkRow {
  if (link === null || linkStatus(link) !== "live") throw fail.conflict("link_not_live", "This review link is not live.");
  return link;
}

/** After commit: attempt the email, then answer with the link as it now stands. */
function afterEmail(db: Db, status: number, emailId: number, link: LinkRow, extra: () => Promise<Record<string, unknown>>) {
  return {
    afterCommit: async (): Promise<Reply> => {
      const email = await deliverRecorded(emailId);
      return json(status, { ...(await extra()), review_link: await linkJson(db, link), email });
    },
  };
}

export const setRoutes: Route[] = [
  staffRoute({
    method: "POST",
    path: "/api/corridors/:id/findings-sets",
    role: "vegetation_analyst",
    load: (ctx) => loadCorridor(ctx.db, ctx.staff.tenantId, ctx.params.id ?? ""),
    validate: noInput,
    perform: async (ctx, corridor) => {
      const id = newId("set");
      // The partial unique index (one set that is not closed per corridor) decides; a refused insert is the 409.
      const inserted = await ctx.db.query(
        `INSERT INTO findings_sets (id, corridor_id, revision, state, created_by) VALUES ($1, $2, 1, 'draft', $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [id, corridor.id, ctx.staff.id],
      );
      if (inserted.rowCount !== 1) throw fail.conflict("open_set_exists", "This corridor already has a findings set that is not closed.");
      const set = await loadSet(ctx.db, ctx.staff.tenantId, id, false);
      return json(201, { set: await setJson(ctx.db, set, true) });
    },
  }),

  staffRoute({
    method: "GET",
    path: "/api/findings-sets/:id",
    load: async (ctx) => {
      const set = await loadSet(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", false);
      return { set, corridor: await loadCorridor(ctx.db, ctx.staff.tenantId, set.corridor_id) };
    },
    validate: noInput,
    perform: async (ctx, { set, corridor }) =>
      json(200, {
        set: await setJson(ctx.db, set, true),
        findings: (await findingsOf(ctx.db, set.id)).map((f) => deriveFinding(f, corridor)),
      }),
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/submit",
    role: "vegetation_analyst",
    idempotent: true,
    load: async (ctx) => {
      const loaded = await loadLocked(ctx);
      return { ...loaded, findings: (await findingsOf(ctx.db, loaded.set.id)).map((f) => deriveFinding(f, loaded.corridor)) };
    },
    conflict: (_ctx, { set }) => {
      transition(set.state, "submit");
    },
    validate: (_ctx, { findings }) => {
      if (findings.length === 0) throw fail.validation({ findings: "Add at least one finding before submitting." });
    },
    perform: async (ctx, { set, corridor, findings }) => {
      if (!monitor.storageOk()) throw fail.storageUnavailable();
      const submittedAt = new Date();
      const frozen = frozenCounts(findings.map((f) => f.status));
      const pack = await buildEvidence(ctx.db, { id: set.id, corridorId: corridor.id, revision: set.revision, submittedAt }, frozen, findings);
      await putObject(evidenceKey(corridor.tenantId, corridor.id, set.id), pack, sha256Hex(pack), "application/json");
      await ctx.db.query(
        `UPDATE findings_sets SET state = $2, submitted_at = $3, submitted_by = $4,
                frozen_finding_count = $5, frozen_violation_count = $6 WHERE id = $1`,
        [set.id, transition(set.state, "submit"), submittedAt, ctx.staff.id, frozen.finding_count, frozen.violation_count],
      );
      const { link, emailId } = await mintLink(ctx.db, set, corridor, frozen);
      return afterEmail(ctx.db, 200, emailId, link, async () => ({ set: await setJson(ctx.db, await loadSet(ctx.db, set.tenant_id, set.id, false), true) }));
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/close",
    role: "vegetation_analyst",
    load: loadLocked,
    conflict: (_ctx, { set }) => {
      transition(set.state, "close");
    },
    validate: noInput,
    perform: async (ctx, { set }) => {
      await ctx.db.query("UPDATE findings_sets SET state = $2 WHERE id = $1", [set.id, transition(set.state, "close")]);
      return json(200, { set: await setJson(ctx.db, await loadSet(ctx.db, set.tenant_id, set.id, false), true) });
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/revisions",
    role: "vegetation_analyst",
    load: loadLocked,
    conflict: (_ctx, { set }) => {
      transition(set.state, "revise");
    },
    validate: noInput,
    perform: async (ctx, { set }) => {
      await ctx.db.query("UPDATE findings_sets SET state = $2 WHERE id = $1", [set.id, transition(set.state, "revise")]);
      const id = newId("set");
      await ctx.db.query(
        `INSERT INTO findings_sets (id, corridor_id, revision, state, previous_set_id, created_by, last_label_number)
         SELECT $1, corridor_id, revision + 1, 'draft', id, $3, last_label_number FROM findings_sets WHERE id = $2`,
        [id, set.id, ctx.staff.id],
      );
      for (const finding of await findingsOf(ctx.db, set.id)) {
        await ctx.db.query(
          `INSERT INTO findings (id, set_id, label_number, chainage_m, offset_m, lon_deg, lat_deg, ground_height_m,
                                 terrain_level, canopy_height_m, canopy_radius_m, comment)
           SELECT $1, $2, label_number, chainage_m, offset_m, lon_deg, lat_deg, ground_height_m,
                  terrain_level, canopy_height_m, canopy_radius_m, comment FROM findings WHERE id = $3`,
          [newId("fnd"), id, finding.id],
        );
      }
      const created = await loadSet(ctx.db, ctx.staff.tenantId, id, false);
      return json(201, { set: await setJson(ctx.db, created, true) });
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/review-link/resend",
    role: "vegetation_analyst",
    idempotent: true,
    load: async (ctx) => {
      const loaded = await loadLocked(ctx);
      return { ...loaded, link: await latestLink(ctx.db, loaded.set.id) };
    },
    conflict: (_ctx, { link }) => {
      requireLiveLink(link);
    },
    validate: noInput,
    perform: async (ctx, { set, corridor, link }) => {
      const live = requireLiveLink(link);
      const emailId = await linkEmail(ctx.db, live, set, corridor, frozenOf(set));
      return afterEmail(ctx.db, 200, emailId, live, async () => ({}));
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/review-link/revoke",
    role: "vegetation_analyst",
    load: async (ctx) => {
      const loaded = await loadLocked(ctx);
      return { ...loaded, link: await latestLink(ctx.db, loaded.set.id) };
    },
    conflict: (_ctx, { link }) => {
      requireLiveLink(link);
    },
    validate: noInput,
    perform: async (ctx, { link }) => {
      const live = requireLiveLink(link);
      const revoked = await ctx.db.query<LinkRow>(
        "UPDATE review_links SET revoked_at = clock_timestamp() WHERE id = $1 RETURNING id, set_id, token, expires_at, revoked_at",
        [live.id],
      );
      return json(200, { review_link: await linkJson(ctx.db, firstRow(revoked)) });
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/review-link/regenerate",
    role: "vegetation_analyst",
    idempotent: true,
    load: async (ctx) => {
      const loaded = await loadLocked(ctx);
      return { ...loaded, link: await latestLink(ctx.db, loaded.set.id) };
    },
    conflict: (_ctx, { set }) => {
      transition(set.state, "regenerate");
    },
    validate: noInput,
    perform: async (ctx, { set, corridor }) => {
      await ctx.db.query("UPDATE review_links SET revoked_at = clock_timestamp() WHERE set_id = $1 AND revoked_at IS NULL", [set.id]);
      const { link, emailId } = await mintLink(ctx.db, set, corridor, frozenOf(set));
      return afterEmail(ctx.db, 201, emailId, link, async () => ({}));
    },
  }),

  staffRoute({
    method: "GET",
    path: "/api/findings-sets/:id/evidence",
    load: async (ctx) => {
      const set = await loadSet(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", false);
      if (set.submitted_at === null) throw fail.notFound();
      return set;
    },
    validate: noInput,
    perform: async (_ctx, set) => {
      if (!monitor.storageOk()) throw fail.storageUnavailable();
      const object = await getObject(evidenceKey(set.tenant_id, set.corridor_id, set.id), undefined);
      const headers = { "content-type": "application/json", "content-length": object.headers.get("content-length") ?? "0" };
      return { status: 200, headers, stream: object.body ?? undefined };
    },
  }),
];
