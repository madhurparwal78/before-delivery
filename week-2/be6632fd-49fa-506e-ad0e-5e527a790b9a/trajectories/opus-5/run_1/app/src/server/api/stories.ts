import { requireRole, requireSession } from '../auth.ts';
import { LIMITS } from '../config.ts';
import { queryOne, transact } from '../db/pool.ts';
import { FIELD_COPY, staleStart } from '../../domain/copy.ts';
import { sanitiseStory } from '../../domain/story.ts';
import { formatCopenhagenInstant, formatInstant } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { ApiError, notFound, staleVersion } from '../http/errors.ts';
import { sendJson } from '../http/respond.ts';
import { integer, Problems, readString } from '../http/validate.ts';
import { requireDrop } from './drops.ts';

interface StoryRow {
  html: string;
  version: number;
  saved_by: string;
  saved_at_ms: number;
  published_html: string | null;
  published_at_ms: number | null;
}

function storyShape(row: StoryRow): Record<string, unknown> {
  return {
    html: row.html,
    version: row.version,
    savedBy: row.saved_by,
    savedAt: formatInstant(Number(row.saved_at_ms)),
    publishedHtml: row.published_html,
    publishedAt: row.published_at_ms === null ? null : formatInstant(Number(row.published_at_ms)),
  };
}

async function storyOf(dropId: string): Promise<StoryRow> {
  const row = await queryOne<StoryRow>('select * from stories where drop_id = $1', [dropId]);
  if (row === null) throw notFound();
  return row;
}

function staleStory(row: StoryRow): ApiError {
  return staleVersion(
    row.saved_by,
    formatInstant(Number(row.saved_at_ms)),
    storyShape(row),
    staleStart(row.saved_by, formatCopenhagenInstant(Number(row.saved_at_ms))),
  );
}

export async function getStory(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'press_lead', 'launch_producer', 'merchandiser', 'finance_lead');
  sendJson(ctx.response, 200, storyShape(await storyOf(drop.id)));
}

export async function putStory(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'press_lead');

  const body = ctx.json();
  const problems = new Problems();
  const version = integer(problems, body, 'version', 1, 1_000_000_000);
  const html = readString(body, 'html') ?? '';
  if (html.length > LIMITS.storyCharacters) {
    problems.add('html', FIELD_COPY.tooLong(LIMITS.storyCharacters));
  }
  problems.throwIfAny();

  const current = await storyOf(drop.id);
  if (version !== current.version) throw staleStory(current);

  await transact(async (tx) => {
    const locked = await tx.queryOne<StoryRow>(
      'select * from stories where drop_id = $1 for update',
      [drop.id],
    );
    if (locked === null || locked.version !== version) throw staleStory(locked ?? current);
    await tx.query(
      `update stories set html = $2, version = version + 1, saved_by = $3, saved_at_ms = $4
        where drop_id = $1`,
      [drop.id, sanitiseStory(html), session.name, ctx.nowMs],
    );
  });
  sendJson(ctx.response, 200, storyShape(await storyOf(drop.id)));
}

export async function publishStory(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'press_lead');

  const body = ctx.json();
  const problems = new Problems();
  const version = integer(problems, body, 'version', 1, 1_000_000_000);
  problems.throwIfAny();

  const current = await storyOf(drop.id);
  if (version !== current.version) throw staleStory(current);

  await transact(async (tx) => {
    const locked = await tx.queryOne<StoryRow>(
      'select * from stories where drop_id = $1 for update',
      [drop.id],
    );
    if (locked === null || locked.version !== version) throw staleStory(locked ?? current);
    await tx.query(
      `update stories set published_html = html, published_at_ms = $2, version = version + 1,
                          saved_by = $3, saved_at_ms = $2
        where drop_id = $1`,
      [drop.id, ctx.nowMs, session.name],
    );
  });
  sendJson(ctx.response, 200, storyShape(await storyOf(drop.id)));
}
