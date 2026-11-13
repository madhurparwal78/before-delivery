import { config } from "./config.js";
import { db } from "./db.js";
import { exclusive } from "./locks.js";
import { copyId, metaNumber } from "./meta.js";
import { FRESH_CONNECTION, providers } from "./status.js";
import type { SearchState } from "../shared/types.js";

interface Answer { status: number; body: Record<string, unknown> }

async function meili(method: string, path: string, body?: unknown, timeoutMs = 3500): Promise<Answer> {
  try {
    const answer = await fetch(`${config.meiliUrl}${path}`, {
      method,
      headers: { ...FRESH_CONNECTION, authorization: `Bearer ${config.meiliKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await answer.text();
    if (answer.status >= 500) throw new Error(`Meilisearch answered ${answer.status}`);
    providers.meili = true;
    return { status: answer.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  } catch (error) {
    providers.meili = false;
    throw error;
  }
}

export async function touchMeili(): Promise<void> {
  await meili("GET", "/health", undefined, 3000);
}

const SEARCHABLE = ["skuName", "drinkName", "aliases", "titles"];

interface Doc { id: string; skuCode: string; skuName: string; drinkName: string; aliases: string[]; titles: string[] }

async function buildDocs(): Promise<Doc[]> {
  const [skus, aliases, titles] = await Promise.all([
    db.query("SELECT s.code, s.variant, d.name AS drink_name FROM skus s JOIN drinks d ON d.id = s.drink_id ORDER BY s.position"),
    db.query("SELECT alias, sku_code FROM aliases ORDER BY alias"),
    db.query(`SELECT DISTINCT r.sku_code, v.title FROM notice_rows r JOIN notice_versions v ON v.number = r.number AND v.version = r.version
              WHERE v.version = (SELECT max(version) FROM notice_versions WHERE number = v.number) ORDER BY v.title`),
  ]);
  return skus.rows.map((s) => ({
    id: s.code as string, skuCode: s.code as string, skuName: `${s.drink_name as string} ${s.variant as string}`, drinkName: s.drink_name as string,
    aliases: aliases.rows.filter((a) => a.sku_code === s.code).map((a) => a.alias as string),
    titles: titles.rows.filter((t) => t.sku_code === s.code).map((t) => t.title as string),
  }));
}

const same = (a: Doc, b: Record<string, unknown>): boolean =>
  a.skuName === b.skuName && a.drinkName === b.drinkName && JSON.stringify(a.aliases) === JSON.stringify(b.aliases) && JSON.stringify(a.titles) === JSON.stringify(b.titles);

let unconfirmed: number[] = [];

async function taskState(uid: number): Promise<string> {
  const t = await meili("GET", `/tasks/${uid}`);
  return String(t.body.status ?? "enqueued");
}

/** Waits for every task to report succeeded, never trusting an accepted-only reply. Returns false when time runs out. */
async function confirmed(uids: number[], waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  let left = [...uids];
  while (left.length && Date.now() < until) {
    const states = await Promise.all(left.map(async (uid) => ({ uid, state: await taskState(uid) })));
    if (states.some((s) => s.state === "failed" || s.state === "canceled")) {
      unconfirmed = [];
      return false;
    }
    left = states.filter((s) => s.state !== "succeeded").map((s) => s.uid);
    if (left.length) await new Promise((r) => setTimeout(r, 150));
  }
  return left.length === 0;
}

const taskOf = (a: Answer): number[] => (typeof a.body.taskUid === "number" ? [a.body.taskUid] : []);

async function run(): Promise<void> {
  if (unconfirmed.length) {
    if (!(await confirmed(unconfirmed, 1500))) return;
    unconfirmed = [];
  }
  const gen = await metaNumber("search_gen");
  const uid = `interval_${await copyId()}_packs`;
  const docs = await buildDocs();
  if ((await meili("GET", `/indexes/${uid}`)).status === 404) {
    const made = await meili("POST", "/indexes", { uid, primaryKey: "id" });
    if (!(await confirmed(taskOf(made), 8000))) return;
  }
  const settings = await meili("GET", `/indexes/${uid}/settings`);
  if (JSON.stringify(settings.body.searchableAttributes) !== JSON.stringify(SEARCHABLE)) {
    const set = await meili("PATCH", `/indexes/${uid}/settings`, { searchableAttributes: SEARCHABLE });
    if (!(await confirmed(taskOf(set), 8000))) return;
  }
  const have = await meili("GET", `/indexes/${uid}/documents?limit=1000`);
  const existing = new Map(((have.body.results ?? []) as Record<string, unknown>[]).map((d) => [d.id as string, d]));
  const changed = docs.filter((d) => !existing.has(d.id) || !same(d, existing.get(d.id)!));
  const extra = [...existing.keys()].filter((id) => !docs.some((d) => d.id === id));
  const tasks: number[] = [];
  if (changed.length) tasks.push(...taskOf(await meili("PUT", `/indexes/${uid}/documents?primaryKey=id`, changed, 8000)));
  if (extra.length) tasks.push(...taskOf(await meili("POST", `/indexes/${uid}/documents/delete-batch`, extra)));
  if (tasks.length) {
    unconfirmed = tasks;
    if (!(await confirmed(tasks, 15000))) return;
    unconfirmed = [];
  }
  await db.query("UPDATE meta SET value = GREATEST(value::bigint, $1::bigint)::text WHERE key = 'search_synced'", [gen]);
}

/** Makes the index match Postgres now. Safe to repeat, and never restores older data. */
export function syncIndex(): Promise<void> {
  return exclusive("meili-sync", run);
}

/** SKU codes the index finds for a text query, or null when Meilisearch could not answer. */
export async function searchIndex(q: string): Promise<string[] | null> {
  try {
    const answer = await meili("POST", `/indexes/interval_${await copyId()}_packs/search`, { q, limit: 50, matchingStrategy: "all", attributesToRetrieve: ["id"] });
    if (answer.status !== 200) return [];
    return ((answer.body.hits ?? []) as { id: string }[]).map((h) => h.id);
  } catch {
    return null;
  }
}

export async function searchState(): Promise<SearchState> {
  if (!providers.meili) return "down";
  return (await metaNumber("search_gen")) > (await metaNumber("search_synced")) ? "behind" : "current";
}
