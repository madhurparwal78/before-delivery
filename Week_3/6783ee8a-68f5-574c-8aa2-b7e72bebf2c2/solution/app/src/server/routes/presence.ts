import { limits } from "../config";
import { pool, query, queryOne } from "../db";
import { Problems, defineRoute, reply } from "../http";
import { openStream } from "../live";
import { kernelStatus, presentIn, publishCells, publishKernel, publishPresence } from "../notebooks";
import { field, validTab } from "../validate";

/** Forgets a tab: its presence marker, its cell locks and its kernel report. */
async function dropTab(notebookId: string, tabId: string): Promise<void> {
  const locks = await query<{ cell_id: string }>(pool, "DELETE FROM cell_locks WHERE notebook_id = $1 AND tab_id = $2 RETURNING cell_id", [notebookId, tabId]);
  const kernels = await query(pool, "DELETE FROM kernel_tabs WHERE notebook_id = $1 AND tab_id = $2 RETURNING tab_id", [notebookId, tabId]);
  const gone = await query(pool, "DELETE FROM presence WHERE notebook_id = $1 AND tab_id = $2 RETURNING tab_id", [notebookId, tabId]);
  if (locks.length) publishCells(notebookId, locks.map((l) => l.cell_id), false);
  if (kernels.length) publishKernel(notebookId, await kernelStatus(pool, notebookId));
  if (gone.length) publishPresence(notebookId);
}

/** The server decides expiry: a marker and its locks go once the presence timeout has passed since the last heartbeat. */
async function sweep(): Promise<void> {
  const seconds = limits.presence_timeout_ms / 1000;
  const silent = await query<{ notebook_id: string; tab_id: string }>(
    pool,
    "SELECT notebook_id, tab_id FROM presence WHERE last_seen < clock_timestamp() - make_interval(secs => $1)",
    [seconds],
  );
  for (const tab of silent) await dropTab(tab.notebook_id, tab.tab_id);
  const stale = await query<{ notebook_id: string; cell_id: string }>(
    pool,
    "DELETE FROM cell_locks WHERE last_seen < clock_timestamp() - make_interval(secs => $1) RETURNING notebook_id, cell_id",
    [seconds],
  );
  const byNotebook = new Map<string, string[]>();
  for (const lock of stale) byNotebook.set(lock.notebook_id, [...(byNotebook.get(lock.notebook_id) ?? []), lock.cell_id]);
  for (const [notebookId, ids] of byNotebook) publishCells(notebookId, ids, false);
}

export function startSweeper(): void {
  setInterval(() => void sweep().catch((error) => console.error("presence sweep failed:", error instanceof Error ? error.message : error)), 500);
}

interface PresenceBody {
  tab_id: string;
  cell_id: string | null;
}

const beat = defineRoute<undefined, PresenceBody>({
  method: "POST",
  path: "/api/notebooks/:id/presence",
  access: "session",
  notebook: "viewer",
  body: "json",
  validate: (body) => {
    const problems = new Problems();
    const tab = field(body, "tab_id");
    const cell = field(body, "cell_id");
    if (!validTab(tab)) problems.add("tab_id", "is required");
    if (cell !== null && cell !== undefined && typeof cell !== "string") problems.add("cell_id", "must be a cell id or null");
    problems.done();
    return { tab_id: tab as string, cell_id: typeof cell === "string" ? cell : null };
  },
  run: async (ctx, _resource, body) => {
    const notebookId = ctx.notebook().id;
    const before = await queryOne<{ cell_id: string | null }>(pool, "SELECT cell_id FROM presence WHERE notebook_id = $1 AND tab_id = $2", [notebookId, body.tab_id]);
    await pool.query(
      `INSERT INTO presence (notebook_id, tab_id, user_id, cell_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (notebook_id, tab_id) DO UPDATE SET cell_id = $4, last_seen = clock_timestamp()`,
      [notebookId, body.tab_id, ctx.me().id, body.cell_id],
    );
    await pool.query("UPDATE cell_locks SET last_seen = clock_timestamp() WHERE notebook_id = $1 AND tab_id = $2", [notebookId, body.tab_id]);
    if (!before || before.cell_id !== body.cell_id) publishPresence(notebookId);
    return reply(200, { present: await presentIn(pool, notebookId) });
  },
});

const present = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/presence",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => reply(200, { present: await presentIn(pool, ctx.notebook().id) }),
});

const events = defineRoute<undefined, string>({
  method: "GET",
  path: "/api/notebooks/:id/events",
  access: "session",
  notebook: "viewer",
  validate: (_body, _resource, ctx) => {
    const tab = ctx.url.searchParams.get("tab_id");
    if (!validTab(tab)) {
      const problems = new Problems();
      problems.add("tab_id", "is required");
      problems.done();
    }
    return tab as string;
  },
  run: async (ctx, _resource, tab) => {
    const notebookId = ctx.notebook().id;
    const userId = ctx.me().id;
    return { status: 200, stream: (res) => openStream(res, notebookId, userId, () => void dropTab(notebookId, tab)) };
  },
});

export const presenceRoutes = [beat, present, events];
