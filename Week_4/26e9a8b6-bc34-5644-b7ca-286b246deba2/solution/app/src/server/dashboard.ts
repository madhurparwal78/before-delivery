import { requireUser } from './access';
import { pool } from './db';
import type { Ctx } from './http';
import { pageSize, questionPage } from './questions';
import type { GuideRow } from '../shared/types';

export async function dashboard(ctx: Ctx): Promise<unknown> {
  const user = requireUser(ctx);
  const own = (extra: string) =>
    pool.query<GuideRow>(`SELECT id, slug, title, state FROM guides WHERE owner_id = $1 AND ${extra} ORDER BY created_at DESC, id`, [user.id]).then((r) => r.rows);
  const collections = await pool.query<{ id: string; slug: string; title: string }>('SELECT id, slug, title FROM collections WHERE owner_id = $1 ORDER BY created_at DESC', [user.id]);
  const questions = await questionPage(
    pool,
    `q.guide_id IN (SELECT id FROM guides WHERE owner_id = $1 UNION SELECT guide_id FROM coauthors WHERE user_id = $1)`,
    [user.id], ctx.url.searchParams.get('cursor'), pageSize(ctx),
  );
  return {
    drafts: await own("source_title IS NULL AND state = 'draft'"),
    published: await own("source_title IS NULL AND state IN ('published', 'withdrawn')"),
    forks: await own('source_title IS NOT NULL'),
    collections: collections.rows,
    questions: questions.items,
    questions_next_cursor: questions.next,
  };
}
