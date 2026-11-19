import type { PoolClient } from 'pg';
import { formatNumber } from '../shared/format.js';
import type { NumberFormat } from '../shared/types.js';
import { query } from './db.js';

export type ActivityKind = 'stroke' | 'swatch' | 'restore' | 'comment' | 'invite' | 'export';

export interface ActivityRow {
  id: number;
  kind: ActivityKind;
  user_name: string;
  sprite_name: string | null;
  pixels: number;
  strokes: number;
  frame: number | null;
  detail: string | null;
  at: Date;
}

const MERGE_WINDOW_MS = 60000;

export interface ActivityInput {
  projectId: number;
  kind: ActivityKind;
  userId: number;
  userName: string;
  spriteId?: number;
  spriteName?: string;
  pixels?: number;
  frame?: number;
  detail?: string;
  at: Date;
}

/** Consecutive strokes by one person on one sprite merge into one entry. */
export async function recordActivity(client: PoolClient, input: ActivityInput): Promise<void> {
  if (input.kind === 'stroke') {
    const latest = await client.query<{ id: number; kind: string; user_id: number; sprite_id: number; at: Date }>(
      'SELECT id, kind, user_id, sprite_id, at FROM activity WHERE project_id = $1 ORDER BY id DESC LIMIT 1',
      [input.projectId],
    );
    const head = latest.rows[0];
    if (
      head !== undefined &&
      head.kind === 'stroke' &&
      head.user_id === input.userId &&
      head.sprite_id === input.spriteId &&
      input.at.getTime() - head.at.getTime() < MERGE_WINDOW_MS
    ) {
      await client.query(
        'UPDATE activity SET pixels = pixels + $2, strokes = strokes + 1 WHERE id = $1',
        [head.id, input.pixels ?? 0],
      );
      return;
    }
  }
  await client.query(
    `INSERT INTO activity
       (project_id, kind, user_id, user_name, sprite_id, sprite_name, pixels, strokes, frame, detail, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.projectId,
      input.kind,
      input.userId,
      input.userName,
      input.spriteId ?? null,
      input.spriteName ?? null,
      input.pixels ?? 0,
      input.kind === 'stroke' ? 1 : 0,
      input.frame ?? null,
      input.detail ?? null,
      input.at,
    ],
  );
}

export async function recordActivityOutsideSprite(input: ActivityInput): Promise<void> {
  await query(
    `INSERT INTO activity
       (project_id, kind, user_id, user_name, sprite_id, sprite_name, pixels, strokes, frame, detail, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.projectId,
      input.kind,
      input.userId,
      input.userName,
      input.spriteId ?? null,
      input.spriteName ?? null,
      input.pixels ?? 0,
      0,
      input.frame ?? null,
      input.detail ?? null,
      input.at,
    ],
  );
}

/** The published sentence for one activity entry, in the reader's number format. */
export function activitySentence(row: ActivityRow, format: NumberFormat): string {
  const n = (value: number): string => formatNumber(value, format);
  if (row.kind === 'stroke') {
    if (row.strokes > 1) {
      return `${row.user_name} painted ${n(row.pixels)} pixels in ${n(row.strokes)} strokes on ${row.sprite_name}`;
    }
    return `${row.user_name} painted ${n(row.pixels)} pixels on ${row.sprite_name}, frame ${n(row.frame ?? 1)}`;
  }
  if (row.kind === 'swatch') return `${row.user_name} edited swatch ${n(Number(row.detail))}`;
  if (row.kind === 'restore') return `${row.user_name} restored ${row.detail}`;
  if (row.kind === 'comment') return `${row.user_name} commented on ${row.sprite_name}`;
  if (row.kind === 'invite') return `${row.user_name} invited ${row.detail}`;
  return `${row.user_name} exported ${row.detail}`;
}
