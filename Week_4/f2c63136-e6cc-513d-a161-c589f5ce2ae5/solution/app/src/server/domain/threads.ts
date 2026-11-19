import type { Db, Row, Tx } from '../db.ts';
import { now, wholeSecond } from '../clock.ts';
import { mapLines, splitLines } from '../../shared/diff.ts';
import { combinedDiff } from './combined.ts';
import { Contents, type Snap } from './revisions.ts';

interface Anchors {
  base: Snap;
  head: Snap;
}

/**
 * After a new head revision each thread's anchor maps through the line diff of its side: an unchanged
 * line moves with its line number, a changed or removed line makes the thread outdated for good.
 */
export async function remapThreads(tx: Tx, change: Row, before: Anchors, after: Anchors, contents: Contents): Promise<void> {
  const inDiff = new Set(combinedDiff(after.base, after.head).map((file) => file.path));
  const threads = await tx.q<Row>('SELECT * FROM threads WHERE change_id = $1 AND NOT outdated', [change.id]);
  for (const thread of threads) {
    const from = (thread.side === 'new' ? before.head : before.base).get(thread.path);
    const to = (thread.side === 'new' ? after.head : after.base).get(thread.path);
    let line: number | null = thread.line;
    let endLine: number | null = thread.end_line;
    if (!inDiff.has(thread.path) || !to) {
      line = null;
    } else if (from && from.sha !== to.sha) {
      const mapped = mapLines((await contents.get(from.sha)).toString('utf8'), (await contents.get(to.sha)).toString('utf8'));
      line = mapped[thread.line - 1] ?? null;
      endLine = mapped[thread.end_line - 1] ?? null;
      if (line !== null && endLine !== null && endLine - line !== thread.end_line - thread.line) line = null;
    }
    if (line === null || endLine === null) {
      await tx.q('UPDATE threads SET outdated = true WHERE id = $1', [thread.id]);
    } else if (line !== thread.line || endLine !== thread.end_line) {
      await tx.q('UPDATE threads SET line = $1, end_line = $2 WHERE id = $3', [line, endLine, thread.id]);
    }
  }
}

export interface SuggestionEdit {
  path: string;
  start: number;
  end: number;
  lines: string[];
}

export class StaleSuggestion extends Error {
  constructor(readonly line: number) {
    super(`This suggestion can no longer be applied: line ${line} changed since it was made.`);
  }
}

/** Where a suggestion's range lives in the current text, or the first line of it that changed. */
export function locateRange(anchorText: string, headText: string, from: number, to: number): { start: number; end: number } {
  const mapped = mapLines(anchorText, headText);
  let previous: number | null = null;
  for (let line = from; line <= to; line += 1) {
    const target = mapped[line - 1] ?? null;
    if (target === null || (previous !== null && target !== previous + 1)) throw new StaleSuggestion(line);
    previous = target;
  }
  return { start: mapped[from - 1]!, end: mapped[to - 1]! };
}

/** Replaces the lines of each edit (bottom-up so positions stay valid) and keeps the final newline. */
export function applyEdits(text: string, edits: SuggestionEdit[]): string {
  const lines = splitLines(text);
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let index = 0; index < sorted.length; index += 1) {
    const edit = sorted[index];
    if (index > 0 && edit.end >= sorted[index - 1].start) throw new StaleSuggestion(edit.start);
    lines.splice(edit.start - 1, edit.end - edit.start + 1, ...edit.lines);
  }
  return lines.join('\n') + (text.endsWith('\n') || text === '' ? '\n' : '');
}

export async function newThread(
  tx: Tx,
  change: Row,
  input: { path: string; side: 'old' | 'new'; line: number; endLine: number; authorId: number; body: string; suggestion: string[] | null },
): Promise<{ threadId: number; commentId: number }> {
  const at = wholeSecond(now());
  const thread = (
    await tx.q<Row>(
      `INSERT INTO threads (change_id, path, side, line, end_line, revision, anchor_line, anchor_end_line, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $4, $5, $7) RETURNING id`,
      [change.id, input.path, input.side, input.line, input.endLine, change.head_revision, at],
    )
  )[0];
  const comment = (
    await tx.q<Row>(
      `INSERT INTO comments (thread_id, author_id, body, suggestion, suggestion_state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [thread.id, input.authorId, input.body, input.suggestion ? JSON.stringify(input.suggestion) : null, input.suggestion ? 'open' : null, at],
    )
  )[0];
  return { threadId: thread.id, commentId: comment.id };
}
