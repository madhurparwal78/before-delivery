import type { PoolClient } from 'pg';
import { businessNow, businessNowIso, setBusinessNow } from '../clock';
import { config } from '../config';
import { transact } from '../db';
import { validation } from '../errors';
import { newId } from '../ids';
import { jsonBody, type Ctx } from '../http';
import { clockMoved, pushToAll } from '../live';
import { hashPassword } from '../passwords';
import { hashtagsOf, mentionHandles } from '../../shared/richtext';

export function hasGradingKey(ctx: Ctx): boolean {
  if (config.gradingKey === '') return false;
  return ctx.req.headers['x-grading-key'] === config.gradingKey;
}

export async function setClock(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const body = jsonBody(ctx);
  const instant = new Date(String(body.now ?? ''));
  if (Number.isNaN(instant.getTime())) throw validation({ now: 'Use an ISO 8601 instant.' });
  await setBusinessNow(instant);
  clockMoved();
  pushToAll('network', { changed: true });
  return { status: 200, body: { now: businessNowIso() } };
}

type Json = Record<string, unknown>;

function list(body: Json, name: string): Json[] {
  const value = body[name];
  return Array.isArray(value) ? (value as Json[]) : [];
}

function instant(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** The seed body is created in one transaction, in the published order. */
export async function seed(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const body = jsonBody(ctx);
  const now = businessNow();
  const ids: Record<string, string> = {};

  await transact(async (client) => {
    await seedUsers(client, list(body, 'users'), ids, now);
    await seedCompanies(client, list(body, 'companies'), ids, now);
    await seedConnections(client, list(body, 'connections'), ids, now);
    await seedBlocks(client, list(body, 'blocks'), ids, now);
    await seedFollows(client, list(body, 'follows'), ids, now);
    await seedPosts(client, list(body, 'posts'), ids, now);
    await seedReposts(client, list(body, 'reposts'), ids, now);
    await seedReactions(client, list(body, 'reactions'), ids, now);
    await seedComments(client, list(body, 'comments'), ids, now);
    await seedEndorsements(client, list(body, 'endorsements'), ids, now);
    await seedMessages(client, list(body, 'messages'), ids, now);
    await seedJobs(client, list(body, 'jobs'), ids, now);
    await seedApplications(client, list(body, 'applications'), ids, now);
  });

  return { status: 201, body: { ids } };
}

async function seedUsers(
  client: PoolClient,
  users: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const user of users) {
    const email = String(user.email ?? '');
    const handle = String(user.handle ?? '');
    const clash = await client.query<{ id: string }>(
      'SELECT id FROM members WHERE lower(email) = lower($1) OR lower(handle) = lower($2)',
      [email, handle],
    );
    if (clash.rows.length > 0) {
      throw validation({
        [`users.${String(user.key ?? '')}`]: 'This email or handle is already registered.',
      });
    }
    const id = newId('mbr');
    ids[String(user.key ?? id)] = id;
    await client.query(
      `INSERT INTO members (id, email, handle, password_hash, name, headline, location, about, visibility, confirmed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
      [
        id,
        email,
        handle,
        hashPassword(String(user.password ?? 'plainwork-seed')),
        String(user.name ?? ''),
        String(user.headline ?? ''),
        String(user.location ?? ''),
        String(user.about ?? ''),
        String(user.visibility ?? 'public'),
        now,
      ],
    );
    const experience = Array.isArray(user.experience) ? (user.experience as Json[]) : [];
    for (const [index, entry] of experience.entries()) {
      await client.query(
        `INSERT INTO experience (id, member_id, position, title, company, start_ym, end_ym)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId('exp'),
          id,
          index,
          String(entry.title ?? ''),
          String(entry.company ?? ''),
          String(entry.start ?? ''),
          entry.end === null || entry.end === undefined ? null : String(entry.end),
        ],
      );
    }
    const education = Array.isArray(user.education) ? (user.education as Json[]) : [];
    for (const [index, entry] of education.entries()) {
      await client.query(
        `INSERT INTO education (id, member_id, position, school, degree, start_ym, end_ym)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId('edu'),
          id,
          index,
          String(entry.school ?? ''),
          String(entry.degree ?? ''),
          String(entry.start ?? ''),
          entry.end === null || entry.end === undefined ? null : String(entry.end),
        ],
      );
    }
    const skills = Array.isArray(user.skills) ? user.skills.map((name) => String(name)) : [];
    const featured = Array.isArray(user.featured) ? user.featured.map((name) => String(name)) : [];
    for (const name of skills) {
      const position = featured.findIndex((entry) => entry.toLowerCase() === name.toLowerCase());
      await client.query(
        'INSERT INTO skills (id, member_id, name, featured_position) VALUES ($1,$2,$3,$4)',
        [newId('skl'), id, name, position === -1 ? null : position + 1],
      );
    }
  }
}

async function seedCompanies(
  client: PoolClient,
  companies: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const company of companies) {
    const handle = String(company.handle ?? '');
    const clash = await client.query<{ id: string }>(
      'SELECT id FROM companies WHERE lower(handle) = lower($1)',
      [handle],
    );
    if (clash.rows.length > 0) {
      throw validation({
        [`companies.${String(company.key ?? '')}`]: 'This handle is already registered.',
      });
    }
    const id = newId('cmp');
    ids[String(company.key ?? id)] = id;
    await client.query(
      'INSERT INTO companies (id, handle, name, location, about, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        id,
        handle,
        String(company.name ?? ''),
        String(company.location ?? ''),
        String(company.about ?? ''),
        now,
      ],
    );
    const admins = Array.isArray(company.admins) ? company.admins.map((key) => String(key)) : [];
    for (const key of admins) {
      const memberId = ids[key];
      if (!memberId) continue;
      await client.query(
        'INSERT INTO company_admins (company_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, memberId],
      );
    }
  }
}

async function seedConnections(
  client: PoolClient,
  connections: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of connections) {
    const from = ids[String(entry.from ?? '')];
    const to = ids[String(entry.to ?? '')];
    if (!from || !to) continue;
    const at = instant(entry.at, now);
    const state = String(entry.state ?? 'connected');
    if (state === 'connected') {
      const [low, high] = from < to ? [from, to] : [to, from];
      await client.query(
        `INSERT INTO connections (id, member_a, member_b, connected_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (member_a, member_b) DO NOTHING`,
        [newId('con'), low, high, at],
      );
    } else {
      await client.query(
        `INSERT INTO invitations (id, sender_id, receiver_id, state, created_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId('inv'), from, to, state, at, state === 'pending' ? null : at],
      );
    }
  }
}

async function seedBlocks(
  client: PoolClient,
  blocks: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of blocks) {
    const blocker = ids[String(entry.blocker ?? '')];
    const blocked = ids[String(entry.blocked ?? '')];
    if (!blocker || !blocked) continue;
    await client.query(
      'INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [blocker, blocked, instant(entry.at, now)],
    );
  }
}

async function seedFollows(
  client: PoolClient,
  follows: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of follows) {
    const follower = ids[String(entry.follower ?? '')];
    const target = ids[String(entry.target ?? '')];
    if (!follower || !target) continue;
    await client.query(
      'INSERT INTO follows (follower_id, target_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [follower, target, instant(entry.at, now)],
    );
  }
}

async function insertHashtagsAndMentions(
  client: PoolClient,
  ownerKind: 'post' | 'comment',
  ownerId: string,
  authorId: string,
  text: string,
): Promise<void> {
  if (ownerKind === 'post') {
    for (const tag of hashtagsOf(text)) {
      await client.query(
        'INSERT INTO post_hashtags (post_id, tag_lower, tag_raw) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [ownerId, tag.toLowerCase(), tag],
      );
    }
  }
  const handles = mentionHandles(text);
  if (handles.length === 0) return;
  const found = await client.query<{ id: string; handle: string }>(
    `SELECT m.id, m.handle FROM members m WHERE m.handle = ANY($1)
     AND EXISTS (SELECT 1 FROM connections c WHERE (c.member_a = $2 AND c.member_b = m.id) OR (c.member_b = $2 AND c.member_a = m.id))`,
    [handles, authorId],
  );
  for (const row of found.rows) {
    await client.query(
      'INSERT INTO mentions (owner_kind, owner_id, member_id, handle) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [ownerKind, ownerId, row.id, row.handle],
    );
  }
}

async function seedPosts(
  client: PoolClient,
  posts: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of posts) {
    const author = ids[String(entry.author ?? '')];
    if (!author) continue;
    const id = newId('pst');
    ids[String(entry.key ?? id)] = id;
    const text = String(entry.text ?? '');
    await client.query(
      'INSERT INTO posts (id, author_id, text, created_at) VALUES ($1,$2,$3,$4)',
      [id, author, text, instant(entry.at, now)],
    );
    await insertHashtagsAndMentions(client, 'post', id, author, text);
  }
}

async function seedReposts(
  client: PoolClient,
  reposts: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of reposts) {
    const author = ids[String(entry.author ?? '')];
    const original = ids[String(entry.of ?? '')];
    if (!author || !original) continue;
    const at = instant(entry.at, now);
    if (entry.text === null || entry.text === undefined) {
      const id = newId('rps');
      ids[String(entry.key ?? id)] = id;
      await client.query(
        'INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [id, author, original, at],
      );
    } else {
      const id = newId('pst');
      ids[String(entry.key ?? id)] = id;
      const text = String(entry.text);
      await client.query(
        'INSERT INTO posts (id, author_id, text, created_at, shared_post_id) VALUES ($1,$2,$3,$4,$5)',
        [id, author, text, at, original],
      );
      await insertHashtagsAndMentions(client, 'post', id, author, text);
    }
  }
}

async function seedReactions(
  client: PoolClient,
  reactions: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of reactions) {
    const post = ids[String(entry.post ?? '')];
    const member = ids[String(entry.user ?? '')];
    if (!post || !member) continue;
    await client.query(
      `INSERT INTO reactions (post_id, member_id, type, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (post_id, member_id) DO UPDATE SET type = EXCLUDED.type`,
      [post, member, String(entry.type ?? 'like'), instant(entry.at, now)],
    );
  }
}

async function seedComments(
  client: PoolClient,
  comments: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of comments) {
    const post = ids[String(entry.post ?? '')];
    const author = ids[String(entry.author ?? '')];
    if (!post || !author) continue;
    const id = newId('cmt');
    ids[String(entry.key ?? id)] = id;
    const parentKey = entry.parent === null || entry.parent === undefined ? null : String(entry.parent);
    const text = String(entry.text ?? '');
    await client.query(
      'INSERT INTO comments (id, post_id, author_id, parent_id, text, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, post, author, parentKey ? (ids[parentKey] ?? null) : null, text, instant(entry.at, now)],
    );
    await insertHashtagsAndMentions(client, 'comment', id, author, text);
  }
}

async function seedEndorsements(
  client: PoolClient,
  endorsements: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of endorsements) {
    const endorser = ids[String(entry.endorser ?? '')];
    const owner = ids[String(entry.owner ?? '')];
    if (!endorser || !owner) continue;
    const skill = await client.query<{ id: string }>(
      'SELECT id FROM skills WHERE member_id = $1 AND lower(name) = lower($2)',
      [owner, String(entry.skill ?? '')],
    );
    if (skill.rows.length === 0) continue;
    await client.query(
      'INSERT INTO endorsements (skill_id, endorser_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [skill.rows[0].id, endorser, instant(entry.at, now)],
    );
  }
}

async function seedMessages(
  client: PoolClient,
  messages: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of messages) {
    const from = ids[String(entry.from ?? '')];
    const to = ids[String(entry.to ?? '')];
    if (!from || !to) continue;
    const [low, high] = from < to ? [from, to] : [to, from];
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM conversations WHERE member_a = $1 AND member_b = $2',
      [low, high],
    );
    let conversationId = existing.rows[0]?.id;
    if (!conversationId) {
      conversationId = newId('cnv');
      await client.query(
        'INSERT INTO conversations (id, member_a, member_b, created_at) VALUES ($1,$2,$3,$4)',
        [conversationId, low, high, instant(entry.at, now)],
      );
    }
    const id = newId('msg');
    ids[String(entry.key ?? id)] = id;
    await client.query(
      'INSERT INTO messages (id, conversation_id, sender_id, text, sent_at, read_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        id,
        conversationId,
        from,
        String(entry.text ?? ''),
        instant(entry.at, now),
        entry.read_at === null || entry.read_at === undefined ? null : instant(entry.read_at, now),
      ],
    );
  }
}

async function seedJobs(
  client: PoolClient,
  jobs: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of jobs) {
    const company = ids[String(entry.company ?? '')];
    const poster = ids[String(entry.poster ?? '')];
    if (!company || !poster) continue;
    const id = newId('job');
    ids[String(entry.key ?? id)] = id;
    await client.query(
      `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        company,
        poster,
        String(entry.title ?? ''),
        String(entry.location ?? ''),
        String(entry.workplace ?? 'on-site'),
        String(entry.description ?? ''),
        instant(entry.posted_at, now),
        instant(entry.closes_at, new Date(now.getTime() + 2592000000)),
      ],
    );
    const questions = Array.isArray(entry.questions) ? (entry.questions as Json[]) : [];
    for (const [index, question] of questions.entries()) {
      const questionId = newId('qst');
      ids[String(question.key ?? questionId)] = questionId;
      const options = Array.isArray(question.options) ? question.options.map((o) => String(o)) : null;
      const accepted = Array.isArray(question.accepted)
        ? question.accepted.map((o) => String(o))
        : null;
      await client.query(
        `INSERT INTO job_questions (id, job_id, position, type, text, required, knock_out, ideal, options, accepted, minimum, maximum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          questionId,
          id,
          index + 1,
          String(question.type ?? 'short_answer'),
          String(question.text ?? ''),
          question.required === true,
          question.knock_out === true,
          question.ideal === null || question.ideal === undefined ? null : String(question.ideal),
          options ? JSON.stringify(options) : null,
          accepted ? JSON.stringify(accepted) : null,
          question.minimum === null || question.minimum === undefined ? null : Number(question.minimum),
          question.maximum === null || question.maximum === undefined ? null : Number(question.maximum),
        ],
      );
    }
  }
}

async function seedApplications(
  client: PoolClient,
  applications: Json[],
  ids: Record<string, string>,
  now: Date,
): Promise<void> {
  for (const entry of applications) {
    const job = ids[String(entry.job ?? '')];
    const applicant = ids[String(entry.applicant ?? '')];
    if (!job || !applicant) continue;
    const id = newId('app');
    ids[String(entry.key ?? id)] = id;
    const at = instant(entry.at, now);
    const state = String(entry.state ?? 'applied');
    const rawAnswers = (entry.answers ?? {}) as Record<string, unknown>;
    const answers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawAnswers)) {
      answers[ids[key] ?? key] = value;
    }
    await client.query(
      `INSERT INTO applications (id, job_id, applicant_id, state, created_at, entered_at, answers)
       VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [id, job, applicant, state, at, JSON.stringify(answers)],
    );
    const history = Array.isArray(entry.history) ? (entry.history as Json[]) : [];
    const entries = history.length > 0 ? history : [{ state, at: at.toISOString(), by: 'you' }];
    for (const [index, historyEntry] of entries.entries()) {
      await client.query(
        `INSERT INTO application_history (id, application_id, seq, state, at, by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId('hist'),
          id,
          index + 1,
          String(historyEntry.state ?? state),
          instant(historyEntry.at, at),
          String(historyEntry.by ?? 'you'),
          historyEntry.reason === null || historyEntry.reason === undefined
            ? null
            : String(historyEntry.reason),
        ],
      );
    }
    const last = entries[entries.length - 1];
    await client.query('UPDATE applications SET entered_at = $2 WHERE id = $1', [
      id,
      instant(last.at, at),
    ]);
  }
}
