import { all, pool } from "./db.js";
import { publicNotFound, fail, validation } from "./errors.js";
import { config } from "./config.js";
import { serviceState } from "./probes.js";
import {
  subjects,
  sections,
  claimOrder,
  comparators,
  difference,
  offices,
  regions,
  benefitsInForce,
} from "./domain.js";
import { sampleDefinitions, sampleRoute } from "./media.js";
import { theses } from "./seed.js";
import type {
  Content,
  BenchmarkRow,
  ModelRoute,
  NewsPost,
  Home,
  Newsroom,
  PublicRole,
  Requisition,
  Benefits,
  PublicClaim,
  PublicBenchmarkRow,
} from "./types.js";
// The record as of an instant: published at or before it and not withdrawn since.
async function published(asOf?: string | null): Promise<Content[]> {
  return (
    await pool.query<{ data: Content }>(
      "SELECT c.data FROM content c JOIN publication_history h ON h.content_id=c.id WHERE c.status='published' AND h.withdrawn_at IS NULL AND ($1::timestamptz IS NULL OR h.published_at<=$1::timestamptz) ORDER BY h.published_at DESC,c.slug",
      [asOf ?? null],
    )
  ).rows.map((r) => r.data);
}
export function parseAsOf(value: string | null): string | null {
  if (value === null) return null;
  const valid =
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) + "Z" === value &&
    Date.parse(value) <= Date.now();
  if (!valid)
    validation({
      as_of: "Choose a past instant in the form YYYY-MM-DDTHH:mm:ssZ.",
    });
  return value;
}
const asOfKey = (asOf?: string | null): { as_of?: string } =>
  asOf ? { as_of: asOf } : {};
export async function publicContent(
  kind: "model" | "news",
  slug: string,
  asOf?: string | null,
): Promise<Content> {
  const item = (
    await pool.query<{ data: Content; ever: boolean }>(
      "SELECT c.data, h.content_id IS NOT NULL AS ever FROM content c LEFT JOIN publication_history h ON h.content_id=c.id WHERE c.kind=$1 AND c.slug=$2",
      [kind, slug],
    )
  ).rows[0];
  if (item?.data.status === "withdrawn" && item.ever)
    fail(410, "gone", "This item has been withdrawn.");
  if (
    !item ||
    item.data.status !== "published" ||
    (asOf && Date.parse(item.data.published_at!) > Date.parse(asOf))
  )
    publicNotFound();
  return item.data;
}
export async function homeData(): Promise<Home> {
  const items = await published();
  return {
    theses,
    rail: items
      .sort(
        (a, b) =>
          b.published_at!.localeCompare(a.published_at!) ||
          (a.kind === b.kind
            ? a.title.localeCompare(b.title)
            : a.kind === "model"
              ? -1
              : 1),
      )
      .slice(0, 5)
      .map((c) => ({
        kind: c.kind,
        slug: c.slug,
        title: c.title,
        published_at: c.published_at!,
        url: `/${c.kind === "model" ? "models" : "news"}/${c.slug}`,
      })),
  };
}
export async function modelsData(asOf?: string | null): Promise<{
  items: {
    slug: string;
    title: string;
    summary: string;
    published_at: string;
  }[];
  as_of?: string;
}> {
  return {
    ...asOfKey(asOf),
    items: (await published(asOf))
      .filter((c) => c.kind === "model")
      .map((c) => ({
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        published_at: c.published_at!,
      })),
  };
}
export async function modelData(
  slug: string,
  asOf?: string | null,
): Promise<ModelRoute> {
  const c = await publicContent("model", slug, asOf);
  // Names come from the route and the comparator register as they stand now.
  const allRows = (await all<BenchmarkRow>(pool, "benchmark_rows")).map(
    (r): PublicBenchmarkRow => ({
      id: r.id,
      subject: r.subject,
      subject_name:
        r.subject === slug
          ? c.title
          : comparators[r.subject]?.name || r.subject,
      organisation:
        r.subject === slug
          ? "Aldermoor Labs"
          : comparators[r.subject]?.organisation || "",
      benchmark: r.benchmark,
      eval_date: r.eval_date,
      score: r.score,
    }),
  );
  const own = allRows.filter((r) => r.subject === slug);
  const rows = own
    .sort(
      (a, b) =>
        a.benchmark.localeCompare(b.benchmark) ||
        a.eval_date.localeCompare(b.eval_date),
    )
    .flatMap((r) => [
      r,
      ...allRows
        .filter(
          (other) =>
            comparators[other.subject] &&
            other.benchmark === r.benchmark &&
            other.eval_date === r.eval_date,
        )
        .sort((a, b) => a.subject_name.localeCompare(b.subject_name)),
    ]);
  const claims: PublicClaim[] = claimOrder(c).map((claim, i) => {
    const model = rows.find(
      (r) =>
        r.subject === slug &&
        r.benchmark === claim.benchmark &&
        r.eval_date === claim.eval_date,
    )!;
    const comparator = rows.find(
      (r) =>
        r.subject === claim.comparator &&
        r.benchmark === claim.benchmark &&
        r.eval_date === claim.eval_date,
    )!;
    return {
      id: claim.id,
      number: i + 1,
      text: claim.text,
      benchmark: claim.benchmark,
      eval_date: claim.eval_date,
      model_row_id: model.id,
      comparator_row_id: comparator.id,
      delta: difference(model.score, comparator.score),
    };
  });
  const hasSamples = slug === sampleRoute;
  const available = !hasSamples || serviceState().storage;
  const linked = (await published(asOf)).find(
    (n) => n.kind === "news" && n.slug === c.linked_news_slug,
  );
  return {
    slug,
    title: c.title,
    summary: c.summary,
    published_at: c.published_at!,
    read_time_minutes: c.read_time_minutes!,
    organisation: "Aldermoor Labs",
    sections: sections(c.body),
    body: c.body,
    claims,
    rows,
    samples: hasSamples && available ? sampleDefinitions : [],
    ...(!available ? { samples_available: false } : {}),
    linked_news: linked ? { slug: linked.slug, title: linked.title } : null,
    ...asOfKey(asOf),
  };
}
export async function newsData(
  slug: string,
  asOf?: string | null,
): Promise<NewsPost> {
  const c = await publicContent("news", slug, asOf);
  const linked = (await published(asOf)).find(
    (m) => m.kind === "model" && m.linked_news_slug === slug,
  );
  return {
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    subject: c.subject!,
    tags: c.tags!,
    published_at: c.published_at!,
    read_time_minutes: c.read_time_minutes!,
    body: c.body,
    linked_model: linked ? { slug: linked.slug, title: linked.title } : null,
    ...asOfKey(asOf),
  };
}
export async function newsroomData(query: URLSearchParams): Promise<Newsroom> {
  const asOf = parseAsOf(query.get("as_of"));
  const posts = (await published(asOf)).filter((c) => c.kind === "news");
  const subject = query.get("subject"),
    tag = query.get("tag");
  const tagged = posts.filter((c) => !tag || c.tags?.includes(tag));
  const subjected = posts.filter((c) => !subject || c.subject === subject);
  const match = posts.filter(
    (c) =>
      (!subject || c.subject === subject) && (!tag || c.tags?.includes(tag)),
  );
  const p = query.get("page") || "";
  const page = /^[1-9]\d*$/.test(p) ? Number(p) : 1;
  return {
    items: match.slice((page - 1) * 10, page * 10).map((c) => ({
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      subject: c.subject!,
      tags: c.tags!,
      published_at: c.published_at!,
      read_time_minutes: c.read_time_minutes!,
    })),
    facets: {
      subjects: Object.entries(subjects).map(([value, label]) => ({
        value,
        label,
        count: tagged.filter((c) => c.subject === value).length,
      })),
      tags: [...new Set(posts.flatMap((c) => c.tags || []))]
        .sort()
        .map((value) => ({
          value,
          count: subjected.filter((c) => c.tags?.includes(value)).length,
        })),
    },
    page,
    pages: Math.max(1, Math.ceil(match.length / 10)),
    total: match.length,
    ...asOfKey(asOf),
  };
}
function publicRole(r: Requisition): PublicRole {
  const office = offices[r.office];
  return {
    slug: r.slug,
    title: r.title,
    discipline: r.discipline,
    office: r.office,
    office_label: office.label,
    region: office.region,
    region_label: regions[office.region],
    opened_at: r.opened_at!,
  };
}
export async function rolesData(
  query: URLSearchParams,
): Promise<{ items: PublicRole[] }> {
  return {
    items: (await all<Requisition>(pool, "requisitions"))
      .filter((r) => r.status === "open")
      .map(publicRole)
      .filter((r) =>
        ["discipline", "office", "region"].every(
          (key) =>
            !query.get(key) ||
            r[key as "discipline" | "office" | "region"] === query.get(key),
        ),
      )
      .sort(
        (a, b) =>
          b.opened_at.localeCompare(a.opened_at) ||
          a.title.localeCompare(b.title),
      ),
  };
}
type PublicBenefits = Pick<Benefits, "id" | "effective_from" | "summary">;
const benefitsShape = (e: Benefits | null): PublicBenefits | null =>
  e && { id: e.id, effective_from: e.effective_from, summary: e.summary };
export async function roleData(slug: string): Promise<PublicRole> {
  const r = (
    await pool.query<{ data: Requisition }>(
      "SELECT data FROM requisitions WHERE slug=$1",
      [slug],
    )
  ).rows[0]?.data;
  if (!r || r.status === "draft") publicNotFound();
  if (r.status === "closed") fail(410, "gone", "This role has closed.");
  const role = publicRole(r);
  return {
    ...role,
    description: r.description,
    benefits: benefitsShape(
      benefitsInForce(await all<Benefits>(pool, "benefits"), role.region),
    ),
  };
}
export async function benefitsData(): Promise<{
  regions: { region: string; label: string; entry: PublicBenefits | null }[];
}> {
  const entries = await all<Benefits>(pool, "benefits");
  return {
    regions: Object.entries(regions).map(([region, label]) => ({
      region,
      label,
      entry: benefitsShape(benefitsInForce(entries, region)),
    })),
  };
}
const xmlEscape = (v: string): string =>
  v.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function feed(): Promise<string> {
  const origin = config.publicBaseUrl;
  const posts = (await published()).filter((c) => c.kind === "news");
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xmlEscape(origin)}/feed.xml</id><title>Aldermoor Labs Open Record</title><updated>${posts[0]?.published_at || "2026-01-01T00:00:00Z"}</updated>${posts.map((c) => `<entry><id>${xmlEscape(origin)}/news/${c.slug}</id><title>${xmlEscape(c.title)}</title><link href="${xmlEscape(origin)}/news/${c.slug}"/><updated>${c.published_at}</updated><summary>${xmlEscape(c.summary)}</summary></entry>`).join("")}</feed>`;
}
export async function sitemap(): Promise<string> {
  const origin = config.publicBaseUrl;
  const paths = [
    "/",
    "/models",
    "/news",
    "/search",
    "/careers",
    ...(await published()).map(
      (c) => `/${c.kind === "model" ? "models" : "news"}/${c.slug}`,
    ),
    ...(await rolesData(new URLSearchParams())).items.map(
      (r) => `/careers/${r.slug}`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xmlEscape(origin + path)}</loc></url>`).join("")}</urlset>`;
}
