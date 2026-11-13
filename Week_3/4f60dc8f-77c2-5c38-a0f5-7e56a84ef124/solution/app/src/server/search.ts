// Meilisearch: the studio_content index of published case studies, services and insights.
import { config } from "./config.js";
import { caseStudies, insights, services, type CaseStudy, type Insight, type Service } from "./content.js";
import { ApiError } from "./errors.js";
import { formatMoney } from "../shared/money.js";

const INDEX = "studio_content";
type SearchDocument = { id: string; kind: "case_study" | "service" | "insight"; title: string; summary: string; url: string };
type SearchHit = Omit<SearchDocument, "id">;

async function meili(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${config.meilisearch.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.meilisearch.apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError("search_unavailable");
  }
  const text = await response.text();
  if (response.status >= 500) throw new ApiError("search_unavailable");
  return { status: response.status, json: text ? (JSON.parse(text) as unknown) : null };
}

async function settle(task: unknown): Promise<void> {
  const uid = (task as { taskUid?: number } | null)?.taskUid;
  if (uid === undefined) return;
  for (let i = 0; i < 100; i++) {
    const status = (await meili("GET", `/tasks/${uid}`)).json as { status: string };
    if (status.status === "succeeded" || status.status === "failed" || status.status === "canceled") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const caseStudyDocument = (study: CaseStudy): SearchDocument => ({
  id: `case_study-${study.slug}`,
  kind: "case_study",
  title: study.title,
  summary: study.summary,
  url: `/work/${study.slug}`,
});

const serviceDocument = (service: Service): SearchDocument => ({
  id: `service-${service.code}`,
  kind: "service",
  title: service.title,
  summary: `${formatMoney(service.list_price_pence, "GBP")} per colourway`,
  url: "/#services",
});

const insightDocument = (insight: Insight): SearchDocument => ({
  id: `insight-${insight.slug}`,
  kind: "insight",
  title: insight.title,
  summary: insight.summary,
  url: `/#insight-${insight.slug}`,
});

/** Rebuilds the index from PocketBase: published records in, everything else out. Idempotent. */
export async function rebuildIndex(): Promise<void> {
  const index = await meili("GET", `/indexes/${INDEX}`);
  if (index.status === 404) await settle((await meili("POST", "/indexes", { uid: INDEX, primaryKey: "id" })).json);
  await settle((await meili("PATCH", `/indexes/${INDEX}/settings`, { searchableAttributes: ["title", "summary"] })).json);
  const documents = [
    ...(await caseStudies(true)).map(caseStudyDocument),
    ...(await services()).map(serviceDocument),
    ...(await insights()).map(insightDocument),
  ];
  await settle((await meili("PUT", `/indexes/${INDEX}/documents?primaryKey=id`, documents)).json);
  const wanted = new Set(documents.map((d) => d.id));
  const stored = (await meili("GET", `/indexes/${INDEX}/documents?limit=10000&fields=id`)).json as { results: { id: string }[] };
  const stale = stored.results.map((d) => d.id).filter((id) => !wanted.has(id));
  if (stale.length) await settle((await meili("POST", `/indexes/${INDEX}/documents/delete-batch`, stale)).json);
}

export async function indexCaseStudy(study: CaseStudy): Promise<void> {
  if (study.published) await settle((await meili("PUT", `/indexes/${INDEX}/documents?primaryKey=id`, [caseStudyDocument(study)])).json);
  else await settle((await meili("DELETE", `/indexes/${INDEX}/documents/${encodeURIComponent(`case_study-${study.slug}`)}`)).json);
}

export async function indexService(service: Service): Promise<void> {
  await settle((await meili("PUT", `/indexes/${INDEX}/documents?primaryKey=id`, [serviceDocument(service)])).json);
}

export async function search(query: string): Promise<SearchHit[]> {
  if (!query) return [];
  const response = await meili("POST", `/indexes/${INDEX}/search`, { q: query, limit: 20 });
  if (response.status !== 200) throw new ApiError("search_unavailable");
  return (response.json as { hits: SearchDocument[] }).hits.map(({ kind, title, summary, url }) => ({ kind, title, summary, url }));
}

export async function searchReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.meilisearch.url}/health`, { signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
