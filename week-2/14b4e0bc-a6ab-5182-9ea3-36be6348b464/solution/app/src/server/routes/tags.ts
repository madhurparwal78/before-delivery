import { randomUUID } from "node:crypto";
import type { Actor } from "../auth.ts";
import type { Json } from "../audit.ts";
import { pool, type Tx } from "../db.ts";
import { conflict, FieldErrors, forbidden, inPrecedence, invalid, notFound, type Checks } from "../errors.ts";
import { graphWrite } from "../graph.ts";
import type { Context, Route } from "../http.ts";
import { fingerprint, idempotent } from "../idempotency.ts";
import { may } from "../permissions.ts";
import { stillReaching, type Derived } from "../tags.ts";
import { byString, codePoints, isTag, sortTags, type Role, type Tag } from "../text.ts";
import { MASKED, masks } from "../views.ts";
import { commitWrite } from "../write.ts";

interface ColumnState {
  direct: Tag[];
  suppressed: Tag[];
  effective: Tag[];
}

async function columnState(tx: Tx, columnId: string): Promise<ColumnState> {
  const direct = await tx.query("select tag from direct_tags where column_id = $1 and to_seq is null", [columnId]);
  const suppressed = await tx.query("select tag from suppressions where column_id = $1 and to_seq is null", [columnId]);
  const effective = await tx.query("select tag from column_tags where column_id = $1", [columnId]);
  const tags = (r: { rows: { tag: Tag }[] }) => sortTags(r.rows.map((x) => x.tag));
  return { direct: tags(direct), suppressed: tags(suppressed), effective: tags(effective) };
}

/** A live column body read inside the writing transaction, masked for the committing role. */
async function liveColumnBody(tx: Tx, columnId: string, role: Role) {
  const column = await tx.query("select id, name, data_type, samples from columns where id = $1", [columnId]);
  const tagRows = await tx.query("select tag, sources from column_tags where column_id = $1", [columnId]);
  const state = await columnState(tx, columnId);
  const c = column.rows[0];
  const sources = new Map<Tag, string[]>(tagRows.rows.map((r: { tag: Tag; sources: string[] }) => [r.tag, r.sources]));
  const masked = c.samples.length > 0 && masks(role, state.effective);
  return {
    id: c.id,
    name: c.name,
    data_type: c.data_type,
    direct_tags: state.direct,
    effective_tags: state.effective,
    suppressed_tags: state.suppressed,
    tag_sources: Object.fromEntries(state.effective.map((t) => [t, sources.get(t)!])),
    samples: masked ? c.samples.map(() => MASKED) : c.samples,
    masked,
  };
}

/** Queries on one transaction client run one at a time. */
async function sequential<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
}

async function requireColumn(id: string): Promise<void> {
  if (!(await pool.query("select 1 from columns where id = $1", [id])).rowCount) throw notFound();
}

function tagField(value: unknown): Tag {
  if (!isTag(value)) throw invalid({ tag: "Tag must be PII or Confidential." });
  return value;
}

/** A single-column tag change committed through the graph recompute. */
function columnWrite<T>(
  actor: Actor,
  columnId: string,
  change: (tx: Tx, seq: number, at: string, state: ColumnState) => Promise<{ action: string; before: { [key: string]: Json }; after: { [key: string]: Json }; extra?: (before: Derived, after: Derived) => T }>,
) {
  return commitWrite(actor, may.curate, async ({ tx, seq, at, actor: committing }) => {
    const state = await columnState(tx, columnId);
    let audit: { action: string; before: { [key: string]: Json }; after: { [key: string]: Json }; extra?: (before: Derived, after: Derived) => T } | undefined;
    const outcome = await graphWrite(tx, async () => {
      audit = await change(tx, seq, at, state);
    });
    const a = audit!;
    return {
      audit: { action: a.action, targetType: "column", targetId: columnId, before: a.before, after: a.after },
      result: {
        column: await liveColumnBody(tx, columnId, committing.role),
        changed_columns: outcome.changed,
        extra: a.extra?.(outcome.before, outcome.after),
      },
    };
  });
}

export const tagRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/api/columns/:id/tags",
    async handler(ctx) {
      const id = ctx.params.id;
      await inPrecedence({
        async existence() {
          await requireColumn(id);
        },
      });
      const requested = ctx.json().tag;
      const r = await columnWrite(ctx.actor, id, async (tx, seq, _at, state) => {
        let tag!: Tag;
        await inPrecedence({
          state() {
            if (isTag(requested) && state.direct.includes(requested)) throw conflict("tag_exists", `${id} already carries ${requested} directly.`);
            if (isTag(requested) && state.suppressed.includes(requested)) {
              throw conflict("tag_suppressed", `${requested} is suppressed on ${id}; lift the suppression first.`);
            }
          },
          validation() {
            tag = tagField(requested);
          },
        });
        await tx.query("insert into direct_tags(column_id, tag, from_seq) values ($1, $2, $3)", [id, tag, seq]);
        return { action: "tag.add", before: { direct_tags: state.direct }, after: { direct_tags: sortTags([...state.direct, tag]) } };
      });
      return { status: 201, body: { column: r.column, changed_columns: r.changed_columns } };
    },
  },
  {
    method: "DELETE",
    pattern: "/api/columns/:id/tags/:tag",
    async handler(ctx) {
      const id = ctx.params.id;
      await inPrecedence({
        async existence() {
          await requireColumn(id);
        },
      });
      const requested = ctx.params.tag;
      const r = await columnWrite(ctx.actor, id, async (tx, seq, _at, state) => {
        let tag!: Tag;
        await inPrecedence({
          state() {
            if (isTag(requested) && !state.direct.includes(requested)) {
              if (state.effective.includes(requested)) throw conflict("tag_inherited", `${requested} on ${id} is inherited; withdraw it at its source.`);
              throw conflict("tag_absent", `${id} does not carry ${requested}.`);
            }
          },
          validation() {
            tag = tagField(requested);
          },
        });
        await tx.query("update direct_tags set to_seq = $3 where column_id = $1 and tag = $2 and to_seq is null", [id, tag, seq]);
        return {
          action: "tag.withdraw",
          before: { direct_tags: state.direct },
          after: { direct_tags: state.direct.filter((t) => t !== tag) },
          extra: (before: Derived, after: Derived) => stillReaching(before, after, id, tag),
        };
      });
      return { status: 200, body: { column: r.column, changed_columns: r.changed_columns, still_reaching: r.extra } };
    },
  },
  {
    method: "POST",
    pattern: "/api/columns/:id/suppressions",
    async handler(ctx) {
      const id = ctx.params.id;
      await inPrecedence({
        async existence() {
          await requireColumn(id);
        },
      });
      const body = ctx.json();
      const requested = body.tag;
      const justification = typeof body.justification === "string" ? body.justification.trim() : "";
      const r = await columnWrite(ctx.actor, id, async (tx, seq, at, state) => {
        await inPrecedence({
          state() {
            if (!isTag(requested)) return;
            if (state.suppressed.includes(requested)) throw conflict("suppression_exists", `${requested} is already suppressed on ${id}.`);
            if (state.direct.includes(requested)) throw conflict("tag_not_inherited", `${requested} on ${id} is not inherited; withdraw it instead.`);
            if (!state.effective.includes(requested)) throw conflict("tag_absent", `${id} does not carry ${requested}.`);
          },
          validation() {
            const errors = new FieldErrors();
            if (!isTag(requested)) errors.add("tag", "Tag must be PII or Confidential.");
            if (codePoints(justification) < 10 || codePoints(justification) > 500) {
              errors.add("justification", "Give a justification of 10 to 500 characters.");
            }
            errors.throwIfAny();
          },
        });
        const tag = requested as Tag;
        await tx.query(
          "insert into suppressions(id, column_id, tag, justification, actor_id, at, from_seq) values ($1, $2, $3, $4, $5, $6, $7)",
          [randomUUID(), id, tag, justification, ctx.actor.id, at, seq],
        );
        return {
          action: "tag.suppress",
          before: { suppressed_tags: state.suppressed },
          after: { suppressed_tags: sortTags([...state.suppressed, tag]), justification },
        };
      });
      return { status: 201, body: { column: r.column, changed_columns: r.changed_columns } };
    },
  },
  {
    method: "DELETE",
    pattern: "/api/columns/:id/suppressions/:tag",
    async handler(ctx) {
      const id = ctx.params.id;
      const tag = ctx.params.tag;
      await inPrecedence({
        async existence() {
          if (!isTag(tag) || !(await pool.query("select 1 from suppressions where column_id = $1 and tag = $2 and to_seq is null", [id, tag])).rowCount) {
            throw notFound();
          }
        },
      });
      const r = await columnWrite(ctx.actor, id, async (tx, seq, _at, state) => {
        await inPrecedence({
          existence() {
            if (!isTag(tag) || !state.suppressed.includes(tag)) throw notFound();
          },
        });
        await tx.query("update suppressions set to_seq = $3 where column_id = $1 and tag = $2 and to_seq is null", [id, tag, seq]);
        return {
          action: "tag.unsuppress",
          before: { suppressed_tags: state.suppressed },
          after: { suppressed_tags: state.suppressed.filter((t) => t !== tag) },
        };
      });
      return { status: 200, body: { column: r.column, changed_columns: r.changed_columns } };
    },
  },
  {
    method: "POST",
    pattern: "/api/assets/:id/tags/bulk",
    handler: (ctx) => bulkApply(ctx),
  },
  {
    method: "POST",
    pattern: "/api/tag-batches/:id/undo",
    handler: (ctx) => undoBatch(ctx),
  },
];

async function bulkApply(ctx: Context) {
  const assetId = ctx.params.id;
  const access: Checks = {
    async existence() {
      if (!(await pool.query("select 1 from assets where id = $1", [assetId])).rowCount) throw notFound();
    },
    permission() {
      if (!may.curate(ctx.actor.role)) throw forbidden();
    },
  };
  const body = () => ctx.json();
  return idempotent(ctx, "bulk", assetId, {
    fingerprint: async () => fingerprint([body().tag, body().columns]),
    access,
    async run() {
      await inPrecedence(access);
      const { tag: requested, columns } = body();
      const result = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, actor: committing }) => {
        const own = new Set((await tx.query("select id from columns where asset_id = $1", [assetId])).rows.map((r: { id: string }) => r.id));
        const list = Array.isArray(columns) ? columns : [];
        await inPrecedence({
          validation() {
            const errors = new FieldErrors();
            if (!isTag(requested)) errors.add("tag", "Tag must be PII or Confidential.");
            if (!Array.isArray(columns) || list.length < 1 || list.length > 200 || new Set(list).size !== list.length) {
              errors.add("columns", "Select 1 to 200 columns of this asset.");
            } else {
              list.forEach((c, i) => typeof c === "string" && own.has(c) ? undefined : errors.add(`columns[${i}]`, "Unknown column of this asset."));
            }
            errors.throwIfAny();
          },
        });
        const tag = requested as Tag;
        const ids = list as string[];
        const states = new Map<string, ColumnState>();
        for (const c of ids) states.set(c, await columnState(tx, c));
        const outcomes = ids.map((c) => {
          const s = states.get(c)!;
          if (s.direct.includes(tag)) return { column: c, outcome: "already_present" as const, error: null };
          if (s.suppressed.includes(tag)) {
            return { column: c, outcome: "refused" as const, error: { code: "tag_suppressed", message: `${tag} is suppressed on ${c}; lift the suppression first.` } };
          }
          return { column: c, outcome: "applied" as const, error: null };
        });
        const applied = outcomes.filter((o) => o.outcome === "applied").map((o) => o.column);
        const batchId = applied.length ? randomUUID() : null;
        const change = await graphWrite(tx, async () => {
          for (const c of applied) await tx.query("insert into direct_tags(column_id, tag, from_seq) values ($1, $2, $3)", [c, tag, seq]);
          if (batchId) {
            await tx.query("insert into tag_batches(id, asset_id, tag, seq, applied) values ($1, $2, $3, $4, $5)", [
              batchId, assetId, tag, seq, JSON.stringify(applied.map((c) => ({ column: c, before: states.get(c)!.direct }))),
            ]);
          }
        });
        const reply = {
          batch_id: batchId,
          tag,
          requested: ids.length,
          applied: applied.length,
          results: outcomes,
          columns: await sequential(ids, (c) => liveColumnBody(tx, c, committing.role)),
          changed_columns: change.changed,
        };
        return {
          audit: batchId
            ? {
                action: "tag.bulk_add",
                targetType: "asset",
                targetId: assetId,
                before: { direct_tags: Object.fromEntries(applied.map((c) => [c, states.get(c)!.direct])) },
                after: { batch_id: batchId, tag, direct_tags: Object.fromEntries(applied.map((c) => [c, sortTags([...states.get(c)!.direct, tag])])) },
              }
            : null,
          result: reply,
        };
      });
      return { status: 200, body: result };
    },
  });
}

const TAG_ACTIONS = ["tag.add", "tag.withdraw", "tag.suppress", "tag.unsuppress", "tag.bulk_add", "tag.bulk_undo"];

async function undoBatch(ctx: Context) {
  const batchId = ctx.params.id;
  const batch = (await pool.query("select id, asset_id, tag, seq, applied, undone_seq from tag_batches where id = $1", [batchId])).rows[0];
  await inPrecedence({
    existence() {
      if (!batch) throw notFound();
    },
  });
  const result = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, actor: committing }) => {
    const applied = batch.applied as { column: string; before: Tag[] }[];
    const columns = new Set(applied.map((a) => a.column));
    await inPrecedence({
      async state() {
        const current = (await tx.query("select undone_seq from tag_batches where id = $1", [batchId])).rows[0];
        if (current.undone_seq !== null) throw conflict("batch_undone", "This bulk tag apply was already undone.");
        const later = await tx.query("select action, target_type, target_id, after from audit_log where seq > $1 and action = any($2)", [
          batch.seq, TAG_ACTIONS,
        ]);
        const changed = new Set<string>();
        for (const row of later.rows as { action: string; target_type: string; target_id: string; after: { direct_tags?: Record<string, unknown> } }[]) {
          if (row.target_type === "column" && columns.has(row.target_id)) changed.add(row.target_id);
          if (row.target_type === "asset") for (const c of Object.keys(row.after?.direct_tags ?? {})) if (columns.has(c)) changed.add(c);
        }
        if (changed.size) {
          throw conflict("batch_changed", `Undo refused: ${[...changed].sort(byString)[0]} changed after the bulk apply.`);
        }
      },
    });
    const beforeTags = new Map<string, Tag[]>();
    const change = await graphWrite(tx, async () => {
      for (const { column, before } of applied) {
        const state = await columnState(tx, column);
        beforeTags.set(column, state.direct);
        for (const t of state.direct) {
          if (!before.includes(t)) {
            await tx.query("update direct_tags set to_seq = $3 where column_id = $1 and tag = $2 and to_seq is null", [column, t, seq]);
          }
        }
        for (const t of before) {
          if (!state.direct.includes(t)) await tx.query("insert into direct_tags(column_id, tag, from_seq) values ($1, $2, $3)", [column, t, seq]);
        }
      }
      await tx.query("update tag_batches set undone_seq = $2 where id = $1", [batchId, seq]);
    });
    return {
      audit: {
        action: "tag.bulk_undo",
        targetType: "asset",
        targetId: batch.asset_id,
        before: { batch_id: batchId, direct_tags: Object.fromEntries(applied.map((a) => [a.column, beforeTags.get(a.column)!])) },
        after: { direct_tags: Object.fromEntries(applied.map((a) => [a.column, sortTags(a.before)])) },
      },
      result: {
        batch_id: batchId,
        restored: applied.length,
        columns: await sequential(applied, (a) => liveColumnBody(tx, a.column, committing.role)),
        changed_columns: change.changed,
      },
    };
  });
  return { status: 200, body: result };
}

