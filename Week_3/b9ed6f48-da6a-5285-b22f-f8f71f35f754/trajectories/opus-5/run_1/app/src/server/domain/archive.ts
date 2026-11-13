import { query, queryOne } from '../db/index.js';
import { toLisbonIso } from '../../shared/lisbon.js';
import { numeralFor, viewpointsFor } from '../../shared/sightline.js';
import { isExhibitKey, type ExhibitKey } from '../../shared/exhibits.js';
import type { ItemStatus } from '../../shared/copy.js';
import type {
  ChapterDetail,
  ChapterSummary,
  CuratorItem,
  SearchResult,
  SourceRecord,
  TimelineEvent,
} from '../../shared/types.js';

export interface ChapterRow {
  number: number;
  numeral: string;
  title: string;
  era: string;
  body: string;
  sightline_deg: number;
  exhibit: string | null;
  status: ItemStatus;
  publish_at: Date | null;
  owner_email: string;
}

export interface EventRow {
  id: string;
  chapter: number;
  year: number;
  title: string;
  summary: string;
  source_ids: string[];
  status: ItemStatus;
  publish_at: Date | null;
  owner_email: string;
}

export interface MediaRow {
  id: string;
  kind: string;
  item_type: string;
  item_id: string;
  filename: string;
  bytes: number;
  content_type: string;
  object_key: string;
  transcript: string | null;
  caption: string | null;
  ordinal: number;
}

export const chapterId = (number: number): string => `chapter-${number}`;

export function catalogueNumber(numeral: string): string {
  return `HRR-${numeral}`;
}

const CHAPTER_COLUMNS =
  'number, numeral, title, era, body, sightline_deg, exhibit, status, publish_at, owner_email';
const EVENT_COLUMNS = 'id, chapter, year, title, summary, source_ids, status, publish_at, owner_email';

export async function publishedChapters(): Promise<ChapterRow[]> {
  return query<ChapterRow>(
    `SELECT ${CHAPTER_COLUMNS} FROM archive_chapters WHERE status = 'published' ORDER BY number`,
  );
}

export async function publishedChapter(number: number): Promise<ChapterRow | null> {
  return queryOne<ChapterRow>(
    `SELECT ${CHAPTER_COLUMNS} FROM archive_chapters WHERE number = $1 AND status = 'published'`,
    [number],
  );
}

export async function anyChapter(number: number): Promise<ChapterRow | null> {
  return queryOne<ChapterRow>(`SELECT ${CHAPTER_COLUMNS} FROM archive_chapters WHERE number = $1`, [number]);
}

/** Timeline and chapter events are ordered by year, then title. */
export async function publishedEvents(chapter: number | null): Promise<EventRow[]> {
  if (chapter === null) {
    return query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM timeline_events WHERE status = 'published' ORDER BY year, title`,
    );
  }
  return query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM timeline_events WHERE status = 'published' AND chapter = $1 ORDER BY year, title`,
    [chapter],
  );
}

export async function anyEvent(id: string): Promise<EventRow | null> {
  return queryOne<EventRow>(`SELECT ${EVENT_COLUMNS} FROM timeline_events WHERE id = $1`, [id]);
}

export function toChapterSummary(row: ChapterRow, resolved: boolean): ChapterSummary {
  return {
    id: chapterId(row.number),
    number: row.number,
    numeral: row.numeral,
    title: row.title,
    era: row.era,
    catalogue_number: catalogueNumber(row.numeral),
    sightline_deg: row.sightline_deg,
    resolved,
  };
}

export function toEventView(row: EventRow): TimelineEvent {
  return {
    id: row.id,
    year: row.year,
    title: row.title,
    summary: row.summary,
    chapter: row.chapter,
    source_ids: row.source_ids,
  };
}

export async function chapterMedia(number: number): Promise<MediaRow[]> {
  return query<MediaRow>(
    `SELECT id, kind, item_type, item_id, filename, bytes, content_type, object_key, transcript, caption, ordinal
     FROM media WHERE item_id = $1 ORDER BY ordinal, created_at`,
    [chapterId(number)],
  );
}

export async function mediaById(id: string): Promise<MediaRow | null> {
  return queryOne<MediaRow>(
    `SELECT id, kind, item_type, item_id, filename, bytes, content_type, object_key, transcript, caption, ordinal
     FROM media WHERE id = $1`,
    [id],
  );
}

export async function toChapterDetail(row: ChapterRow, resolved: boolean): Promise<ChapterDetail> {
  const media = await chapterMedia(row.number);
  const plates = media
    .filter((entry) => entry.kind === 'image')
    .slice(0, 3)
    .map((entry) => ({ media_url: `/api/media/${entry.id}`, caption: entry.caption ?? '' }));
  const narrations = media.filter((entry) => entry.kind === 'narration');
  const newest = narrations[narrations.length - 1];
  const events = await publishedEvents(row.number);
  return {
    ...toChapterSummary(row, resolved),
    body: row.body,
    viewpoints: viewpointsFor(row.sightline_deg),
    exhibit: isExhibitKey(row.exhibit) ? (row.exhibit as ExhibitKey) : null,
    narration: newest ? { media_url: `/api/media/${newest.id}`, transcript: newest.transcript ?? '' } : null,
    plates,
    events: events.map(toEventView),
  };
}

/**
 * Search matches published chapter titles and eras, and published event titles and
 * summaries, as a case-insensitive substring. Chapter bodies are not searched.
 */
export async function search(text: string, chapter: number | null): Promise<SearchResult[]> {
  const needle = text.toLowerCase();
  const chapters = (await publishedChapters()).filter(
    (row) =>
      (chapter === null || row.number === chapter) &&
      (row.title.toLowerCase().includes(needle) || row.era.toLowerCase().includes(needle)),
  );
  const events = (await publishedEvents(chapter)).filter(
    (row) => row.title.toLowerCase().includes(needle) || row.summary.toLowerCase().includes(needle),
  );
  return [
    ...chapters.map((row) => ({
      type: 'chapter' as const,
      id: chapterId(row.number),
      title: row.title,
      chapter: row.number,
    })),
    ...events.map((row) => ({ type: 'event' as const, id: row.id, title: row.title, chapter: row.chapter })),
  ];
}

export async function listSources(): Promise<SourceRecord[]> {
  const sources = await query<{ id: string; citation: string }>(
    `SELECT id, citation FROM sources ORDER BY ordinal, id`,
  );
  const events = await publishedEvents(null);
  return sources.map((source) => ({
    id: source.id,
    citation: source.citation,
    cited_by: events.filter((event) => event.source_ids.includes(source.id)).map((event) => event.id),
  }));
}

export async function nextSourceId(): Promise<{ id: string; ordinal: number }> {
  const row = await queryOne<{ highest: number }>(`SELECT COALESCE(MAX(ordinal), 0)::int AS highest FROM sources`);
  const ordinal = (row?.highest ?? 0) + 1;
  return { id: `src-${ordinal}`, ordinal };
}

/* ------------------------------------------------------------ studio items */

export async function listCuratorItems(filters: {
  type: 'chapter' | 'event' | null;
  status: ItemStatus | null;
}): Promise<CuratorItem[]> {
  const items: CuratorItem[] = [];
  if (filters.type !== 'event') {
    const rows = await query<ChapterRow>(`SELECT ${CHAPTER_COLUMNS} FROM archive_chapters ORDER BY number`);
    for (const row of rows) {
      if (filters.status && row.status !== filters.status) continue;
      items.push({
        id: chapterId(row.number),
        type: 'chapter',
        title: row.title,
        status: row.status,
        owner_email: row.owner_email,
        publish_at: row.publish_at ? toLisbonIso(row.publish_at.getTime()) : null,
        chapter: row.number,
      });
    }
  }
  if (filters.type !== 'chapter') {
    const rows = await query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM timeline_events ORDER BY chapter, year, title`,
    );
    for (const row of rows) {
      if (filters.status && row.status !== filters.status) continue;
      items.push({
        id: row.id,
        type: 'event',
        title: row.title,
        status: row.status,
        owner_email: row.owner_email,
        publish_at: row.publish_at ? toLisbonIso(row.publish_at.getTime()) : null,
        chapter: row.chapter,
      });
    }
  }
  return items;
}

export interface ItemHandle {
  id: string;
  type: 'chapter' | 'event';
  title: string;
  status: ItemStatus;
  ownerEmail: string;
  publishAt: Date | null;
  chapter: number;
}

export async function loadItem(id: string): Promise<ItemHandle | null> {
  if (id.startsWith('chapter-')) {
    const number = Number(id.slice('chapter-'.length));
    if (!Number.isInteger(number)) return null;
    const row = await anyChapter(number);
    if (!row) return null;
    return {
      id,
      type: 'chapter',
      title: row.title,
      status: row.status,
      ownerEmail: row.owner_email,
      publishAt: row.publish_at,
      chapter: row.number,
    };
  }
  const row = await anyEvent(id);
  if (!row) return null;
  return {
    id,
    type: 'event',
    title: row.title,
    status: row.status,
    ownerEmail: row.owner_email,
    publishAt: row.publish_at,
    chapter: row.chapter,
  };
}

export function toCuratorItem(handle: ItemHandle): CuratorItem {
  return {
    id: handle.id,
    type: handle.type,
    title: handle.title,
    status: handle.status,
    owner_email: handle.ownerEmail,
    publish_at: handle.publishAt ? toLisbonIso(handle.publishAt.getTime()) : null,
    chapter: handle.chapter,
  };
}
