import { isStudio, memberById, memberRef, type Member } from "../auth.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { checkActor, checkAnyActor, checkEditable, checkEditor, nextState, VARIATION_ACTIONS, variationActions, type VariationState } from "../domain/variations.js";
import { forbidden, notFound, staleVersion } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { holdsContract, knownId, visibleProject, type Project } from "../scope.js";

// Variations (brief: API Variations, Business rules Variations).

const MAX_CENTS = 99_999_999_999;
const STORE_COPY = "Choose one of this project's stores.";

interface VariationRow {
  id: string; project_id: string; number: string; title: string; description: string; amount_cents: number;
  currency: "HKD" | "SGD"; store_code: string | null; state: VariationState; reject_reason: string | null;
  raised_by: string; raised_at: Date; version: number; updated_by: string; updated_at: Date;
}

/** Studio roles and the contractor holding the contract see a project's variations. */
function canSeeVariations(member: Member, project: Project): boolean {
  return isStudio(member) || holdsContract(member, project);
}

const facts = (row: VariationRow) =>
  ({ state: row.state, raisedBy: row.raised_by, amountCents: Number(row.amount_cents), currency: row.currency });

async function variationJson(db: Db, row: VariationRow, viewer: Member) {
  const [raiser, updater] = await Promise.all([memberById(db, row.raised_by), memberById(db, row.updated_by)]);
  return {
    id: row.id, number: row.number, title: row.title, description: row.description, amountCents: Number(row.amount_cents),
    currency: row.currency, storeCode: row.store_code, state: row.state, rejectReason: row.reject_reason,
    raisedBy: raiser && memberRef(raiser), raisedAt: row.raised_at.toISOString(), version: row.version,
    updatedBy: updater && memberRef(updater), updatedAt: row.updated_at.toISOString(),
    actions: variationActions(viewer, facts(row)),
  };
}

/** The variation and its project when the member may see it, else 404 (or 403 for a role that can't). */
async function visibleVariation(db: Db, member: Member, id: string, lock = false): Promise<{ row: VariationRow; project: Project }> {
  const row = await one<VariationRow>(db, `SELECT * FROM variations WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [knownId(id)]);
  if (!row) throw notFound();
  const project = await visibleProject(db, member, row.project_id);
  if (!canSeeVariations(member, project)) throw forbidden();
  return { row, project };
}

/** Reads the editable fields; `partial` leaves absent fields as they are. */
function readFields(fields: Fields, body: Record<string, unknown>, project: Project, partial: boolean) {
  const present = (name: string): boolean => !partial || name in body;
  const values: { title?: string; description?: string; amountCents?: number; storeCode?: string | null } = {};
  if (present("title")) values.title = fields.text("title", "Title", { max: 120, oneLine: true });
  if (present("description")) values.description = fields.text("description", "Description", { max: 2000 });
  if (present("amountCents")) values.amountCents = fields.cents("amountCents", "Amount", { min: -MAX_CENTS, max: MAX_CENTS, nonZero: true });
  if ("storeCode" in body) {
    const code = body.storeCode;
    if (code === null || code === "") values.storeCode = null;
    else if (typeof code === "string" && project.stores.some((store) => store.code === code)) values.storeCode = code;
    else fields.fail("storeCode", STORE_COPY);
  } else if (!partial) values.storeCode = null;
  return values;
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/variations", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      if (!canSeeVariations(ctx.me, project)) throw forbidden();
      const list = await rows<VariationRow>(pool, "SELECT * FROM variations WHERE project_id = $1 ORDER BY sequence", [project.id]);
      return ok({ variations: await Promise.all(list.map((row) => variationJson(pool, row, ctx.me))) });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/variations", auth: "member", idempotent: true,
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const project = await visibleProject(client, member, ctx.params.id, true);
        if (member.role !== "director" && member.role !== "project_lead" && !holdsContract(member, project)) throw forbidden();
        const body = record(ctx.json());
        const fields = new Fields(body);
        const values = readFields(fields, body, project, false);
        ctx.requireIdempotencyKey(fields);
        fields.done();
        const [{ n: sequence }] = await rows<{ n: number }>(client,
          "SELECT coalesce(max(sequence), 0) + 1 AS n FROM variations WHERE project_id = $1", [project.id]);
        const [row] = await rows<VariationRow>(client,
          `INSERT INTO variations (project_id, sequence, number, title, description, amount_cents, currency, store_code, state, raised_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'raised', $9, $9) RETURNING *`,
          [project.id, sequence, `V-${String(sequence).padStart(3, "0")}`, values.title, values.description, values.amountCents,
            project.currency, values.storeCode, member.id]);
        await client.query("INSERT INTO variation_events (variation_id, action, state, by_member) VALUES ($1, 'raise', 'raised', $2)", [row.id, member.id]);
        return ok({ variation: await variationJson(client, row, member) }, 201);
      });
    },
  },
  {
    method: "GET", path: "/api/variations/:id", auth: "member",
    handler: async (ctx) => {
      const { row } = await visibleVariation(pool, ctx.me, ctx.params.id);
      const comments = await rows<{ id: string; body: string; author_id: string; posted_at: Date }>(pool,
        "SELECT id, body, author_id, posted_at FROM variation_comments WHERE variation_id = $1 ORDER BY posted_at", [row.id]);
      const history = await rows<{ action: string; state: string; by_member: string; at: Date }>(pool,
        "SELECT action, state, by_member, at FROM variation_events WHERE variation_id = $1 ORDER BY id", [row.id]);
      const ref = async (id: string) => {
        const author = await memberById(pool, id);
        return author && memberRef(author);
      };
      return ok({
        variation: await variationJson(pool, row, ctx.me),
        comments: await Promise.all(comments.map(async (c) => ({ id: c.id, body: c.body, author: await ref(c.author_id), postedAt: c.posted_at.toISOString() }))),
        history: await Promise.all(history.map(async (h) => ({ action: h.action, state: h.state, by: await ref(h.by_member), at: h.at.toISOString() }))),
      });
    },
  },
  {
    method: "PATCH", path: "/api/variations/:id", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const { row, project } = await visibleVariation(pool, member, ctx.params.id);
      checkEditor(member, row.raised_by);
      checkEditable(row.state);
      const body = record(ctx.json());
      // A newer save, or a lost race to one: a variation that has left the editable states is 409, else 412.
      const stale = async (): Promise<never> => {
        const [latest] = await rows<{ state: VariationState; name: string; updated_at: Date }>(pool,
          "SELECT v.state, m.name, v.updated_at FROM variations v JOIN members m ON m.id = v.updated_by WHERE v.id = $1", [row.id]);
        checkEditable(latest.state);
        throw staleVersion(latest.name, latest.updated_at.toISOString());
      };
      if (typeof body.version === "number" && body.version !== row.version) await stale();
      const fields = new Fields(body);
      fields.integer("version", "Version", 1, 2_147_483_647);
      const values = readFields(fields, body, project, true);
      fields.done();
      const updated = await one<VariationRow>(pool,
        `UPDATE variations SET title = coalesce($3, title), description = coalesce($4, description),
           amount_cents = coalesce($5, amount_cents), store_code = CASE WHEN $6 THEN $7 ELSE store_code END,
           version = version + 1, updated_by = $8, updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2 AND state IN ('raised', 'under_review') RETURNING *`,
        [row.id, body.version, values.title ?? null, values.description ?? null, values.amountCents ?? null,
          "storeCode" in values, values.storeCode ?? null, member.id]);
      if (!updated) return stale();
      await pool.query("INSERT INTO variation_events (variation_id, action, state, by_member) VALUES ($1, 'edit', $2, $3)",
        [row.id, updated.state, member.id]);
      return ok({ variation: await variationJson(pool, updated, member) });
    },
  },
  {
    method: "POST", path: "/api/variations/:id/transitions", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const { row } = await visibleVariation(client, member, ctx.params.id, true);
        const body = record(ctx.json());
        const fields = new Fields(body);
        const action = fields.oneOf("action", "Action", VARIATION_ACTIONS);
        if (fields.has("action")) {
          checkAnyActor(member, facts(row));
          fields.done();
        }
        checkActor(member, facts(row), action);
        const to = nextState(row.state, action);
        const reason = action === "reject" ? fields.text("reason", "Reason", { max: 1000 }) : null;
        fields.done();
        const [updated] = await rows<VariationRow>(client,
          `UPDATE variations SET state = $2, reject_reason = coalesce($3, reject_reason), version = version + 1,
             updated_by = $4, updated_at = clock_timestamp() WHERE id = $1 RETURNING *`, [row.id, to, reason, member.id]);
        await client.query("INSERT INTO variation_events (variation_id, action, state, by_member) VALUES ($1, $2, $3, $4)",
          [row.id, action, to, member.id]);
        return ok({ variation: await variationJson(client, updated, member) });
      });
    },
  },
  {
    method: "POST", path: "/api/variations/:id/comments", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      const { row } = await visibleVariation(pool, member, ctx.params.id);
      const fields = new Fields(record(ctx.json()));
      const text = fields.text("body", "Comment", { max: 2000 });
      fields.done();
      const [comment] = await rows<{ id: string; posted_at: Date }>(pool,
        "INSERT INTO variation_comments (variation_id, body, author_id) VALUES ($1, $2, $3) RETURNING id, posted_at", [row.id, text, member.id]);
      return ok({ comment: { id: comment.id, body: text, author: memberRef(member), postedAt: comment.posted_at.toISOString() } }, 201);
    },
  },
];
