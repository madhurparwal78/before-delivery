import { pool, query } from '../db.js';
import { STORIES } from '../../shared/constants.js';
import type { Progress } from '../../shared/types.js';

export type ProgressScope =
  | { kind: 'solo'; accountId: string }
  | { kind: 'party'; partyId: string };

interface ProgressRow {
  unlocked_chapter: number;
  completed_chapters: number[];
  checkpoint: { chapter: number; motes: string[] } | null;
}

const EMPTY: Progress = { unlocked_chapter: 1, completed_chapters: [], checkpoint: null };

export function storyChapters(storyId: string): number | null {
  return STORIES.find((story) => story.id === storyId)?.chapters ?? null;
}

export function storyMode(storyId: string): 'solo' | 'coop' | null {
  return STORIES.find((story) => story.id === storyId)?.mode ?? null;
}

function table(scope: ProgressScope): { name: string; column: string; id: string } {
  return scope.kind === 'solo'
    ? { name: 'solo_progress', column: 'account_id', id: scope.accountId }
    : { name: 'party_progress', column: 'party_id', id: scope.partyId };
}

export async function readProgress(scope: ProgressScope, storyId: string): Promise<Progress> {
  const { name, column, id } = table(scope);
  const rows = await query<ProgressRow>(
    `SELECT unlocked_chapter, completed_chapters, checkpoint FROM ${name}
     WHERE ${column} = $1 AND story_id = $2`,
    [id, storyId],
  );
  const row = rows[0];
  if (row === undefined) return { ...EMPTY };
  return {
    unlocked_chapter: row.unlocked_chapter,
    completed_chapters: row.completed_chapters,
    checkpoint: row.checkpoint,
  };
}

async function writeProgress(
  scope: ProgressScope,
  storyId: string,
  progress: Progress,
): Promise<void> {
  const { name, column, id } = table(scope);
  await pool.query(
    `INSERT INTO ${name} (${column}, story_id, unlocked_chapter, completed_chapters, checkpoint)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (${column}, story_id) DO UPDATE
       SET unlocked_chapter = EXCLUDED.unlocked_chapter,
           completed_chapters = EXCLUDED.completed_chapters,
           checkpoint = EXCLUDED.checkpoint`,
    [
      id,
      storyId,
      progress.unlocked_chapter,
      JSON.stringify(progress.completed_chapters),
      progress.checkpoint === null ? null : JSON.stringify(progress.checkpoint),
    ],
  );
}

export async function saveCheckpoint(
  scope: ProgressScope,
  storyId: string,
  chapter: number,
  motes: readonly string[],
): Promise<void> {
  const progress = await readProgress(scope, storyId);
  progress.checkpoint = { chapter, motes: [...motes] };
  await writeProgress(scope, storyId, progress);
}

export async function completeChapter(
  scope: ProgressScope,
  storyId: string,
  chapter: number,
): Promise<void> {
  const progress = await readProgress(scope, storyId);
  const chapters = storyChapters(storyId) ?? chapter;
  if (!progress.completed_chapters.includes(chapter)) {
    progress.completed_chapters = [...progress.completed_chapters, chapter].sort((a, b) => a - b);
  }
  if (chapter < chapters) {
    progress.unlocked_chapter = Math.max(progress.unlocked_chapter, chapter + 1);
  }
  progress.checkpoint = null;
  await writeProgress(scope, storyId, progress);
}
