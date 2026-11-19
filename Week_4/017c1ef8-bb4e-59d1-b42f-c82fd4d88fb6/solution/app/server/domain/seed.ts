import { hashPassword } from '../auth.js';
import { now } from '../clock.js';
import { transaction, type Tx } from '../db.js';
import { validation } from '../errors.js';
import { newId } from '../ids.js';
import { historyByState, type ApplicationState, type HistoryBy } from './application-stages.js';
import { parseText, saveHashtags } from './text.js';

interface SeedUser {
  key: string;
  email: string;
  password?: string;
  /** A stored hash (as `hashPassword` writes it) in place of a password. */
  password_hash?: string;
  name: string;
  handle: string;
  headline?: string;
  location?: string;
  visibility?: 'public' | 'connections' | 'private';
  about?: string;
  experience?: Array<{ title: string; company: string; start: string; end: string | null }>;
  education?: Array<{ school: string; degree: string; start: string; end: string | null }>;
  skills?: string[];
  featured?: string[];
}

interface SeedQuestion {
  key: string;
  type: string;
  text: string;
  required?: boolean;
  knock_out?: boolean;
  ideal?: string | null;
  options?: string[] | null;
  accepted?: string[] | null;
  minimum?: number | null;
  maximum?: number | null;
}

export interface SeedBody {
  users?: SeedUser[];
  companies?: Array<{ key: string; name: string; handle: string; location?: string; admins?: string[] }>;
  connections?: Array<{ from: string; to: string; state: 'pending' | 'connected' | 'withdrawn' | 'ignored'; at: string }>;
  blocks?: Array<{ blocker: string; blocked: string; at: string }>;
  follows?: Array<{ follower: string; target: string; at: string }>;
  posts?: Array<{ key: string; author: string; text: string; at: string; photo?: boolean }>;
  reposts?: Array<{ key: string; author: string; of: string; text: string | null; at: string }>;
  reactions?: Array<{ post: string; user: string; type: string; at: string }>;
  comments?: Array<{ key: string; post: string; author: string; parent: string | null; text: string; at: string }>;
  endorsements?: Array<{ endorser: string; owner: string; skill: string; at: string }>;
  messages?: Array<{ from: string; to: string; text: string; at: string; read_at: string | null }>;
  jobs?: Array<{
    key: string;
    company: string;
    poster: string;
    title: string;
    location: string;
    workplace: string;
    posted_at: string;
    closes_at: string;
    description: string;
    questions?: SeedQuestion[];
  }>;
  applications?: Array<{
    key: string;
    job: string;
    applicant: string;
    state: string;
    at: string;
    answers?: Record<string, unknown>;
    history?: Array<{ state: string; at: string; by: HistoryBy; reason: string | null }>;
  }>;
}

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** Creates the published records in one transaction, in the published order, and returns their ids by key. */
export async function applySeed(body: SeedBody, tx: Tx): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const db = tx;
  const at = (value: string): Date => new Date(value);
  const idOf = (key: string): string => {
    const id = ids[key];
    if (!id) throw validation({ [key]: 'Unknown key.' });
    return id;
  };

  const users = body.users ?? [];
  const emails = new Set<string>();
  const handles = new Set<string>();
  const taken = await db.query<{ email: string; handle: string }>('SELECT lower(email) AS email, handle FROM members');
  for (const row of taken.rows) {
    emails.add(row.email);
    handles.add(row.handle);
  }
  const fields: Record<string, string> = {};
  users.forEach((user, index) => {
    if (emails.has(user.email.toLowerCase())) fields[`users.${index}.email`] = 'This email is already registered.';
    if (handles.has(user.handle)) fields[`users.${index}.handle`] = 'This handle is taken.';
    emails.add(user.email.toLowerCase());
    handles.add(user.handle);
  });
  if (Object.keys(fields).length > 0) throw validation(fields);

  const seededAt = now();
  const hashes = await Promise.all(users.map((user) => user.password_hash ?? hashPassword(user.password ?? '')));
  for (const [index, user] of users.entries()) {
    const id = newId();
    ids[user.key] = id;
    await db.query(
      `INSERT INTO members (id, email, handle, password_hash, name, headline, location, about, visibility, confirmed, created_at, notifications_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $10)`,
      [id, user.email, user.handle, hashes[index], user.name, user.headline ?? '', user.location ?? '', user.about ?? '', user.visibility ?? 'public', seededAt],
    );
    for (const [position, entry] of (user.experience ?? []).entries()) {
      await db.query('INSERT INTO member_experience (id, member_id, position, title, company, start, "end") VALUES ($1, $2, $3, $4, $5, $6, $7)', [newId(), id, position, entry.title, entry.company, entry.start, entry.end]);
    }
    for (const [position, entry] of (user.education ?? []).entries()) {
      await db.query('INSERT INTO member_education (id, member_id, position, school, degree, start, "end") VALUES ($1, $2, $3, $4, $5, $6, $7)', [newId(), id, position, entry.school, entry.degree, entry.start, entry.end]);
    }
    const featured = (user.featured ?? []).map((name) => name.toLowerCase());
    for (const [position, name] of (user.skills ?? []).entries()) {
      const place = featured.indexOf(name.toLowerCase());
      await db.query('INSERT INTO skills (member_id, name, skill_key, position, featured_position) VALUES ($1, $2, $3, $4, $5)', [id, name, name.toLowerCase(), position, place >= 0 ? place + 1 : null]);
    }
  }

  for (const company of body.companies ?? []) {
    const id = newId();
    ids[company.key] = id;
    await db.query('INSERT INTO companies (id, handle, name, location, created_at) VALUES ($1, $2, $3, $4, $5)', [id, company.handle, company.name, company.location ?? '', seededAt]);
    for (const admin of company.admins ?? []) await db.query('INSERT INTO company_admins (company_id, member_id) VALUES ($1, $2)', [id, idOf(admin)]);
  }

  for (const connection of body.connections ?? []) {
    const from = idOf(connection.from);
    const to = idOf(connection.to);
    if (connection.state === 'connected') {
      const [lo, hi] = pairOf(from, to);
      await db.query('INSERT INTO connections (member_lo, member_hi, connected_at) VALUES ($1, $2, $3)', [lo, hi, at(connection.at)]);
    } else {
      const resolved = connection.state === 'pending' ? null : at(connection.at);
      await db.query('INSERT INTO invitations (id, sender_id, receiver_id, state, created_at, resolved_at) VALUES ($1, $2, $3, $4, $5, $6)', [newId(), from, to, connection.state, at(connection.at), resolved]);
    }
  }

  for (const block of body.blocks ?? []) {
    await db.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3)', [idOf(block.blocker), idOf(block.blocked), at(block.at)]);
  }
  for (const follow of body.follows ?? []) {
    await db.query('INSERT INTO follows (follower_id, target_id, created_at) VALUES ($1, $2, $3)', [idOf(follow.follower), idOf(follow.target), at(follow.at)]);
  }

  const insertPost = async (key: string, authorKey: string, text: string, when: string, sharedPostId: string | null): Promise<void> => {
    const id = newId();
    ids[key] = id;
    const authorId = idOf(authorKey);
    const parsed = await parseText(db, authorId, text);
    await db.query('INSERT INTO posts (id, author_id, text, mentions, created_at, shared_post_id) VALUES ($1, $2, $3, $4, $5, $6)', [id, authorId, text, JSON.stringify(parsed.mentions), at(when), sharedPostId]);
    await saveHashtags(db, id, parsed.hashtags);
  };
  for (const post of body.posts ?? []) await insertPost(post.key, post.author, post.text, post.at, null);
  for (const repost of body.reposts ?? []) {
    if (repost.text === null) {
      const id = newId();
      ids[repost.key] = id;
      await db.query('INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1, $2, $3, $4)', [id, idOf(repost.author), idOf(repost.of), at(repost.at)]);
    } else {
      await insertPost(repost.key, repost.author, repost.text, repost.at, idOf(repost.of));
    }
  }

  for (const reaction of body.reactions ?? []) {
    await db.query('INSERT INTO reactions (post_id, member_id, type, created_at) VALUES ($1, $2, $3, $4)', [idOf(reaction.post), idOf(reaction.user), reaction.type, at(reaction.at)]);
  }
  for (const comment of body.comments ?? []) {
    const id = newId();
    ids[comment.key] = id;
    const authorId = idOf(comment.author);
    const parsed = await parseText(db, authorId, comment.text);
    await db.query('INSERT INTO comments (id, post_id, parent_id, author_id, text, mentions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, idOf(comment.post), comment.parent ? idOf(comment.parent) : null, authorId, comment.text, JSON.stringify(parsed.mentions), at(comment.at)]);
  }
  for (const endorsement of body.endorsements ?? []) {
    await db.query('INSERT INTO endorsements (owner_id, skill_key, endorser_id, created_at) VALUES ($1, $2, $3, $4)', [idOf(endorsement.owner), endorsement.skill.toLowerCase(), idOf(endorsement.endorser), at(endorsement.at)]);
  }

  const conversations = new Map<string, string>();
  for (const message of body.messages ?? []) {
    const from = idOf(message.from);
    const to = idOf(message.to);
    const [lo, hi] = pairOf(from, to);
    let conversationId = conversations.get(`${lo}:${hi}`);
    if (!conversationId) {
      conversationId = newId();
      conversations.set(`${lo}:${hi}`, conversationId);
      await db.query('INSERT INTO conversations (id, member_lo, member_hi, created_at) VALUES ($1, $2, $3, $4)', [conversationId, lo, hi, at(message.at)]);
    }
    await db.query('INSERT INTO messages (id, conversation_id, sender_id, text, sent_at, read_at) VALUES ($1, $2, $3, $4, $5, $6)', [newId(), conversationId, from, message.text, at(message.at), message.read_at ? at(message.read_at) : null]);
  }

  for (const job of body.jobs ?? []) {
    const id = newId();
    ids[job.key] = id;
    const posterId = idOf(job.poster);
    await db.query('INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [id, idOf(job.company), posterId, job.title, job.location, job.workplace, job.description, at(job.posted_at), at(job.closes_at)]);
    for (const field of ['title', 'location', 'workplace', 'closes_at', 'description', 'questions']) {
      await db.query('INSERT INTO job_field_versions (job_id, field, version, by_member_id) VALUES ($1, $2, 1, $3)', [id, field, posterId]);
    }
    for (const [position, question] of (job.questions ?? []).entries()) {
      const questionId = newId();
      ids[question.key] = questionId;
      await db.query(
        `INSERT INTO job_questions (id, job_id, position, type, text, required, knock_out, ideal, options, accepted, minimum, maximum)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [questionId, id, position + 1, question.type, question.text, question.required ?? false, question.knock_out ?? false, question.ideal ?? null, question.options ? JSON.stringify(question.options) : null, question.accepted ? JSON.stringify(question.accepted) : null, question.minimum ?? null, question.maximum ?? null],
      );
    }
  }

  for (const application of body.applications ?? []) {
    const id = newId();
    ids[application.key] = id;
    const history = application.history ?? [{ state: application.state, at: application.at, by: historyByState(application.state as ApplicationState), reason: null }];
    const answers = Object.fromEntries(Object.entries(application.answers ?? {}).map(([key, value]) => [idOf(key), value]));
    const entered = history[history.length - 1]?.at ?? application.at;
    await db.query(
      `INSERT INTO applications (id, job_id, applicant_id, state, answers, created_at, entered_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, idOf(application.job), idOf(application.applicant), application.state, JSON.stringify(answers), at(application.at), at(entered)],
    );
    for (const entry of history) {
      await db.query('INSERT INTO application_history (application_id, state, at, by, reason) VALUES ($1, $2, $3, $4, $5)', [id, entry.state, at(entry.at), entry.by, entry.reason]);
    }
  }
  return ids;
}

export async function seedInTransaction(body: SeedBody): Promise<Record<string, string>> {
  return transaction((tx) => applySeed(body, tx));
}
