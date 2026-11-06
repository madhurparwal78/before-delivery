import { config } from "../config";
import { one, pool, rows, transaction } from "../db";
import { ApiError, conflict, invalid, notFound, type Json } from "../http";
import { route } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { centimetresToMetres } from "../../shared/money";
import { weekStates } from "../domain/holds";
import { availabilityWindow, seasonOf, weekEnd } from "../domain/weeks";
import { profileJson, ratesJson, seasonRate, visibleYacht, visibleYachts, yachtBySlug, type YachtRow } from "../domain/yachts";

route("GET", "/api/health", { handle: async () => ({ status: 200, body: { status: "ok" } }) });

const withdrawn = (): ApiError => new ApiError(410, { error: "yacht_withdrawn" });

function publicYachtJson(y: YachtRow): Record<string, Json> {
  return {
    slug: y.slug,
    name: y.name,
    base: y.base,
    cabins: y.cabins,
    lengthM: centimetresToMetres(y.length_cm),
    beamM: centimetresToMetres(y.beam_cm),
    draftM: centimetresToMetres(y.draft_cm),
    rates: ratesJson(y),
    currency: "EUR",
  };
}

async function workspaceName(slug: string): Promise<string> {
  const ws = await one<{ name: string }>(pool, "SELECT name FROM workspaces WHERE slug = $1", [slug]);
  if (!ws) throw notFound();
  return ws.name;
}

const CABIN_FILTERS = ["3", "4", "5", "6"] as const;

route("GET", "/api/public/fleets/:ws", {
  handle: async (ctx) => {
    const name = await workspaceName(ctx.params.ws);
    const fields = new Fields();
    const optional = (key: string, options: readonly string[]) => {
      const value = ctx.query(key);
      return value ? fields.option(key, value, options) : null;
    };
    const base = optional("base", ["split", "lavrio"]);
    const cabins = optional("cabins", CABIN_FILTERS);
    optional("season", ["low", "shoulder", "high"]);
    const week = optional("week", availabilityWindow(ctx.now));
    const q = ctx.query("q") ?? "";
    if ([...q].length > 80) fields.fail("q", FIELD.maxChars(80));
    fields.check();
    let yachts = await rows<YachtRow>(pool, "SELECT * FROM yachts WHERE workspace_slug = $1 AND status = 'on_sale' ORDER BY name", [ctx.params.ws]);
    yachts = yachts.filter(
      (y) => (!base || y.base === base) && (!cabins || y.cabins >= Number(cabins)) && y.name.toLowerCase().includes(q.trim().toLowerCase()),
    );
    if (week) {
      const free = [];
      for (const y of yachts) if ((await weekStates(pool, y.id, [week], ctx.now)).get(week)?.status === "free") free.push(y);
      yachts = free;
    }
    return { status: 200, body: { workspace: { slug: ctx.params.ws, name }, yachts: yachts.map(publicYachtJson) } };
  },
});

export async function weeksJson(yacht: YachtRow, nowMs: number, staff: boolean): Promise<Json[]> {
  const window = availabilityWindow(nowMs);
  const states = await weekStates(pool, yacht.id, window, nowMs);
  return window.map((weekStart) => {
    const state = states.get(weekStart)!;
    const season = seasonOf(weekStart);
    return {
      weekStart,
      weekEnd: weekEnd(weekStart),
      status: state.status,
      season,
      weeklyRateMinor: seasonRate(yacht, season),
      currency: "EUR",
      ...(staff ? { liveHoldId: state.liveHoldId, waitingCount: state.waitingCount } : {}),
    };
  });
}

route("GET", "/api/public/fleets/:ws/yachts/:slug", {
  handle: async (ctx) => {
    await workspaceName(ctx.params.ws);
    const yacht = await yachtBySlug(pool, ctx.params.ws, ctx.params.slug);
    if (!yacht) throw notFound();
    if (yacht.status === "withdrawn") throw withdrawn();
    return { status: 200, body: { ...publicYachtJson(yacht), weeks: await weeksJson(yacht, ctx.now, false) } };
  },
});

export async function sitemap(): Promise<string> {
  const yachts = await rows<{ workspace_slug: string; slug: string }>(pool, "SELECT workspace_slug, slug FROM yachts WHERE status = 'on_sale' ORDER BY workspace_slug, name");
  const workspaces = await rows<{ slug: string }>(pool, "SELECT slug FROM workspaces ORDER BY slug");
  const urls = [...workspaces.map((w) => `/fleet/${w.slug}`), ...yachts.map((y) => `/fleet/${y.workspace_slug}/${y.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${config.publicUrl}${u}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

route("GET", "/api/w/:ws/yachts", {
  staff: true,
  handle: async (ctx) => {
    const yachts = await visibleYachts(pool, ctx.member);
    return { status: 200, body: { yachts: await Promise.all(yachts.map((y) => profileJson(pool, y))) } };
  },
});

route("GET", "/api/w/:ws/yachts/:slug", {
  staff: true,
  handle: async (ctx) => ({ status: 200, body: { yacht: await profileJson(pool, await visibleYacht(pool, ctx.member, ctx.params.slug)) } }),
});

route("GET", "/api/w/:ws/yachts/:slug/weeks", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    return { status: 200, body: { weeks: await weeksJson(yacht, ctx.now, true) } };
  },
});

const RATE_MIN = 100000;
const RATE_MAX = 100000000;

route("PATCH", "/api/w/:ws/yachts/:slug", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow([]);
    const body = asBody(await ctx.json());
    const fields = new Fields();
    const set: Record<string, unknown> = {};
    if ("name" in body) set.name = fields.text("name", body.name, 80);
    if ("cabins" in body) set.cabins = fields.whole("cabins", body.cabins, 2, 6);
    if ("lengthM" in body) set.length_cm = fields.metres("lengthM", body.lengthM, 800, 4000);
    if ("beamM" in body) set.beam_cm = fields.metres("beamM", body.beamM, 300, 1500);
    if ("draftM" in body) set.draft_cm = fields.metres("draftM", body.draftM, 50, 300);
    if ("rates" in body) {
      const rates = asBody(body.rates);
      for (const [key, column] of [["lowMinor", "rate_low_minor"], ["shoulderMinor", "rate_shoulder_minor"], ["highMinor", "rate_high_minor"]] as const) {
        if (!(key in rates)) continue;
        const value = rates[key];
        if (typeof value !== "number" || !Number.isInteger(value) || value < RATE_MIN || value > RATE_MAX) {
          fields.fail(`rates.${key}`, value === null || value === undefined || value === "" ? FIELD.required : FIELD.money(RATE_MIN, RATE_MAX));
        } else {
          set[column] = value;
        }
      }
    }
    if (!fields.ok) throw invalid(fields.errors);
    const columns = Object.keys(set);
    if (columns.length) {
      await pool.query(
        `UPDATE yachts SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [yacht.id, ...columns.map((c) => set[c])],
      );
    }
    return { status: 200, body: { yacht: await profileJson(pool, (await yachtBySlug(pool, ctx.params.ws, ctx.params.slug))!) } };
  },
});

for (const [path, from, to, refusal] of [
  ["withdraw", "on_sale", "withdrawn", "already_withdrawn"],
  ["return-to-sale", "withdrawn", "on_sale", "already_on_sale"],
] as const) {
  route("POST", `/api/w/:ws/yachts/:slug/${path}`, {
    staff: true,
    handle: async (ctx) => {
      await visibleYacht(pool, ctx.member, ctx.params.slug);
      ctx.allow([]);
      const updated = await transaction(async (db) => {
        const yacht = (await visibleYacht(db, ctx.member, ctx.params.slug, true))!;
        if (yacht.status !== from) throw conflict(refusal);
        await db.query("UPDATE yachts SET status = $2 WHERE id = $1", [yacht.id, to]);
        return { ...yacht, status: to };
      });
      return { status: 200, body: { yacht: await profileJson(pool, updated) } };
    },
  });
}
