// The archive as visitors see it: only published items, in the published orders
// (brief: Business rules › Visibility, Ordering, Search, Sources).
import { one, pool, rows } from "./db.js";
import { viewpoints } from "../shared/sightline.js";
const catalogueNumber = (numeral) => `HRR-${numeral}`;
export function publicEvent(e) {
    return { id: e.id, year: e.year, title: e.title, summary: e.summary, chapter: e.chapter, source_ids: e.source_ids };
}
export function publicChapter(c, resolved) {
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
export async function publishedChapters(db = pool) {
    return rows(db, "SELECT * FROM chapters WHERE status = 'published' ORDER BY number");
}
export async function publishedChapter(number) {
    return one(pool, "SELECT * FROM chapters WHERE number = $1 AND status = 'published'", [number]);
}
/** Published events by year, then title (code-point order), optionally for one chapter. */
export async function publishedEvents(chapter) {
    return rows(pool, `SELECT e.* FROM events e JOIN chapters c ON c.number = e.chapter AND c.status = 'published'
     WHERE e.status = 'published' AND ($1::int IS NULL OR e.chapter = $1)
     ORDER BY e.year, e.title COLLATE "C", e.id`, [chapter ?? null]);
}
export async function chapterDetail(c, resolved) {
    const media = await rows(pool, "SELECT id, kind, transcript, caption FROM media WHERE item_id = $1 AND kind IN ('narration', 'image') ORDER BY created_at DESC, position", [c.id]);
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
/** Case-insensitive substring over chapter titles and eras, event titles and summaries. */
export async function search(q, chapter) {
    const needle = q.toLowerCase();
    const chapters = await rows(pool, `SELECT * FROM chapters WHERE status = 'published' AND ($2::int IS NULL OR number = $2)
     AND (strpos(lower(title), $1) > 0 OR strpos(lower(era), $1) > 0) ORDER BY number`, [needle, chapter ?? null]);
    const events = (await publishedEvents(chapter)).filter((e) => e.title.toLowerCase().includes(needle) || e.summary.toLowerCase().includes(needle));
    return [
        ...chapters.map((c) => ({ type: "chapter", id: c.id, title: c.title, chapter: c.number })),
        ...events.map((e) => ({ type: "event", id: e.id, title: e.title, chapter: e.chapter })),
    ];
}
export async function sources() {
    const all = await rows(pool, "SELECT id, citation FROM sources ORDER BY n");
    const events = await publishedEvents();
    return all.map((s) => ({ id: s.id, citation: s.citation, cited_by: events.filter((e) => e.source_ids.includes(s.id)).map((e) => e.id) }));
}
/** The status of a chapter or event by its id, or undefined when there is none. */
export async function itemStatus(id) {
    return id.startsWith("chapter-")
        ? one(pool, "SELECT status, title FROM chapters WHERE id = $1", [id])
        : one(pool, "SELECT status, title FROM events WHERE id = $1", [id]);
}
/** Titles of the published items among `ids`. */
export async function publishedTitles(ids) {
    const found = await rows(pool, `SELECT id, title FROM chapters WHERE id = ANY($1) AND status = 'published'
     UNION ALL SELECT e.id, e.title FROM events e JOIN chapters c ON c.number = e.chapter AND c.status = 'published'
     WHERE e.id = ANY($1) AND e.status = 'published'`, [ids]);
    return new Map(found.map((r) => [r.id, r.title]));
}
