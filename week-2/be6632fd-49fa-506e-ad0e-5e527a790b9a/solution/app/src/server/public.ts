// Public drops: the calendar API, a drop's public payload and the sitemap (brief: API → Public drops).
import { COPY, FIELD } from "../shared/copy";
import { MARKETS, type Market, copenhagenToday, instantText, isMarket, isoDate, weekLabel, weekValue } from "../shared/time";
import { config } from "./config";
import { type Db, one, pool, rows } from "./db";
import { type DropRow, type DropStatus } from "./drops";
import { ApiError, type Json, notFound, reply, route, validationFailed } from "./http";
import { looksOf } from "./looks";
import { type MarketState, type MarketStatus, marketStates } from "./pieces";
import { danish } from "./stockists";
import { type Fields, failed } from "./validate";

interface PublicDropRow extends DropRow {
  brand: string;
}

function publicStatus(status: DropStatus): MarketStatus {
  return status === "scheduled" ? "upcoming" : status === "live" ? "live" : "sold_out";
}

/** A drop on a public surface: 410 once withdrawn, 404 while a draft or unknown. */
export async function publicDrop(db: Db, slug: string): Promise<PublicDropRow> {
  const drop = await one<PublicDropRow>(db, "SELECT d.*, w.name AS brand FROM drops d JOIN workspaces w ON w.id = d.workspace_id WHERE d.slug = $1", [slug]);
  if (!drop || drop.status === "draft") throw notFound();
  if (drop.status === "withdrawn") throw new ApiError(410, "drop_withdrawn", COPY.dropWithdrawnPublic);
  return drop;
}

function lookImageUrl(slug: string, lookId: string): string {
  return `/api/public/drops/${slug}/looks/${lookId}/image`;
}

route("GET", "/api/public/drops/{slug}", "none", async (ctx) => {
  const drop = await publicDrop(pool, ctx.params.slug);
  const markets = (await marketStates(pool, [drop.id])).get(drop.id) ?? [];
  const story = await one<{ published_html: string | null }>(pool, "SELECT published_html FROM stories WHERE drop_id = $1", [drop.id]);
  const looks = await looksOf(pool, drop.id);
  return reply(200, {
    slug: drop.slug,
    name: drop.name,
    brand: drop.brand,
    type: drop.type,
    status: publicStatus(drop.status),
    palette: drop.palette,
    storyHtml: story?.published_html ?? "",
    looks: looks.map((l) => ({ id: l.id, position: l.position, title: l.title, altText: l.altText, imageUrl: lookImageUrl(drop.slug, l.id), width: l.width, height: l.height })),
    markets: markets.map((m) => ({ market: m.market, city: m.city, goLiveAt: m.goLiveAt, status: m.status, piecesLeft: m.piecesLeft })),
  });
});

const SORTS = ["soonest", "latest", "name"] as const;
const STATUSES = ["upcoming", "live", "sold_out"] as const;

interface Listed {
  drop: PublicDropRow;
  markets: MarketState[];
  ms: number;
  status: MarketStatus;
  cover: string | null;
}

route("GET", "/api/public/drops", "none", async (ctx) => {
  const fields: Fields = {};
  const market = ctx.query("market") || null;
  const status = ctx.query("status") || null;
  const type = ctx.query("type") || null;
  const week = ctx.query("week") || null;
  const q = (ctx.query("q") ?? "").trim().toLowerCase();
  const sort = ctx.query("sort") || "soonest";
  const pageText = ctx.query("page") || "1";
  if (market && !isMarket(market)) fields.market = FIELD.market;
  if (status && !(STATUSES as readonly string[]).includes(status)) fields.status = "Choose upcoming, live or sold_out.";
  if (type && type !== "simultaneous" && type !== "rolling") fields.type = "Choose simultaneous or rolling.";
  if (week && !/^\d{4}-W\d{2}$/.test(week)) fields.week = "Enter a week like 2027-W11.";
  if (!(SORTS as readonly string[]).includes(sort)) fields.sort = "Choose soonest, latest or name.";
  if (!/^[1-9]\d{0,5}$/.test(pageText)) fields.page = "Enter a whole number from 1 to 999,999.";
  if (failed(fields)) throw validationFailed(fields);
  const page = Number(pageText);
  const drops = await rows<PublicDropRow>(
    pool,
    "SELECT d.*, w.name AS brand FROM drops d JOIN workspaces w ON w.id = d.workspace_id WHERE d.status IN ('scheduled', 'live', 'sold_out')",
  );
  const states = await marketStates(pool, drops.map((d) => d.id));
  const covers = new Map(
    (await rows<{ drop_id: string; id: string }>(pool, "SELECT DISTINCT ON (drop_id) drop_id, id FROM looks WHERE drop_id = ANY($1::uuid[]) ORDER BY drop_id, position", [drops.map((d) => d.id)])).map(
      (r) => [r.drop_id, r.id],
    ),
  );
  const listed: Listed[] = [];
  for (const drop of drops) {
    const markets = states.get(drop.id) ?? [];
    const chosen = market ? markets.find((m) => m.market === (market as Market)) : null;
    const instants = markets.map((m) => m.goLiveMs).filter((ms): ms is number => ms !== null);
    const ms = chosen ? chosen.goLiveMs : instants.length ? Math.min(...instants) : null;
    if (ms === null) continue;
    const cover = covers.get(drop.id);
    listed.push({ drop, markets, ms, status: chosen ? chosen.status : publicStatus(drop.status), cover: cover ? lookImageUrl(drop.slug, cover) : null });
  }
  const filtered = listed.filter(
    (l) =>
      (!q || l.drop.name.toLowerCase().includes(q) || l.drop.brand.toLowerCase().includes(q)) &&
      (!status || l.status === status) &&
      (!type || l.drop.type === type) &&
      (!week || weekValue(l.ms) === week),
  );
  filtered.sort((a, b) =>
    sort === "name" ? danish.compare(a.drop.name, b.drop.name) || a.ms - b.ms : sort === "latest" ? b.ms - a.ms || danish.compare(a.drop.name, b.drop.name) : a.ms - b.ms || danish.compare(a.drop.name, b.drop.name),
  );
  const items: Json[] = filtered.slice((page - 1) * 12, page * 12).map((l) => ({
    slug: l.drop.slug,
    name: l.drop.name,
    brand: l.drop.brand,
    type: l.drop.type,
    status: l.status,
    goLiveAt: instantText(l.ms),
    weekLabel: weekLabel(l.ms),
    palette: l.drop.palette,
    coverImageUrl: l.cover,
    markets: MARKETS.map((m) => l.markets.find((s) => s.market === m)).flatMap((s) => (s ? [{ market: s.market, city: s.city, goLiveAt: s.goLiveAt, status: s.status }] : [])),
  }));
  return reply(200, { items, page, pageSize: 12, total: filtered.length, todayCopenhagen: isoDate(copenhagenToday(Date.now())) });
});

route("GET", "/sitemap.xml", "none", async () => {
  const slugs = await rows<{ slug: string }>(pool, "SELECT slug FROM drops WHERE status IN ('scheduled', 'live', 'sold_out') ORDER BY slug");
  const urls = [`${config.publicUrl}/`, ...slugs.map((s) => `${config.publicUrl}/drops/${encodeURIComponent(s.slug)}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  return { status: 200, bytes: Buffer.from(xml), contentType: "application/xml; charset=utf-8" };
});
