import { query } from './db.js';
import { stories } from '../shared/domain.js';

export type ProgressRow = {
  owner_kind: 'account' | 'party';
  owner_id: string;
  story_id: string;
  unlocked_chapter: number;
  completed_chapters: number[];
  checkpoint: { chapter: number; motes: string[] } | null;
};

export function progressJson(p: ProgressRow): Record<string, unknown> {
  return {
    unlocked_chapter: p.unlocked_chapter,
    completed_chapters: p.completed_chapters,
    checkpoint: p.checkpoint,
  };
}

export async function progressFor(ownerKind: 'account' | 'party', ownerId: string, storyId: string): Promise<ProgressRow | null> {
  const res = await query<{ owner_kind: string; owner_id: string; story_id: string; unlocked_chapter: number; completed_chapters: number[]; checkpoint: { chapter: number; motes: string[] } | null }>(
    'select owner_kind, owner_id, story_id, unlocked_chapter, completed_chapters, checkpoint from progress where owner_kind = $1 and owner_id = $2 and story_id = $3',
    [ownerKind, ownerId, storyId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, owner_kind: ownerKind, completed_chapters: row.completed_chapters ?? [] };
}

export async function ensureProgress(ownerKind: 'account' | 'party', ownerId: string, storyId: string): Promise<ProgressRow> {
  const existing = await progressFor(ownerKind, ownerId, storyId);
  if (existing) return existing;
  await query(
    "insert into progress (owner_kind, owner_id, story_id, unlocked_chapter, completed_chapters, checkpoint) values ($1, $2, $3, 1, '[]'::jsonb, null) on conflict do nothing",
    [ownerKind, ownerId, storyId],
  );
  const created = await progressFor(ownerKind, ownerId, storyId);
  if (!created) throw new Error('progress insert failed');
  return created;
}

export async function saveProgressCheckpoint(ownerKind: 'account' | 'party', ownerId: string, storyId: string, chapter: number, motes: string[]): Promise<void> {
  await ensureProgress(ownerKind, ownerId, storyId);
  await query(
    "update progress set checkpoint = $1::jsonb where owner_kind = $2 and owner_id = $3 and story_id = $4",
    [JSON.stringify({ chapter, motes }), ownerKind, ownerId, storyId],
  );
}

export async function completeProgress(ownerKind: 'account' | 'party', ownerId: string, storyId: string, chapter: number, motes: string[]): Promise<void> {
  const progress = await ensureProgress(ownerKind, ownerId, storyId);
  const completed = new Set(progress.completed_chapters);
  completed.add(chapter);
  const story = stories.find((s) => s.id === storyId);
  const nextChapter = chapter + 1;
  const unlocked = story && nextChapter <= story.chapters ? Math.max(progress.unlocked_chapter, nextChapter) : progress.unlocked_chapter;
  await query(
    "update progress set completed_chapters = $1::jsonb, unlocked_chapter = $2, checkpoint = null where owner_kind = $3 and owner_id = $4 and story_id = $5",
    [JSON.stringify([...completed].sort((a, b) => a - b)), unlocked, ownerKind, ownerId, storyId],
  );
}

export async function storyProgressForCaller(accountId: string, partyId: string | null, storyId: string): Promise<ProgressRow | null> {
  const story = stories.find((s) => s.id === storyId);
  if (!story) return null;
  if (story.mode === 'solo') return progressFor('account', accountId, storyId);
  if (!partyId) return null;
  return progressFor('party', partyId, storyId);
}
