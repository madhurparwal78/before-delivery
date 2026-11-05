import { config } from "./config.js";
import { ApiError } from "./http.js";

export type ContentKind = "sessions" | "hospitality" | "hotels" | "faq";

const COLLECTIONS: Record<ContentKind, string> = {
  sessions: "agenda_sessions",
  hospitality: "hospitality_events",
  hotels: "hotels",
  faq: "faq_entries",
};

const SCHEMAS: Record<ContentKind, { name: string; type: "number" | "text" }[]> = {
  sessions: [
    { name: "number", type: "number" },
    { name: "day", type: "number" },
    { name: "title", type: "text" },
    { name: "format", type: "text" },
    { name: "minutes", type: "number" },
    { name: "outcomes", type: "text" },
  ],
  hospitality: [
    { name: "title", type: "text" },
    { name: "day", type: "number" },
    { name: "starts_at", type: "text" },
    { name: "venue", type: "text" },
    { name: "tier", type: "text" },
    { name: "description", type: "text" },
  ],
  hotels: [
    { name: "name", type: "text" },
    { name: "distance", type: "text" },
    { name: "rate", type: "text" },
    { name: "map_url", type: "text" },
  ],
  faq: [
    { name: "question", type: "text" },
    { name: "answer", type: "text" },
    { name: "sort", type: "number" },
  ],
};

export type ContentRecord = Record<string, string | number> & { id: string };

const SEED: Record<ContentKind, Record<string, string | number>[]> = {
  sessions: [
    { number: 1, day: 1, format: "lecture", minutes: 90, title: "Shade and translucency mapping", outcomes: "Read chroma, value and translucency zones on a natural incisor" },
    { number: 2, day: 1, format: "hands-on", minutes: 150, title: "Palatal shell from a silicone index", outcomes: "Build a thin, even palatal shell from a wax-up index" },
    { number: 3, day: 1, format: "lecture", minutes: 60, title: "Dentin mamelons and internal effects", outcomes: "Plan mamelon shape and halo before layering" },
    { number: 4, day: 1, format: "hands-on", minutes: 180, title: "Class IV layering on the typodont", outcomes: "Layer dentin, effects and enamel to a natural incisal edge" },
    { number: 5, day: 2, format: "lecture", minutes: 60, title: "Posterior anatomy and occlusal stamping", outcomes: "Choose between freehand anatomy and occlusal stamps" },
    { number: 6, day: 2, format: "hands-on", minutes: 180, title: "Class II with sectional matrices", outcomes: "Place tight contacts with sectional rings and wedges" },
    { number: 7, day: 2, format: "lecture", minutes: 60, title: "Finishing and polishing sequence", outcomes: "Order discs, rubbers and pastes for lasting gloss" },
    { number: 8, day: 2, format: "hands-on", minutes: 180, title: "Polish to gloss and photograph", outcomes: "Finish to gloss and record cross-polarised photographs" },
  ],
  hospitality: [
    { title: "Welcome reception", day: 1, starts_at: "18:30", venue: "The Opaline Lab foyer", tier: "all", description: "Drinks and small plates with the instructor" },
    { title: "Atelier dinner with the instructor", day: 1, starts_at: "20:00", venue: "Larkspur Room, West Loop", tier: "atelier", description: "A seated tasting menu for Atelier guests and the course director" },
    { title: "Bench breakfast", day: 2, starts_at: "07:30", venue: "The Opaline Lab foyer", tier: "all", description: "Coffee and pastries before the lab opens" },
  ],
  hotels: [
    { name: "Fulton Rail Hotel", distance: "0.4 miles", rate: "from $289 a night", map_url: "https://maps.example.com/fulton-rail-hotel" },
    { name: "Kinzie Loft Suites", distance: "0.7 miles", rate: "from $245 a night", map_url: "https://maps.example.com/kinzie-loft-suites" },
  ],
  faq: [
    { sort: 1, question: "What should I bring?", answer: "Your own loupes. Typodonts, composites, instruments and curing lights are provided at every bench." },
    { sort: 2, question: "How are CE credits awarded?", answer: "Credits are issued after both days of check-in and a matched licence on file." },
    { sort: 3, question: "Can my clinic buy several seats?", answer: "Yes. A clinic account can hold up to six benches at once and pays one group invoice." },
    { sort: 4, question: "What is the difference between Bench and Atelier?", answer: "Atelier seats sit in rows A and B nearest the demo station and include the Atelier dinner." },
  ],
};

/** Fixed 15-character seed ids, so a second process seeding at the same moment is refused, not duplicated. */
function seedId(kind: ContentKind, index: number): string {
  return `ob${kind.slice(0, 4)}${String(index + 1).padStart(15 - 2 - kind.slice(0, 4).length, "0")}`;
}

function unavailable(): ApiError {
  return new ApiError(503, "content_unavailable", "The programme is loading slowly. Refresh in a moment.");
}

let token = "";

async function call(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  if (!token) await authenticate();
  let response: Response;
  try {
    response = await fetch(`${config.pocketbase.url}${path}`, {
      method,
      headers: { Authorization: token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw unavailable();
  }
  if ((response.status === 401 || response.status === 403) && retry) {
    token = "";
    return call(method, path, body, false);
  }
  if (response.status >= 500) throw unavailable();
  return response;
}

async function authenticate(): Promise<void> {
  try {
    const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw unavailable();
    token = ((await response.json()) as { token: string }).token;
  } catch {
    throw unavailable();
  }
}

let collectionsReady: Promise<void> | null = null;

/** Creates the four collections when missing and seeds each one that is empty. Idempotent across processes. */
export function ensureCollections(): Promise<void> {
  collectionsReady ??= (async () => {
    for (const kind of Object.keys(COLLECTIONS) as ContentKind[]) {
      const name = COLLECTIONS[kind];
      const existing = await call("GET", `/api/collections/${name}`);
      if (existing.status === 404) {
        await call("POST", "/api/collections", {
          name,
          type: "base",
          schema: SCHEMAS[kind].map((field) => ({ name: field.name, type: field.type, required: false, options: {} })),
        });
        const created = await call("GET", `/api/collections/${name}`);
        if (!created.ok) throw unavailable();
      } else if (!existing.ok) {
        throw unavailable();
      }
      const page = await call("GET", `/api/collections/${name}/records?perPage=1`);
      if (!page.ok) throw unavailable();
      if (((await page.json()) as { totalItems: number }).totalItems === 0) {
        for (const [index, record] of SEED[kind].entries()) {
          await call("POST", `/api/collections/${name}/records`, { id: seedId(kind, index), ...record });
        }
      }
    }
  })().catch((error: unknown) => {
    collectionsReady = null;
    throw error;
  });
  return collectionsReady;
}

function pick(kind: ContentKind, raw: Record<string, unknown>): ContentRecord {
  const record: ContentRecord = { id: String(raw.id) };
  for (const field of SCHEMAS[kind]) {
    const value = raw[field.name];
    record[field.name] = field.type === "number" ? Number(value ?? 0) : String(value ?? "");
  }
  return record;
}

export async function listRecords(kind: ContentKind): Promise<ContentRecord[]> {
  await ensureCollections();
  const response = await call("GET", `/api/collections/${COLLECTIONS[kind]}/records?perPage=500&sort=created`);
  if (!response.ok) throw unavailable();
  const page = (await response.json()) as { items: Record<string, unknown>[] };
  return page.items.map((item) => pick(kind, item));
}

export async function createRecord(kind: ContentKind, fields: Record<string, string | number>): Promise<ContentRecord> {
  const response = await call("POST", `/api/collections/${COLLECTIONS[kind]}/records`, fields);
  if (!response.ok) throw unavailable();
  return pick(kind, (await response.json()) as Record<string, unknown>);
}

export async function updateRecord(kind: ContentKind, id: string, fields: Record<string, string | number>): Promise<ContentRecord> {
  const response = await call("PATCH", `/api/collections/${COLLECTIONS[kind]}/records/${encodeURIComponent(id)}`, fields);
  if (!response.ok) throw unavailable();
  return pick(kind, (await response.json()) as Record<string, unknown>);
}

export async function deleteRecord(kind: ContentKind, id: string): Promise<void> {
  const response = await call("DELETE", `/api/collections/${COLLECTIONS[kind]}/records/${encodeURIComponent(id)}`);
  if (!response.ok && response.status !== 404) throw unavailable();
}
