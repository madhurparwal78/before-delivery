import { Router } from 'express';
import { AppError } from '../../errors.js';
import { withAdvisoryLock } from '../../db/index.js';
import { body } from '../boundary.js';
import { requireUser } from '../auth.js';
import { FieldErrors, readInteger, readText } from '../validate.js';
import { createBookmark, deleteBookmark, listBookmarks, readPath, writePath } from '../../services/pocketbase.js';
import { loadItem, publishedChapter, publishedChapters, publishedEvents } from '../../domain/archive.js';
import type { Bookmark, SavedPath } from '../../../shared/types.js';

export const pathRouter = Router();

async function currentPath(userId: string): Promise<SavedPath> {
  const stored = await readPath(userId);
  const published = new Set((await publishedChapters()).map((chapter) => chapter.number));
  const resolved = stored.resolved.filter((number) => published.has(number)).sort((a, b) => a - b);
  const lastChapter = stored.lastChapter !== null && published.has(stored.lastChapter) ? stored.lastChapter : null;
  return { resolved, last_chapter: lastChapter, last_exhibit: stored.lastExhibit };
}

pathRouter.get('/me/path', async (request, response) => {
  const user = requireUser(request);
  response.json({ path: await currentPath(user.id) });
});

pathRouter.post('/me/path/resolved', async (request, response) => {
  const user = requireUser(request);
  const number = readInteger(body(request).chapter);
  if (number === null || !(await publishedChapter(number))) throw new AppError('not_found');
  await withAdvisoryLock(`saved-path:${user.id}`, async () => {
    const stored = await readPath(user.id);
    const resolved = [...new Set([...stored.resolved, number])].sort((a, b) => a - b);
    await writePath(user.id, { ...stored, resolved });
  });
  response.json({ path: await currentPath(user.id) });
});

pathRouter.put('/me/path/position', async (request, response) => {
  const user = requireUser(request);
  const input = body(request);
  const number = readInteger(input.chapter);
  if (number === null) throw new AppError('not_found');
  const chapter = await publishedChapter(number);
  if (!chapter) throw new AppError('not_found');
  const exhibit = readText(input.exhibit) ?? '';
  const errors = new FieldErrors();
  if (exhibit !== '' && exhibit !== chapter.exhibit) errors.add('exhibit', 'This chapter has no such exhibit.');
  errors.throwIfAny();
  await withAdvisoryLock(`saved-path:${user.id}`, async () => {
    const stored = await readPath(user.id);
    await writePath(user.id, { ...stored, lastChapter: number, lastExhibit: exhibit });
  });
  response.json({ path: await currentPath(user.id) });
});

async function bookmarkTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const chapter of await publishedChapters()) {
    titles.set(`chapter-${chapter.number}`, `Chapter ${chapter.numeral}: ${chapter.title}`);
  }
  for (const event of await publishedEvents(null)) titles.set(event.id, event.title);
  return titles;
}

pathRouter.get('/me/bookmarks', async (request, response) => {
  const user = requireUser(request);
  const titles = await bookmarkTitles();
  const stored = await listBookmarks(user.id);
  const bookmarks: Bookmark[] = stored
    .filter((bookmark) => titles.has(bookmark.targetId))
    .map((bookmark) => ({
      id: bookmark.id,
      target_type: bookmark.targetType,
      target_id: bookmark.targetId,
      title: titles.get(bookmark.targetId) as string,
    }));
  response.json({ bookmarks });
});

pathRouter.post('/me/bookmarks', async (request, response) => {
  const user = requireUser(request);
  const input = body(request);
  const targetType = readText(input.target_type);
  const targetId = readText(input.target_id);
  if ((targetType !== 'chapter' && targetType !== 'event') || !targetId) throw new AppError('not_found');
  const item = await loadItem(targetId);
  if (!item || item.type !== targetType || item.status !== 'published') throw new AppError('not_found');
  const titles = await bookmarkTitles();
  const { bookmark, created } = await createBookmark(user.id, targetType, targetId);
  response.status(created ? 201 : 200).json({
    bookmark: {
      id: bookmark.id,
      target_type: bookmark.targetType,
      target_id: bookmark.targetId,
      title: titles.get(bookmark.targetId) ?? item.title,
    },
  });
});

pathRouter.delete('/me/bookmarks/:id', async (request, response) => {
  const user = requireUser(request);
  const removed = await deleteBookmark(user.id, request.params.id as string);
  if (!removed) throw new AppError('not_found');
  response.status(204).end();
});
