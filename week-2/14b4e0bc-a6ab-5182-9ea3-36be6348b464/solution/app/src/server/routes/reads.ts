import { loadSamples, loadSnapshot, type Snapshot } from "../catalog.ts";
import { readSnapshot, type Tx } from "../db.ts";
import { inPrecedence, invalid, notFound } from "../errors.ts";
import type { Context, Route } from "../http.ts";
import { traverse } from "../lineage.ts";
import { resolvePointInTime, type PointInTime } from "../pit.ts";
import { parseSearch, runSearch } from "../search.ts";
import { byString } from "../text.ts";
import { assetDetail, columnRead, graphColumn } from "../views.ts";

/**
 * Every read accepting the point-in-time parameters: an id unknown in the current catalog answers
 * 404 first, then the parameters are checked, then the read runs on the snapshot at the resolved seq
 * (where an id absent at that seq is a 404 of the snapshot itself).
 */
async function pointInTimeRead(
  ctx: Context,
  liveExists: ((tx: Tx) => Promise<boolean>) | null,
  build: (snapshot: Snapshot, tx: Tx) => Promise<Record<string, unknown>>,
  wrapKey: string | null,
  validate: () => void = () => undefined,
) {
  return readSnapshot(async (tx) => {
    let pit = null as PointInTime | null;
    await inPrecedence({
      async existence() {
        if (liveExists && !(await liveExists(tx))) throw notFound();
      },
      async validation() {
        pit = await resolvePointInTime(tx, ctx.url.searchParams);
        validate();
      },
    });
    const snapshot = await loadSnapshot(tx, pit ? pit.k : null);
    const body = await build(snapshot, tx);
    if (!pit) return { status: 200, body };
    const marker = { as_of_seq: pit.k, as_of_at: pit.at };
    return { status: 200, body: wrapKey ? { ...marker, [wrapKey]: body } : { ...body, ...marker } };
  });
}

const assetExists = (id: string) => async (tx: Tx) => !!(await tx.query("select 1 from assets where id = $1", [id])).rowCount;
const columnExists = (id: string) => async (tx: Tx) => !!(await tx.query("select 1 from columns where id = $1", [id])).rowCount;

async function userNames(tx: Tx): Promise<Map<string, string>> {
  const { rows } = await tx.query("select id, name from users");
  return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
}

export const readRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/api/search",
    async handler(ctx) {
      const state = parseSearch(ctx.url.searchParams);
      return pointInTimeRead(ctx, null, async (snapshot, tx) => runSearch(snapshot, state, await userNames(tx)), null);
    },
  },
  {
    method: "GET",
    pattern: "/api/assets/:id",
    handler: (ctx) =>
      pointInTimeRead(ctx, assetExists(ctx.params.id), async (snapshot, tx) => {
        const id = ctx.params.id;
        if (!snapshot.assets.has(id)) throw notFound();
        const samples = await loadSamples(tx, snapshot.assetColumns.get(id) ?? []);
        return assetDetail(snapshot, id, samples, ctx.actor.role);
      }, "asset"),
  },
  {
    method: "GET",
    pattern: "/api/columns/:id",
    handler: (ctx) =>
      pointInTimeRead(ctx, columnExists(ctx.params.id), async (snapshot, tx) => {
        const id = ctx.params.id;
        if (!snapshot.columns.has(id)) throw notFound();
        const samples = await loadSamples(tx, [id]);
        return columnRead(snapshot, id, samples.get(id) ?? [], ctx.actor.role);
      }, "column"),
  },
  {
    method: "GET",
    pattern: "/api/graph",
    handler: (ctx) =>
      pointInTimeRead(ctx, null, async (snapshot) => ({
        columns: [...snapshot.columns.keys()].sort(byString).map((id) => graphColumn(snapshot, id)),
        edges: [...snapshot.facts.edges]
          .sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to))
          .map(({ id, from, to, transform }) => ({ id, from, to, transform })),
      }), null),
  },
  {
    method: "GET",
    pattern: "/api/columns/:id/lineage",
    handler: (ctx) =>
      pointInTimeRead(ctx, columnExists(ctx.params.id), async (snapshot) => {
        if (!snapshot.columns.has(ctx.params.id)) throw notFound();
        return traverse(snapshot, ctx.params.id, ctx.url.searchParams.get("direction") as "downstream" | "upstream");
      }, null, () => {
        const direction = ctx.url.searchParams.get("direction");
        if (direction !== "downstream" && direction !== "upstream") {
          throw invalid({ direction: "Direction must be downstream or upstream." });
        }
      }),
  },
];
