import { Router } from 'express';
import { AppError } from '../../errors.js';
import { EXHIBIT_SEEDS, isExhibitKey } from '../../../shared/exhibits.js';
import { readQueryInteger, readQueryText, FieldErrors } from '../validate.js';
import {
  listSources,
  loadItem,
  mediaById,
  publishedChapter,
  publishedChapters,
  publishedEvents,
  search,
  toChapterDetail,
  toChapterSummary,
  toEventView,
} from '../../domain/archive.js';
import { readPath } from '../../services/pocketbase.js';
import { objectExists, presignGet } from '../../services/storage.js';

export const exhibitionRouter = Router();

async function resolvedChapters(userId: string | undefined): Promise<Set<number>> {
  if (!userId) return new Set();
  try {
    const path = await readPath(userId);
    return new Set(path.resolved);
  } catch {
    return new Set();
  }
}

exhibitionRouter.get('/chapters', async (request, response) => {
  const resolved = await resolvedChapters(request.user?.id);
  const rows = await publishedChapters();
  response.json({ chapters: rows.map((row) => toChapterSummary(row, resolved.has(row.number))) });
});

exhibitionRouter.get('/chapters/:number', async (request, response) => {
  const number = Number(request.params.number);
  if (!Number.isInteger(number)) throw new AppError('not_found');
  const row = await publishedChapter(number);
  if (!row) throw new AppError('not_found');
  const resolved = await resolvedChapters(request.user?.id);
  response.json({ chapter: await toChapterDetail(row, resolved.has(number)) });
});

exhibitionRouter.get('/timeline', async (request, response) => {
  const errors = new FieldErrors();
  const raw = request.query.chapter;
  let chapter: number | null = null;
  if (raw !== undefined) {
    const parsed = readQueryInteger(raw);
    if (parsed === null || parsed < 1 || parsed > 8) errors.add('chapter', 'Choose a published chapter.');
    else chapter = parsed;
  }
  errors.throwIfAny();
  const events = await publishedEvents(chapter);
  response.json({ events: events.map(toEventView) });
});

exhibitionRouter.get('/search', async (request, response) => {
  const errors = new FieldErrors();
  const text = readQueryText(request.query.q);
  if (text === null || text.length < 2 || text.length > 100) errors.add('q', 'Search for 2 to 100 characters.');
  let chapter: number | null = null;
  const raw = request.query.chapter;
  if (raw !== undefined) {
    const parsed = readQueryInteger(raw);
    if (parsed === null || parsed < 1 || parsed > 8) errors.add('chapter', 'Choose a published chapter.');
    else chapter = parsed;
  }
  errors.throwIfAny();
  response.json({ results: await search(text as string, chapter) });
});

exhibitionRouter.get('/sources', async (_request, response) => {
  response.json({ sources: await listSources() });
});

exhibitionRouter.get('/exhibits/:key', (request, response) => {
  const key = request.params.key;
  if (!isExhibitKey(key)) throw new AppError('not_found');
  response.json(EXHIBIT_SEEDS[key]);
});

exhibitionRouter.get('/media/:id', async (request, response) => {
  const media = await mediaById(request.params.id as string);
  if (!media) throw new AppError('not_found');
  const role = request.user?.role;
  const isStaff = role === 'curator' || role === 'lead_curator' || role === 'manager';
  if (!isStaff) {
    const item = await loadItem(media.item_id);
    if (!item || item.status !== 'published') throw new AppError('not_found');
  }
  if (!(await objectExists(media.object_key))) throw new AppError('not_found');
  response.redirect(302, presignGet(media.object_key));
});
