// The archive as visitors see it: only published items, in the published orders
// (brief: Business rules › Visibility, Ordering, Search, Sources).

import { one, pool, rows, type Db } from "./db.js";
import { viewpoints } from "../shared/sightline.js";
import type { ExhibitKey } from "../shared/exhibits.js";
import type { ItemStatus } from "../shared/lifecycle.js";

interface ChapterRow {
  id: string;
  number: number;
  numeral: string;
  title: string;
  era: string;
  sightline_deg: number;
  exhibit: ExhibitKey | null;
  body: string;
  status: ItemStatus;
  owner_email: string;
  publish_at: Date | null;
}

interface EventRow {
  id: string;
  chapter: number;
  year: number;
  title: string;
  summary: string;
  source_ids: string[];
  status: ItemStatus;
  owner_email: string;
  publish_at: Date | null;
}

const catalogueNumber = (numeral: string) => `HRR-${numeral}`;

export function publicEvent(e: EventRow) {
  return { id: e.id, year: e.year, title: e.title, summary: e.summary, chapter: e.chapter, source_ids: e.source_ids };
}

export function publicChapter(c: ChapterRow, resolved: boolean) {
  return {
    id: c.id,
    number: c.number,
    numeral: c.numeral,
    title: c.title,
    era: c.era,
    catalogue_number: catalogueNumber(c.numeral),
    sightline_deg: c.sightline_deg,
    resolved,
  };
}

export async function publishedChapters(db: Db = pool): Promise<ChapterRow[]> {
  return rows<ChapterRow>(db, "SELECT * FROM chapters WHERE status = 'published' ORDER BY number");
}

export async function publishedChapter(number: number): Promise<ChapterRow | undefined> {
  return one<ChapterRow>(pool, "SELECT * FROM chapters WHERE number = $1 AND status = 'published'", [number]);
}

/** Published events by year, then title (code-point order), optionally for one chapter. */
export async function publishedEvents(chapter?: number): Promise<EventRow[]> {
  return rows<EventRow>(
    pool,
    `SELECT e.* FROM events e JOIN chapters c ON c.number = e.chapter AND c.status = 'published'
     WHERE e.status = 'published' AND ($1::int IS NULL OR e.chapter = $1)
     ORDER BY e.year, e.title COLLATE "C", e.id`,
    [chapter ?? null],
  );
}

export async function chapterDetail(c: ChapterRow, resolved: boolean) {
  const media = await rows<{ id: string; kind: string; transcript: string | null; caption: string | null }>(
    pool,
    "SELECT id, kind, transcript, caption FROM media WHERE item_id = $1 AND kind IN ('narration', 'image') ORDER BY created_at DESC, position",
    [c.id],
  );
  const narration = media.find((m) => m.kind === "narration");
  const plates = media
    .filter((m) => m.kind === "image" && m.caption !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 3);
  return {
    ...publicChapter(c, resolved),
    body: c.body,
    viewpoints: viewpoints(c.sightline_deg),
    exhibit: c.exhibit,
    narration: narration ? { media_url: `/api/media/${narration.id}`, transcript: narration.transcript ?? "" } : null,
    plates: plates.map((p) => ({ media_url: `/api/media/${p.id}`, caption: p.caption ?? "" })),
    events: (await publishedEvents(c.number)).map(publicEvent),
  };
}

interface SearchResult {
  type: "chapter" | "event";
  id: string;
  title: string;
  chapter: number;
}

/** Case-insensitive substring over chapter titles and eras, event titles and summaries. */
export async function search(q: string, chapter?: number): Promise<SearchResult[]> {
  const needle = q.toLowerCase();
  const chapters = await rows<ChapterRow>(
    pool,
    `SELECT * FROM chapters WHERE status = 'published' AND ($2::int IS NULL OR number = $2)
     AND (strpos(lower(title), $1) > 0 OR strpos(lower(era), $1) > 0) ORDER BY number`,
    [needle, chapter ?? null],
  );
  const events = (await publishedEvents(chapter)).filter((e) => e.title.toLowerCase().includes(needle) || e.summary.toLowerCase().includes(needle));
  return [
    ...chapters.map((c) => ({ type: "chapter" as const, id: c.id, title: c.title, chapter: c.number })),
    ...events.map((e) => ({ type: "event" as const, id: e.id, title: e.title, chapter: e.chapter })),
  ];
}

export async function sources() {
  const all = await rows<{ id: string; citation: string }>(pool, "SELECT id, citation FROM sources ORDER BY n");
  const events = await publishedEvents();
  return all.map((s) => ({ id: s.id, citation: s.citation, cited_by: events.filter((e) => e.source_ids.includes(s.id)).map((e) => e.id) }));
}

/** The status of a chapter or event by its id, or undefined when there is none. */
export async function itemStatus(id: string): Promise<{ status: ItemStatus; title: string } | undefined> {
  return id.startsWith("chapter-")
    ? one(pool, "SELECT status, title FROM chapters WHERE id = $1", [id])
    : one(pool, "SELECT status, title FROM events WHERE id = $1", [id]);
}

/** Titles of the published items among `ids`. */
export async function publishedTitles(ids: string[]): Promise<Map<string, string>> {
  const found = await rows<{ id: string; title: string }>(
    pool,
    `SELECT id, title FROM chapters WHERE id = ANY($1) AND status = 'published'
     UNION ALL SELECT e.id, e.title FROM events e JOIN chapters c ON c.number = e.chapter AND c.status = 'published'
     WHERE e.id = ANY($1) AND e.status = 'published'`,
    [ids],
  );
  return new Map(found.map((r) => [r.id, r.title]));
}
