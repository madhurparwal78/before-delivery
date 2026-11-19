/** GET /api/search: bounded input, the anonymous rate limit, faceted queries in Meilisearch, and status read from Postgres. */
import type { SearchReply } from "../shared/api-types.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ALL_UNITS, STACK_LETTERS, STACKS, bandOf, facingOf } from "../shared/domain.js";
import { FIELD_MESSAGES, searchRateLimitMessage } from "../shared/copy.js";
import {
  FACET_NAMES,
  FACET_VALUES,
  PAGE_SIZE,
  emptyFilters,
  isValidLimit,
  validateFilters,
  type FacetName,
  type SearchFilters,
} from "../shared/search-rules.js";
import type { AppClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import type { Indexer } from "./indexer.js";
import { lapseAndNotify } from "./transitions.js";
import type { MediaSigner } from "./media.js";
import { SearchClient, SearchUnavailable } from "./meili.js";
import { UNIT_SELECT, isVisible, toPublicUnit, type UnitRow } from "./units.js";

const WINDOW_MS = 60_000;
const INDEX_FACET: Readonly<Record<FacetName, string>> = {
  bedrooms: "bedrooms",
  band: "band",
  facing: "facing",
  view: "viewTag",
  status: "status",
};

interface Position {
  readonly price: number;
  readonly floor: number;
  readonly stack: number;
}

interface Candidate extends Position {
  readonly code: string;
}

const before = (a: Position, b: Position): number => a.price - b.price || a.floor - b.floor || a.stack - b.stack;

/** Words of a unit that free text is matched against: code, facing, view tag and band. */
const WORDS: ReadonlyMap<string, readonly string[]> = (() => {
  const split = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const map = new Map<string, readonly string[]>();
  for (const unit of ALL_UNITS) {
    const spec = STACKS[unit.stack];
    map.set(unit.code, [
      ...split(unit.code),
      ...split(facingOf(spec.bearing)),
      ...split(spec.view(unit.floor)),
      ...split(bandOf(unit.floor)),
    ]);
  }
  return map;
})();

/** Codes whose words each start with every word of `q`; null when `q` has no words. */
const textMatches = (q: string): string[] | null => {
  const wanted = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (wanted.length === 0) return null;
  return [...WORDS].filter(([, words]) => wanted.every((w) => words.some((word) => word.startsWith(w)))).map(([code]) => code);
};

export class Search {
  private readonly secret: Buffer;

  constructor(
    private readonly db: Database,
    private readonly clock: AppClock,
    private readonly config: Config,
    private readonly client: SearchClient,
    private readonly indexer: Indexer,
    private readonly media: MediaSigner,
  ) {
    this.secret = createHmac("sha256", config.s3.secretAccessKey).update("highwater-search-cursor").digest();
  }

  /** Counts this request for an anonymous client (rejected ones too) and refuses it over the sliding-window limit. */
  async limitAnonymous(address: string): Promise<void> {
    const now = this.clock.now();
    const outcome = await this.db.tx<number | null>(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`search:${address}`]);
      await tx.query("DELETE FROM search_requests WHERE client = $1 AND at <= $2", [address, this.clock.plusSeconds(now, -WINDOW_MS / 1000)]);
      const window = await tx.query<{ at: Date }>("SELECT at FROM search_requests WHERE client = $1 ORDER BY at", [address]);
      await tx.query("INSERT INTO search_requests (client, at) VALUES ($1, $2)", [address, now]);
      const counted = window.rows.map((row) => row.at.getTime());
      if (counted.length < this.config.searchRateLimit) return null;
      counted.push(now.getTime());
      const leaving = counted[counted.length - this.config.searchRateLimit] as number;
      return Math.max(1, Math.ceil((leaving + WINDOW_MS - now.getTime()) / 1000));
    });
    if (outcome !== null) {
      throw new ApiError("search_rate_limited", searchRateLimitMessage(outcome), { retryAfterSeconds: outcome });
    }
  }

  private filterKey(filters: SearchFilters): string {
    return createHash("sha256").update(JSON.stringify(filters)).digest("hex").slice(0, 16);
  }

  private issueCursor(position: Position, filters: SearchFilters): string {
    const payload = Buffer.from(JSON.stringify([position.price, position.floor, position.stack, this.filterKey(filters)])).toString("base64url");
    return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`;
  }

  private readCursor(cursor: string, filters: SearchFilters): Position | null {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const [price, floor, stack, key] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as [number, number, number, string];
      return key === this.filterKey(filters) ? { price, floor, stack } : null;
    } catch {
      return null;
    }
  }

  private meiliFilter(filters: SearchFilters): string[] {
    const clauses: string[] = [];
    const matched = textMatches(filters.q);
    if (matched !== null) clauses.push(matched.length === 0 ? "floor < 0" : `code IN [${matched.map((code) => JSON.stringify(code)).join(", ")}]`);
    for (const name of FACET_NAMES) {
      const values = filters[name];
      if (values.length === 0) continue;
      const rendered = name === "bedrooms" ? values.join(", ") : values.map((value) => JSON.stringify(value)).join(", ");
      clauses.push(`${INDEX_FACET[name]} IN [${rendered}]`);
    }
    if (filters.priceMin !== "") clauses.push(`price >= ${filters.priceMin}`);
    if (filters.priceMax !== "") clauses.push(`price <= ${filters.priceMax}`);
    return clauses;
  }

  async run(params: URLSearchParams): Promise<SearchReply> {
    const filters = emptyFilters();
    filters.q = params.get("q") ?? "";
    for (const name of FACET_NAMES) filters[name] = params.getAll(name);
    filters.priceMin = params.get("priceMin") ?? "";
    filters.priceMax = params.get("priceMax") ?? "";
    const fields: Record<string, string> = { ...validateFilters(filters) };
    const limitText = params.get("limit");
    if (limitText !== null && !isValidLimit(limitText)) fields["limit"] = FIELD_MESSAGES.limit;
    const after = params.get("after");
    const position = after === null ? null : this.readCursor(after, filters);
    if (after !== null && position === null) fields["after"] = FIELD_MESSAGES.after;
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const pageSize = limitText === null ? PAGE_SIZE : Number(limitText);

    const freed = await lapseAndNotify(this.db, this.clock, this.indexer);
    if (freed.length > 0) await this.indexer.settle(freed, 500);

    let found;
    try {
      found = await this.client.search({
        q: "",
        filter: this.meiliFilter(filters),
        facets: [...FACET_NAMES.map((name) => INDEX_FACET[name]), "price"],
        sort: ["price:asc", "floor:asc", "stack:asc"],
        limit: 300,
        attributesToRetrieve: ["code", "price", "floor", "stack"],
      });
    } catch (error) {
      if (error instanceof SearchUnavailable) throw new ApiError("search_unavailable");
      throw error;
    }

    const indexed: Candidate[] = found.hits.map((hit) => ({
      code: String(hit["code"]),
      price: Number(hit["price"]),
      floor: Number(hit["floor"]),
      stack: STACK_LETTERS.indexOf(String(hit["stack"]) as (typeof STACK_LETTERS)[number]),
    }));
    const rows = await this.db.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = ANY($1)`, [indexed.map((hit) => hit.code)]);
    const live = new Map(rows.rows.filter(isVisible).map((row) => [row.code, row]));
    const matching = indexed.filter((hit) => live.has(hit.code)).sort(before);
    const rest = position === null ? matching : matching.filter((hit) => before(hit, position) > 0);
    const page = rest.slice(0, pageSize);
    const last = page[page.length - 1];
    const nextCursor = last !== undefined && rest.length > page.length ? this.issueCursor(last, filters) : null;

    const stats = found.facetStats?.["price"];
    return {
      total: matching.length,
      hits: page.map((hit) => toPublicUnit(live.get(hit.code) as UnitRow, this.media)),
      facets: this.facetCounts(found.facetDistribution ?? {}),
      priceStats: matching.length === 0 || !stats ? null : { min: stats.min, max: stats.max },
      matchingCodes: matching.map((hit) => hit.code),
      nextCursor,
    };
  }

  private facetCounts(distribution: Record<string, Record<string, number>>): Record<FacetName, Record<string, number>> {
    const counts = {} as Record<FacetName, Record<string, number>>;
    for (const name of FACET_NAMES) {
      const present = distribution[INDEX_FACET[name]] ?? {};
      counts[name] = Object.fromEntries(FACET_VALUES[name].map((value) => [value, present[value] ?? 0]));
    }
    return counts;
  }
}
