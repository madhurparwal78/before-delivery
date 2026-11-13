import type { Comment, Workout } from '../shared/types.js';
import { audienceOf, linkedCoachIds, newId, type User } from './access.js';
import { one, pool, type Queryable } from './db.js';
import { FieldErrors } from './errors.js';
import { publishChange, publishNotice } from './live.js';
import { commentMessage } from './validation.js';

interface Row {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: Date;
}

const commentOf = (row: Row): Comment => ({ ...row, created_at: row.created_at.toISOString() });

export async function listComments(workoutId: string, q: Queryable = pool): Promise<Comment[]> {
  const { rows } = await q.query<Row>(
    'SELECT c.id, c.author_id, u.name AS author_name, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.author_id WHERE c.workout_id = $1 ORDER BY c.seq',
    [workoutId]
  );
  return rows.map(commentOf);
}

export async function insertComment(author: User, workoutId: string, body: { body?: unknown }, id = newId(), q: Queryable = pool): Promise<Comment> {
  const errors = new FieldErrors();
  errors.add('body', commentMessage(body.body));
  errors.throwIfAny();
  const text = (body.body as string).trim();
  const row = one(
    await q.query<{ created_at: Date }>(
      `INSERT INTO comments (id, workout_id, author_id, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body
       RETURNING created_at`,
      [id, workoutId, author.id, text]
    )
  );
  return { id, author_id: author.id, author_name: author.name, body: text, created_at: row.created_at.toISOString() };
}

/** Posts a comment; the other party hears of it. */
export async function addComment(author: User, workout: Workout, body: { body?: unknown }): Promise<Comment> {
  const comment = await insertComment(author, workout.id, body);
  publishChange(await audienceOf(workout.athlete_id), workout.athlete_id, ['comments'], workout.id);
  const others = author.id === workout.athlete_id ? await linkedCoachIds(workout.athlete_id) : [workout.athlete_id];
  publishNotice(others, `${author.name} commented on ${workout.title}.`);
  return comment;
}
