import { one, query } from "../db.js";
import { fail, HttpError, invalid, notFound, sendBytes, sendJson } from "../http.js";
import { CONTENT_TYPES } from "../media.js";
import type { Context, Route } from "../router.js";
import { getObject, objectExists } from "../storage.js";
import { CREDIT_LABELS, LAYERS } from "../../shared/credits.js";
import { LINKABLE } from "../../shared/lifecycle.js";
import { linkStatus, PROJECT_COLUMNS, type ProjectRow, PUBLIC_STATION, type StemRow, stemsOf, thresholdsOf } from "./projects.js";

const CHECK_TTL_MS = 5000;
const existence = new Map<string, { exists: boolean; at: number }>();

/** Whether every stem object exists, checked against storage at most CHECK_TTL_MS before answering. */
async function storedNow(stems: StemRow[]): Promise<boolean> {
  const now = Date.now();
  const results = await Promise.all(stems.map(async (stem) => {
    const cached = existence.get(stem.object_key);
    if (cached && now - cached.at < CHECK_TTL_MS) return cached.exists;
    const exists = await objectExists(stem.object_key);
    existence.set(stem.object_key, { exists, at: now });
    return exists;
  }));
  return results.every(Boolean);
}

/** Stations for the given projects; playable only when storage answers and all four stems are stored. */
async function stations(rows: ProjectRow[], stemUrl: (stem: StemRow) => string) {
  const stems = await stemsOf(rows.map((row) => row.id));
  let reachable = true;
  const playable = new Map<string, boolean>();
  for (const row of rows) {
    const list = stems.get(row.id) ?? [];
    let ready = list.length === LAYERS.length;
    if (ready && reachable) {
      try {
        ready = await storedNow(list);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        reachable = false;
      }
    }
    playable.set(row.id, ready && reachable);
  }
  return rows.map((row) => {
    const isPlayable = playable.get(row.id) ?? false;
    return {
      slug: row.slug,
      title: row.title,
      credit_type: row.credit_type,
      credit_label: CREDIT_LABELS[row.credit_type],
      credit_line: row.credit_line,
      role: row.role,
      blurb: row.blurb,
      tags: row.tags,
      thresholds: thresholdsOf(row),
      playable: isPlayable,
      stems: isPlayable ? (stems.get(row.id) ?? []).map((stem) => ({ id: stem.id, layer: stem.layer, url: stemUrl(stem) })) : [],
    };
  });
}

async function journey({ res }: Context): Promise<void> {
  const rows = await query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE ${PUBLIC_STATION} ORDER BY p.position, p.title`);
  sendJson(res, 200, { stations: await stations(rows, (stem) => `/api/stems/${stem.id}`) });
}

async function search({ res, url }: Context): Promise<void> {
  const q = url.searchParams.get("q");
  if (!q || [...q].length > 100 || q.includes("\u0000")) invalid({ q: "Enter 1 to 100 characters to search for." });
  const rows = await query<{ slug: string; title: string; credit_type: ProjectRow["credit_type"] }>(
    `SELECT p.slug, p.title, p.credit_type FROM projects p
     WHERE ${PUBLIC_STATION} AND (
       strpos(lower(p.title), lower($1)) > 0 OR strpos(lower(p.credit_line), lower($1)) > 0
       OR strpos(lower(p.blurb), lower($1)) > 0
       OR EXISTS (SELECT 1 FROM unnest(p.tags) tag WHERE strpos(lower(tag), lower($1)) > 0))
     ORDER BY p.position, p.title`,
    [q],
  );
  sendJson(res, 200, {
    results: rows.map((row) => ({ slug: row.slug, title: row.title, credit_label: CREDIT_LABELS[row.credit_type] })),
  });
}

async function sendStem(res: Context["res"], stem: StemRow | undefined, headers: Record<string, string>): Promise<void> {
  if (!stem) notFound();
  const bytes = await getObject(stem.object_key);
  if (!bytes) notFound();
  sendBytes(res, CONTENT_TYPES[stem.format], bytes, headers);
}

const STEM_COLUMNS = "s.id, s.project_id, s.layer, s.format, s.bytes, s.duration_ms, s.object_key";

async function publicStem({ res, params }: Context): Promise<void> {
  const id = params.id ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const stem = await one<StemRow>(
    `SELECT ${STEM_COLUMNS} FROM stems s JOIN projects p ON p.id = s.project_id WHERE s.id = $1 AND ${PUBLIC_STATION}`,
    [id],
  );
  await sendStem(res, stem, { "Cache-Control": "no-cache" });
}

interface LiveLink {
  project: ProjectRow;
  expires_at: Date;
  nda: boolean;
}

/** The project behind a live token: 404 when unknown, revoked or out of scope; 410 from the expiry instant. */
export async function liveLink(token: string): Promise<LiveLink> {
  const row = await one<ProjectRow & { expires_at: Date; revoked_at: Date | null }>(
    `SELECT ${PROJECT_COLUMNS}, l.expires_at, l.revoked_at FROM listening_links l JOIN projects p ON p.id = l.project_id
     WHERE l.token = $1`,
    [token],
  );
  if (!row || !LINKABLE.includes(row.status)) notFound();
  const status = linkStatus(row);
  if (status === "revoked") notFound();
  if (status === "expired") fail(410, "link_expired", "This listening link has expired.");
  return { project: row, expires_at: row.expires_at, nda: row.visibility === "nda" };
}

async function listen({ res, params }: Context): Promise<void> {
  const token = params.token ?? "";
  const link = await liveLink(token);
  const [station] = await stations([link.project], (stem) => `/api/listen/${encodeURIComponent(token)}/stems/${stem.id}`);
  sendJson(res, 200, { station, expires_at: link.expires_at.toISOString(), nda: link.nda });
}

async function listenStem({ res, params }: Context): Promise<void> {
  const link = await liveLink(params.token ?? "");
  const id = params.id ?? "";
  const stem = /^[0-9a-f-]{36}$/i.test(id)
    ? await one<StemRow>(`SELECT ${STEM_COLUMNS} FROM stems s WHERE s.id = $1 AND s.project_id = $2`, [id, link.project.id])
    : undefined;
  await sendStem(res, stem, {});
}

export const journeyRoutes: Route[] = [
  { pattern: "/api/journey", methods: { GET: { handler: journey } } },
  { pattern: "/api/search", methods: { GET: { handler: search } } },
  { pattern: "/api/stems/:id", methods: { GET: { handler: publicStem } } },
  { pattern: "/api/listen/:token", methods: { GET: { handler: listen } }, readOnly: true },
  { pattern: "/api/listen/:token/stems/:id", methods: { GET: { handler: listenStem } }, readOnly: true },
];
