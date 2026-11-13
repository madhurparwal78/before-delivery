import type { App, User } from './app.ts';
import { requireUser } from './platform.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson } from './http.ts';
import { alignment, viewpoints } from '../../shared/sightline.ts';
import { NUMERALS } from '../core/seed.ts';
import { validKey, begin, finish, release } from '../core/idempotency.ts';
import { StorageUnavailable } from '../services/storage.ts';
import { KillBillUnavailable } from '../services/killbill.ts';
import { PocketBaseUnavailable } from '../services/pocketbase.ts';

export { requireUser };

export interface ChapterPublic {
  id: string;
  number: number;
  numeral: string;
  title: string;
  era: string;
  catalogue_number: string;
  sightline_deg: number;
  resolved: boolean;
}

export function catalogueNumber(number: number): string {
  return `HRR-${NUMERALS[number] ?? number}`;
}

export function registerExhibitionRoutes(app: App, route: (method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  route('GET', '/api/chapters', async (ctx) => {
    const user = await optionalUser(ctx, app);
    const rows = await publishedChapters(app);
    const resolvedSet = await resolvedFor(app, user);
    const chapters = rows.map((r) => toPublicChapter(r, resolvedSet.has(Number(r['number']))));
    sendJson(ctx.res, 200, { chapters });
  });

  route('GET', '/api/chapters/:number', async (ctx) => {
    const number = Number(ctx.path.split('/').pop());
    if (!Number.isInteger(number) || number < 1 || number > 8) throw new ApiError(404, 'not_found');
    const res = await app.pool.query(
      `SELECT number, title, era, body, sightline_deg, exhibit, status FROM chapters WHERE number = $1`,
      [number],
    );
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'not_found');
    if (row['status'] !== 'published') throw new ApiError(404, 'not_found');
    const user = await optionalUser(ctx, app);
    const resolvedSet = await resolvedFor(app, user);
    const events = await chapterEvents(app, number);
    const narration = await newestNarration(app, `chapter-${number}`);
    const plates = await chapterPlates(app, `chapter-${number}`);
    sendJson(ctx.res, 200, {
      chapter: {
        id: `chapter-${number}`,
        number,
        numeral: NUMERALS[number] ?? String(number),
        title: String(row['title']),
        era: String(row['era']),
        catalogue_number: catalogueNumber(number),
        sightline_deg: Number(row['sightline_deg']),
        resolved: resolvedSet.has(number),
        body: String(row['body']),
        viewpoints: viewpoints(Number(row['sightline_deg'])),
        exhibit: row['exhibit'] === null ? null : String(row['exhibit']),
        narration: narration ? { media_url: `/api/media/${narration.id}`, transcript: String(narration['transcript'] ?? '') } : null,
        plates: plates.map((p) => ({ media_url: `/api/media/${String(p['id'])}`, caption: String(p['caption']) })),
        events,
      },
    });
  });

  route('GET', '/api/timeline', async (ctx) => {
    const chapterParam = ctx.query.get('chapter');
    let chapter: number | undefined;
    if (chapterParam !== null && chapterParam !== '') {
      const n = Number(chapterParam);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        throw new ApiError(422, 'validation_failed', { chapter: 'Check the highlighted fields.' });
      }
      chapter = n;
    }
    const events = await chapterEvents(app, chapter);
    sendJson(ctx.res, 200, { events });
  });

  route('GET', '/api/search', async (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim();
    const chapterParam = ctx.query.get('chapter');
    let chapter: number | undefined;
    if (chapterParam) {
      const n = Number(chapterParam);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        throw new ApiError(422, 'validation_failed', { chapter: 'Check the highlighted fields.' });
      }
      chapter = n;
    }
    if (q.length < 2 || q.length > 100) {
      throw new ApiError(422, 'validation_failed', { q: 'Check the highlighted fields.' });
    }
    const like = `%${q.toLowerCase()}%`;
    const chapters = (await publishedChapters(app))
      .filter((r) => !chapter || Number(r['number']) === chapter)
      .filter((r) => {
        const title = String(r['title']).toLowerCase();
        const era = String(r['era']).toLowerCase();
        return title.includes(q.toLowerCase()) || era.includes(q.toLowerCase());
      });
    const evRes = await app.pool.query(
      `SELECT id, year, title, chapter FROM events WHERE status = 'published' AND (LOWER(title) LIKE $1 OR LOWER(summary) LIKE $1) ORDER BY year, title`,
      [like],
    );
    const events = evRes.rows.filter((r) => !chapter || Number(r['chapter']) === chapter);
    const results = [
      ...chapters
        .slice()
        .sort((a, b) => Number(a['number']) - Number(b['number']))
        .map((r) => ({ type: 'chapter' as const, id: `chapter-${Number(r['number'])}`, title: String(r['title']), chapter: Number(r['number']) })),
      ...events.map((r) => ({ type: 'event' as const, id: String(r['id']), title: String(r['title']), chapter: Number(r['chapter']) })),
    ];
    sendJson(ctx.res, 200, { results });
  });

  route('GET', '/api/sources', async (ctx) => {
    const sources = await app.pool.query(`SELECT id, citation FROM sources ORDER BY id`);
    const events = await app.pool.query(
      `SELECT e.id, e.year, e.title, es.source_id FROM events e JOIN event_sources es ON es.event_id = e.id
       WHERE e.status = 'published' ORDER BY e.year, e.title`,
    );
    const citedBy = new Map<string, string[]>();
    for (const row of events.rows) {
      const sid = String(row['source_id']);
      const list = citedBy.get(sid) ?? [];
      list.push(String(row['id']));
      citedBy.set(sid, list);
    }
    sendJson(ctx.res, 200, {
      sources: sources.rows.map((r) => ({
        id: String(r['id']),
        citation: String(r['citation']),
        cited_by: citedBy.get(String(r['id'])) ?? [],
      })),
    });
  });

  route('GET', '/api/exhibits/:key', async (ctx) => {
    const key = ctx.path.split('/').pop() ?? '';
    const body = exhibitSeed(key);
    if (!body) throw new ApiError(404, 'not_found');
    sendJson(ctx.res, 200, body);
  });

  route('GET', '/api/media/:id', async (ctx) => {
    const id = ctx.path.split('/').pop() ?? '';
    const res = await app.pool.query(`SELECT m.id, m.storage_key, m.item_id, m.content_type FROM media m WHERE m.id = $1`, [id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'not_found');
    // staff are always allowed; visitors only when the item is published
    const user = await optionalUser(ctx, app);
    const staff = user && (user.role === 'curator' || user.role === 'lead_curator' || user.role === 'manager');
    if (!staff) {
      const published = await itemPublished(app, String(row['item_id']));
      if (!published) throw new ApiError(404, 'not_found');
    }
    try {
      const url = app.storage.presignGet(String(row['storage_key']));
      ctx.res.writeHead(302, { Location: url });
      ctx.res.end();
    } catch {
      throw new ApiError(503, 'storage_unavailable');
    }
  });
}

async function optionalUser(ctx: RouteContext, app: App): Promise<User | null> {
  const token = ctx.cookies['sl_session'];
  if (!token) return null;
  const { userForToken } = await import('./app.ts');
  return userForToken(app, token);
}

async function resolvedFor(app: App, user: User | null): Promise<Set<number>> {
  if (!user) return new Set();
  try {
    const path = await app.pb.getSavedPath(user.id);
    return new Set(path?.resolved ?? []);
  } catch {
    return new Set();
  }
}

async function publishedChapters(app: App): Promise<Array<Record<string, unknown>>> {
  const res = await app.pool.query(
    `SELECT number, title, era, sightline_deg, status FROM chapters WHERE status = 'published' ORDER BY number`,
  );
  return res.rows;
}

function toPublicChapter(r: Record<string, unknown>, resolved: boolean): ChapterPublic {
  const number = Number(r['number']);
  return {
    id: `chapter-${number}`,
    number,
    numeral: NUMERALS[number] ?? String(number),
    title: String(r['title']),
    era: String(r['era']),
    catalogue_number: catalogueNumber(number),
    sightline_deg: Number(r['sightline_deg']),
    resolved,
  };
}

export async function chapterEvents(app: App, chapter?: number): Promise<Array<{ id: string; year: number; title: string; summary: string; chapter: number; source_ids: string[] }>> {
  const res = await app.pool.query(
    `SELECT id, year, title, summary, chapter FROM events WHERE status = 'published' ${chapter ? 'AND chapter = $1' : ''} ORDER BY year, title`,
    chapter ? [chapter] : [],
  );
  const ids = res.rows.map((r) => String(r['id']));
  const sources = ids.length
    ? await app.pool.query(`SELECT event_id, source_id FROM event_sources WHERE event_id = ANY($1)`, [ids])
    : { rows: [] as Array<Record<string, unknown>> };
  const byEvent = new Map<string, string[]>();
  for (const s of sources.rows) {
    const key = String(s['event_id']);
    const list = byEvent.get(key) ?? [];
    list.push(String(s['source_id']));
    byEvent.set(key, list);
  }
  return res.rows.map((r) => ({
    id: String(r['id']),
    year: Number(r['year']),
    title: String(r['title']),
    summary: String(r['summary']),
    chapter: Number(r['chapter']),
    source_ids: byEvent.get(String(r['id'])) ?? [],
  }));
}

async function newestNarration(app: App, itemId: string): Promise<Record<string, unknown> | null> {
  const res = await app.pool.query(
    `SELECT id, transcript FROM media WHERE item_id = $1 AND kind = 'narration' ORDER BY created_at DESC LIMIT 1`,
    [itemId],
  );
  return res.rows[0] ?? null;
}

async function chapterPlates(app: App, itemId: string): Promise<Array<Record<string, unknown>>> {
  // Seeded plates are image media with captions held in the transcript column.
  const res = await app.pool.query(
    `SELECT id, transcript AS caption FROM media WHERE item_id = $1 AND kind = 'image' ORDER BY created_at ASC`,
    [itemId],
  );
  return res.rows;
}

async function itemPublished(app: App, itemId: string): Promise<boolean> {
  if (/^chapter-\d$/.test(itemId)) {
    const res = await app.pool.query(`SELECT status FROM chapters WHERE number = $1`, [Number(itemId.split('-')[1])]);
    return res.rows[0]?.['status'] === 'published';
  }
  const res = await app.pool.query(`SELECT status FROM events WHERE id = $1`, [itemId]);
  return res.rows[0]?.['status'] === 'published';
}

/** The exact exhibit seed JSON objects. */
function exhibitSeed(key: string): Record<string, unknown> | null {
  if (key === 'spring') {
    return { key: 'spring', stiffness: { min: 50, max: 300, step: 10, initial: 170 }, damping: { min: 2, max: 40, step: 1, initial: 26 } };
  }
  if (key === 'rules') {
    return {
      key: 'rules',
      specimens: [
        { name: 'Robin', legs: 2, wings: true, feathers: true },
        { name: 'Sparrow', legs: 2, wings: true, feathers: true },
        { name: 'Penguin', legs: 2, wings: true, feathers: true },
        { name: 'Bat', legs: 2, wings: true, feathers: false },
        { name: 'Beetle', legs: 6, wings: true, feathers: false },
        { name: 'Ant', legs: 6, wings: false, feathers: false },
        { name: 'Dragonfly', legs: 6, wings: true, feathers: false },
        { name: 'Spider', legs: 8, wings: false, feathers: false },
        { name: 'Scorpion', legs: 8, wings: false, feathers: false },
        { name: 'Cat', legs: 4, wings: false, feathers: false },
        { name: 'Whale', legs: 0, wings: false, feathers: false },
        { name: 'Ostrich', legs: 2, wings: true, feathers: true },
      ],
      rules: [
        { attribute: 'feathers', value: true, label: 'Bird' },
        { attribute: 'legs', value: 6, label: 'Insect' },
        { attribute: 'legs', value: 8, label: 'Arachnid' },
      ],
      attributes: { legs: { min: 0, max: 8 }, wings: [true, false], feathers: [true, false] },
      labels: ['Bird', 'Insect', 'Arachnid', 'Mammal'],
      new_rule: { attribute: 'legs', value: 4, label: 'Mammal' },
      max_rules: 6,
    };
  }
  if (key === 'classifier') {
    return {
      key: 'classifier',
      grid: { min: 0, max: 10 },
      max_epochs: 20,
      training: [
        { x: 7, y: 8, label: 'signal' }, { x: 8, y: 6, label: 'signal' }, { x: 9, y: 9, label: 'signal' }, { x: 6, y: 9, label: 'signal' },
        { x: 8, y: 8, label: 'signal' }, { x: 9, y: 7, label: 'signal' }, { x: 7, y: 6, label: 'signal' }, { x: 6, y: 7, label: 'signal' },
        { x: 2, y: 3, label: 'noise' }, { x: 3, y: 1, label: 'noise' }, { x: 1, y: 2, label: 'noise' }, { x: 4, y: 2, label: 'noise' },
        { x: 2, y: 5, label: 'noise' }, { x: 3, y: 4, label: 'noise' }, { x: 1, y: 4, label: 'noise' }, { x: 5, y: 1, label: 'noise' },
      ],
      held_out: [
        { x: 8, y: 9, label: 'signal' }, { x: 7, y: 7, label: 'signal' }, { x: 5, y: 8, label: 'signal' }, { x: 9, y: 5, label: 'signal' },
        { x: 2, y: 2, label: 'noise' }, { x: 4, y: 3, label: 'noise' }, { x: 3, y: 6, label: 'noise' }, { x: 6, y: 4, label: 'noise' },
      ],
    };
  }
  if (key === 'neighbours') {
    return {
      key: 'neighbours',
      words: [
        { word: 'bank', vector: [2, 2, 0] },
        { word: 'river', vector: [0, 4, 1] },
        { word: 'shore', vector: [0, 3, 2] },
        { word: 'water', vector: [1, 4, 0] },
        { word: 'money', vector: [4, 0, 1] },
        { word: 'loan', vector: [4, 1, 0] },
        { word: 'vault', vector: [3, 0, 2] },
        { word: 'engine', vector: [0, 0, 5] },
        { word: 'gear', vector: [1, 0, 4] },
        { word: 'memory', vector: [2, 1, 3] },
      ],
      contexts: ['river', 'money', 'engine'],
    };
  }
  return null;
}

export { validKey, begin, finish, release, StorageUnavailable, KillBillUnavailable, PocketBaseUnavailable, alignment };
