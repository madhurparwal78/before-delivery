import { Router, Request, Response } from 'express';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { moveClock, businessMs } from '../clock.js';
import { errors, newId } from '../errors.js';
import { hashPassword } from '../password.js';
import { broadcast } from '../live.js';
import { wrap } from '../http.js';

const guard = (req: Request, res: Response, next: () => void): void => {
  if (!config.gradingKey || req.headers['x-grading-key'] !== config.gradingKey) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
};

type SeedBody = {
  users?: SeedUser[];
  companies?: SeedCompany[];
  connections?: SeedConnection[];
  blocks?: SeedBlock[];
  follows?: SeedFollow[];
  posts?: SeedPost[];
  reposts?: SeedRepost[];
  reactions?: SeedReaction[];
  comments?: SeedComment[];
  endorsements?: SeedEndorsement[];
  messages?: SeedMessage[];
  jobs?: SeedJob[];
  applications?: SeedApplication[];
};

type SeedUser = {
  key: string; email: string; password: string; name: string; handle: string;
  headline?: string; location?: string; visibility?: string; about?: string;
  experience?: { title: string; company: string; start: string; end: string | null }[];
  education?: { school: string; degree: string; start: string; end: string | null }[];
  skills?: string[]; featured?: string[];
};
type SeedCompany = { key: string; name: string; handle: string; location?: string; admins: string[] };
type SeedConnection = { from: string; to: string; state: string; at: string };
type SeedBlock = { blocker: string; blocked: string; at: string };
type SeedFollow = { follower: string; target: string; at: string };
type SeedPost = { key: string; author: string; text: string; at: string; photo?: boolean };
type SeedRepost = { key: string; author: string; of: string; text: string | null; at: string };
type SeedReaction = { post: string; user: string; type: string; at: string };
type SeedComment = { key: string; post: string; author: string; parent: string | null; text: string; at: string };
type SeedEndorsement = { endorser: string; owner: string; skill: string; at: string };
type SeedMessage = { from: string; to: string; text: string; at: string; read_at?: string | null };
type SeedJob = {
  key: string; company: string; poster: string; title: string; location: string;
  workplace: string; posted_at: string; closes_at: string; description: string;
  questions?: SeedQuestion[];
};
type SeedQuestion = {
  key: string; type: string; text: string; required?: boolean; knock_out?: boolean;
  ideal?: string | null; options?: string[] | null; accepted?: string[] | null;
  minimum?: number | null; maximum?: number | null;
};
type SeedApplication = {
  key: string; job: string; applicant: string; state: string; at: string;
  answers?: Record<string, unknown>;
  history?: { state: string; at: string; by: string; reason?: string | null }[];
};

export const gradingRouter = (): Router => {
  const router = Router();

  router.post('/grading/clock', guard, wrap(async (req, res) => {
    const { now: instant } = (req.body ?? {}) as { now?: string };
    if (!instant) throw errors.notFound();
    const moved = moveClock(instant);
    broadcast('clock', { now: moved.toISOString() });
    res.json({ now: moved.toISOString() });
  }));

  router.post('/grading/seed', guard, wrap(async (req, res) => {
    const body = (req.body ?? {}) as SeedBody;
    const ids: Record<string, string> = {};
    const userByKey = new Map<string, string>();
    const companyByKey = new Map<string, string>();
    const postByKey = new Map<string, string>();
    const questionByKey = new Map<string, string>();
    const applicationByKey = new Map<string, string>();

    // Duplicate emails or handles answer 422 and nothing is created.
    const fields: Record<string, string> = {};
    const seenEmails = new Set<string>();
    const seenHandles = new Set<string>();
    for (const user of body.users ?? []) {
      const emailTaken = await query(`SELECT 1 FROM members WHERE lower(email) = lower($1)`, [user.email]);
      if (emailTaken.rows.length > 0 || seenEmails.has(user.email)) {
        fields[`users.${user.key}.email`] = 'This email is already registered.';
      }
      const handleTaken = await query(`SELECT 1 FROM members WHERE lower(handle) = lower($1)`, [user.handle]);
      if (handleTaken.rows.length > 0 || seenHandles.has(user.handle)) {
        fields[`users.${user.key}.handle`] = 'This handle is taken.';
      }
      seenEmails.add(user.email);
      seenHandles.add(user.handle);
    }
    if (Object.keys(fields).length > 0) throw errors.validation(fields);

    await withTransaction(async (client) => {
      for (const user of body.users ?? []) {
        const id = newId();
        ids[user.key] = id;
        userByKey.set(user.key, id);
        const hash = await hashPassword(user.password);
        await client.query(
          `INSERT INTO members (id, email, handle, password_hash, name, headline, location, visibility, confirmed, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
          [id, user.email, user.handle, hash, user.name, user.headline ?? '', user.location ?? '',
           user.visibility ?? 'public', new Date(businessMs())]);
        await client.query(`INSERT INTO profile_sections (member_id, about) VALUES ($1, $2)`, [id, user.about ?? '']);
        let pos = 0;
        for (const experience of user.experience ?? []) {
          await client.query(
            `INSERT INTO experience (id, member_id, title, company, start_month, end_month, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newId(), id, experience.title, experience.company, experience.start, experience.end, pos++]);
        }
        pos = 0;
        for (const education of user.education ?? []) {
          await client.query(
            `INSERT INTO education (id, member_id, school, degree, start_month, end_month, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newId(), id, education.school, education.degree, education.start, education.end, pos++]);
        }
        const skillIds = new Map<string, string>();
        for (const skill of user.skills ?? []) {
          const skillId = newId();
          skillIds.set(skill.toLowerCase(), skillId);
          await client.query(`INSERT INTO skills (id, member_id, name) VALUES ($1, $2, $3)`, [skillId, id, skill]);
        }
        let fpos = 1;
        for (const featured of user.featured ?? []) {
          const skillId = skillIds.get(featured.toLowerCase());
          if (skillId) {
            await client.query(`INSERT INTO featured_skills (member_id, skill_id, position) VALUES ($1, $2, $3)`,
              [id, skillId, fpos++]);
          }
        }
      }

      for (const company of body.companies ?? []) {
        const id = newId();
        ids[company.key] = id;
        companyByKey.set(company.key, id);
        await client.query(
          `INSERT INTO companies (id, handle, name, location) VALUES ($1, $2, $3, $4)`,
          [id, company.handle, company.name, company.location ?? '']);
        for (const admin of company.admins) {
          const adminId = userByKey.get(admin);
          if (adminId) {
            await client.query(`INSERT INTO company_admins (company_id, member_id) VALUES ($1, $2)`, [id, adminId]);
          }
        }
      }

      for (const connection of body.connections ?? []) {
        const from = userByKey.get(connection.from);
        const to = userByKey.get(connection.to);
        if (!from || !to) continue;
        const at = new Date(connection.at);
        if (connection.state === 'connected') {
          await client.query(
            `INSERT INTO connections (requester_id, addressee_id, state, requested_at, connected_at)
             VALUES ($1, $2, 'connected', $3, $3) ON CONFLICT DO NOTHING`, [from, to, at]);
        } else if (connection.state === 'withdrawn') {
          await client.query(
            `INSERT INTO connections (requester_id, addressee_id, state, requested_at, withdrawn_at)
             VALUES ($1, $2, 'withdrawn', $3, $3) ON CONFLICT DO NOTHING`, [from, to, at]);
        } else if (connection.state === 'ignored') {
          await client.query(
            `INSERT INTO connections (requester_id, addressee_id, state, requested_at, ignored_at)
             VALUES ($1, $2, 'ignored', $3, $3) ON CONFLICT DO NOTHING`, [from, to, at]);
        } else {
          await client.query(
            `INSERT INTO connections (requester_id, addressee_id, state, requested_at)
             VALUES ($1, $2, 'pending', $3) ON CONFLICT DO NOTHING`, [from, to, at]);
        }
      }

      for (const block of body.blocks ?? []) {
        const blocker = userByKey.get(block.blocker);
        const blocked = userByKey.get(block.blocked);
        if (!blocker || !blocked) continue;
        await client.query(`INSERT INTO blocks (blocker_id, blocked_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [blocker, blocked, new Date(block.at)]);
      }

      for (const follow of body.follows ?? []) {
        const follower = userByKey.get(follow.follower);
        const target = userByKey.get(follow.target) ?? companyByKey.get(follow.target);
        if (!follower || !target) continue;
        await client.query(`INSERT INTO follows (follower_id, target_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [follower, target, new Date(follow.at)]);
      }

      for (const post of body.posts ?? []) {
        const author = userByKey.get(post.author);
        if (!author) continue;
        const id = newId();
        ids[post.key] = id;
        postByKey.set(post.key, id);
        await client.query(
          `INSERT INTO posts (id, author_id, text, created_at) VALUES ($1, $2, $3, $4)`,
          [id, author, post.text, new Date(post.at)]);
      }

      for (const repost of body.reposts ?? []) {
        const author = userByKey.get(repost.author);
        const original = postByKey.get(repost.of);
        if (!author || !original) continue;
        const id = newId();
        ids[repost.key] = id;
        postByKey.set(repost.key, id);
        if (repost.text === null || repost.text === undefined) {
          await client.query(
            `INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1, $2, $3, $4)`,
            [id, author, original, new Date(repost.at)]);
        } else {
          await client.query(
            `INSERT INTO posts (id, author_id, text, shared_post_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [id, author, repost.text, original, new Date(repost.at)]);
        }
      }

      for (const reaction of body.reactions ?? []) {
        const post = postByKey.get(reaction.post);
        const user = userByKey.get(reaction.user);
        if (!post || !user) continue;
        await client.query(
          `INSERT INTO reactions (post_id, member_id, type, at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (post_id, member_id) DO UPDATE SET type = $3, at = $4`,
          [post, user, reaction.type, new Date(reaction.at)]);
      }

      for (const comment of body.comments ?? []) {
        const post = postByKey.get(comment.post);
        const author = userByKey.get(comment.author);
        if (!post || !author) continue;
        const id = newId();
        ids[comment.key] = id;
        let parentId: string | null = null;
        if (comment.parent) {
          const parentCommentId = ids[comment.parent];
          if (parentCommentId) {
            const parent = await client.query(`SELECT parent_id FROM comments WHERE id = $1`, [parentCommentId]);
            parentId = parent.rows[0]?.parent_id ?? parentCommentId;
          }
        }
        await client.query(
          `INSERT INTO comments (id, post_id, parent_id, author_id, text, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, post, parentId, author, comment.text, new Date(comment.at)]);
      }

      for (const endorsement of body.endorsements ?? []) {
        const endorser = userByKey.get(endorsement.endorser);
        const owner = userByKey.get(endorsement.owner);
        if (!endorser || !owner) continue;
        const skill = await client.query(`SELECT id FROM skills WHERE member_id = $1 AND lower(name) = lower($2)`,
          [owner, endorsement.skill]);
        if (skill.rows.length === 0) continue;
        await client.query(
          `INSERT INTO endorsements (owner_id, skill_id, endorser_id, at) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`, [owner, skill.rows[0].id, endorser, new Date(endorsement.at)]);
      }

      for (const message of body.messages ?? []) {
        const from = userByKey.get(message.from);
        const to = userByKey.get(message.to);
        if (!from || !to) continue;
        let conversationId: string | null = null;
        const existing = await client.query(
          `SELECT conversation_id FROM conversation_members WHERE member_id = $1 AND other_id = $2`, [from, to]);
        if (existing.rows.length > 0) {
          conversationId = existing.rows[0].conversation_id;
        } else {
          conversationId = newId();
          await client.query(`INSERT INTO conversations (id, created_at) VALUES ($1, $2)`,
            [conversationId, new Date(message.at)]);
          await client.query(
            `INSERT INTO conversation_members (conversation_id, member_id, other_id) VALUES ($1, $2, $3), ($1, $3, $2)`,
            [conversationId, from, to]);
        }
        await client.query(
          `INSERT INTO messages (id, conversation_id, sender_id, text, sent_at, read_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId(), conversationId, from, message.text, new Date(message.at),
           message.read_at ? new Date(message.read_at) : null]);
      }

      for (const job of body.jobs ?? []) {
        const company = companyByKey.get(job.company);
        const poster = userByKey.get(job.poster);
        if (!company || !poster) continue;
        const id = newId();
        ids[job.key] = id;
        await client.query(
          `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, posted_at, closes_at, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, company, poster, job.title, job.location, job.workplace,
           new Date(job.posted_at), new Date(job.closes_at), job.description]);
        let position = 0;
        for (const question of job.questions ?? []) {
          const questionId = newId();
          ids[question.key] = questionId;
          questionByKey.set(question.key, questionId);
          await client.query(
            `INSERT INTO screening_questions (id, job_id, type, text, required, knock_out, ideal, options, accepted, minimum, maximum, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
            [questionId, id, question.type, question.text, question.required ?? false, question.knock_out ?? false,
             question.ideal ?? null, JSON.stringify(question.options ?? null),
             JSON.stringify(question.accepted ?? null), question.minimum ?? null, question.maximum ?? null,
             position++]);
        }
      }

      for (const application of body.applications ?? []) {
        const job = ids[application.job];
        const applicant = userByKey.get(application.applicant);
        if (!job || !applicant) continue;
        const id = newId();
        ids[application.key] = id;
        applicationByKey.set(application.key, id);
        await client.query(
          `INSERT INTO applications (id, job_id, applicant_id, state, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, job, applicant, application.state, new Date(application.at)]);
        const history = application.history && application.history.length > 0
          ? application.history
          : [{ state: application.state, at: application.at, by: 'you' }];
        for (const entry of history) {
          await client.query(
            `INSERT INTO application_history (id, application_id, state, at, by, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [newId(), id, entry.state, new Date(entry.at), entry.by, entry.reason ?? null]);
        }
        for (const [questionKey, answer] of Object.entries(application.answers ?? {})) {
          const questionId = questionByKey.get(questionKey) ?? ids[questionKey];
          if (!questionId) continue;
          await client.query(
            `INSERT INTO application_answers (application_id, question_id, answer) VALUES ($1, $2, $3::jsonb)`,
            [id, questionId, JSON.stringify(answer)]);
        }
      }
    });

    res.status(201).json({ ids });
  }));

  return router;
};
