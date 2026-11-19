import { advanceClock, isoUtc, serverNow } from '../clock.js';
import { config } from '../config.js';
import { withTx, type Db } from '../db.js';
import { ApiError, invalidFields, notFound } from '../errors.js';
import { EventSink, flushLive, publish } from '../live.js';
import { newSessionToken, sendJson, type Ctx } from '../http.js';
import { processDueTimers } from '../scheduler.js';
import { createUser } from '../../domain/accounts.js';
import { getChange, getRepo, getUserByUsername, listReviews, type RepoRow } from '../../domain/model.js';
import { performPush } from '../../domain/push.js';
import { admitToQueue, entryReportArrived } from '../../domain/queue.js';
import { dismissReview, requestReview, submitReview, type ReviewType } from '../../domain/reviews.js';
import { createRevision, getBranchRevision, setBranchRevision } from '../../domain/revisions.js';
import { createThread, lineIsInDiff } from '../../domain/threads.js';
import { loadChangeView } from '../../domain/changeview.js';
import { randomTokenValue, tokenHash } from './accounts.js';
import { body } from './common.js';

function guard(ctx: Ctx): void {
  if (ctx.request.headers['x-grading-key'] !== config.gradingKey) throw notFound();
}

type StepResult = Record<string, unknown>;

interface SetupUser {
  email: string;
  username: string;
  name: string;
  password: string;
}

interface SetupOrg {
  slug: string;
  name: string;
  owner: string;
  members?: string[];
  teams?: Array<{ name: string; members?: string[] }>;
}

interface SetupRepo {
  org: string;
  name: string;
  visibility?: 'private' | 'public';
  roles?: Array<{ subject: string; role: string }>;
  settings?: { required_approvals?: number; required_checks?: string[]; queue?: boolean };
  steps?: Array<Record<string, unknown>>;
}

async function createSession(tx: Db, userId: number): Promise<string> {
  const token = newSessionToken();
  await tx.query('INSERT INTO rs_sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    serverNow(),
  ]);
  return token;
}

async function runStep(
  tx: Db,
  repo: RepoRow,
  step: Record<string, unknown>,
  keys: Record<string, StepResult>,
  sink: EventSink,
): Promise<StepResult> {
  const actorName = String(step.as);
  const actor = await getUserByUsername(tx, actorName);
  if (!actor) throw notFound();
  const person = { username: actor.username, name: actor.name };

  const changeOf = async (key: string) => {
    const number = Number((keys[key] as { number: number }).number);
    return (await getChange(tx, repo.id, number))!;
  };

  if (step.push !== undefined) {
    const push = step.push as { branch: string; from?: string; message: string; files: Record<string, string | null> };
    const branchHead = await getBranchRevision(tx, repo.id, push.branch);
    const files = Object.entries(push.files ?? {}).map(([path, content]) =>
      content === null ? { path, delete: true } : { path, content },
    );
    const result = await performPush(
      tx,
      repo,
      {
        branch: push.branch,
        expectedHead: branchHead,
        from: branchHead === null ? push.from ?? repo.defaultBranch : null,
        message: push.message,
        files,
        actor: person,
      },
      sink,
    );
    return { revision: result.revision };
  }

  if (step.change !== undefined) {
    const input = step.change as { title: string; head: string; base: string; draft?: boolean };
    const baseRevision = (await getBranchRevision(tx, repo.id, input.base))!;
    const numbers = await tx.query<{ number: number }>(
      'UPDATE rs_repos SET next_change_number = next_change_number + 1 WHERE id = $1 RETURNING next_change_number - 1 AS number',
      [repo.id],
    );
    const number = Number(numbers[0].number);
    await tx.query(
      `INSERT INTO rs_changes (repo_id, number, title, description, author_user_id, head_branch, base_branch,
         base_revision, state, created_at) VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, $9)`,
      [
        repo.id,
        number,
        input.title,
        actor.id,
        input.head,
        input.base,
        baseRevision,
        input.draft === true ? 'draft' : 'open',
        serverNow(),
      ],
    );
    return { number, id: `${repo.org}/${repo.name}#${number}` };
  }

  if (step.ready !== undefined) {
    const change = await changeOf(String((step.ready as { change: string }).change));
    await tx.query("UPDATE rs_changes SET state = 'open' WHERE id = $1", [change.id]);
    return {};
  }

  if (step.review !== undefined) {
    const input = step.review as { change: string; type: ReviewType; summary?: string };
    const change = await changeOf(input.change);
    const id = await submitReview(tx, repo, change, actor, input.type, input.summary ?? '', sink);
    return { id };
  }

  if (step.dismiss !== undefined) {
    const input = step.dismiss as { review: string; reason: string };
    const reviewId = Number((keys[input.review] as { id: number }).id);
    const rows = await tx.query<{ change_id: string }>('SELECT change_id FROM rs_reviews WHERE id = $1', [reviewId]);
    const change = (await tx.query<{ number: number }>('SELECT number FROM rs_changes WHERE id = $1', [
      rows[0].change_id,
    ]))[0];
    const changeRow = (await getChange(tx, repo.id, Number(change.number)))!;
    const review = (await listReviews(tx, changeRow.id)).find((item) => item.id === reviewId)!;
    await dismissReview(tx, changeRow, review, input.reason, actor, sink);
    return { id: reviewId };
  }

  if (step.thread !== undefined) {
    const input = step.thread as {
      change: string;
      path: string;
      side?: 'old' | 'new';
      line: number;
      end_line?: number;
      body: string;
      suggestion?: string[];
    };
    const change = await changeOf(input.change);
    const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
    const side = input.side === 'old' ? 'old' : 'new';
    if (!(await lineIsInDiff(tx, repo, change, headRevision, input.path, side, input.line))) {
      throw invalidFields({ line: `Line ${input.line} is not in the diff` });
    }
    const threadId = await createThread(tx, change, {
      path: input.path,
      side,
      line: input.line,
      endLine: input.end_line ?? input.line,
      body: input.body,
      authorUserId: actor.id,
      revisionId: side === 'new' ? headRevision : change.baseRevision,
      suggestion: input.suggestion ?? null,
    });
    sink.add({ kind: 'comment', text: `#${change.number}: new comment from ${actor.name}`, change: change.number });
    const comment = await tx.query<{ id: string }>(
      'SELECT id FROM rs_comments WHERE thread_id = $1 ORDER BY id LIMIT 1',
      [threadId],
    );
    return { id: threadId, comment: Number(comment[0].id) };
  }

  if (step.request_review !== undefined) {
    const input = step.request_review as { change: string; username: string };
    const change = await changeOf(input.change);
    await requestReview(tx, repo, change, input.username);
    return {};
  }

  if (step.check !== undefined) {
    const input = step.check as { revision: string; name: string; state: string; summary?: string };
    const revisionId = keys[input.revision]
      ? String((keys[input.revision] as { revision: string }).revision)
      : input.revision;
    await tx.query(
      'INSERT INTO rs_check_reports (repo_id, revision_id, name, state, summary, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [repo.id, revisionId, input.name, input.state, input.summary ?? '', serverNow()],
    );
    const change = await (async () => {
      for (const row of await tx.query<{ number: number }>('SELECT number FROM rs_changes WHERE repo_id = $1', [
        repo.id,
      ])) {
        const item = (await getChange(tx, repo.id, Number(row.number)))!;
        const head = await getBranchRevision(tx, repo.id, item.headBranch);
        if (head === revisionId) return item;
      }
      return null;
    })();
    if (change) {
      sink.add({ kind: 'check', text: `#${change.number}: check ${input.name} reported`, change: change.number });
    }
    await entryReportArrived(tx, repo, revisionId, sink);
    return { revision: revisionId, name: input.name, state: input.state };
  }

  if (step.queue !== undefined) {
    const change = await changeOf(String((step.queue as { change: string }).change));
    const entry = await admitToQueue(tx, repo, change, sink);
    return { id: entry.id, revision: entry.revisionId, state: entry.state };
  }

  if (step.token !== undefined) {
    const input = step.token as { name: string; access: 'read' | 'write' };
    const value = randomTokenValue();
    const rows = await tx.query<{ id: string }>(
      'INSERT INTO rs_tokens (repo_id, name, access, token_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [repo.id, input.name, input.access, tokenHash(value)],
    );
    return { id: Number(rows[0].id), token: value };
  }

  if (step.viewed !== undefined) {
    const input = step.viewed as { change: string; path: string };
    const change = await changeOf(input.change);
    const view = await loadChangeView(tx, repo, change, actor.id);
    const file = view.files.find((entry) => entry.path === input.path);
    if (!file) throw invalidFields({ path: 'Path is not in this change' });
    await tx.query(
      `INSERT INTO rs_viewed (change_id, user_id, path, content_key) VALUES ($1, $2, $3, $4)
       ON CONFLICT (change_id, user_id, path) DO UPDATE SET content_key = $4`,
      [change.id, actor.id, input.path, file.headKey ?? ''],
    );
    return {};
  }

  throw invalidFields({ steps: 'Unknown step' });
}

export async function handleGradingSetup(ctx: Ctx): Promise<void> {
  guard(ctx);
  const input = body(ctx);
  const users = (input.users as SetupUser[]) ?? [];
  const orgs = (input.orgs as SetupOrg[]) ?? [];
  const repos = (input.repos as SetupRepo[]) ?? [];

  const answer: {
    users: Record<string, { cookie: string }>;
    repos: Record<string, { id: number; keys: Record<string, StepResult> }>;
  } = { users: {}, repos: {} };

  await withTx(async (tx) => {
    for (const user of users) {
      if (await getUserByUsername(tx, user.username)) {
        throw new ApiError(409, { error: `Already exists: user ${user.username}` });
      }
      const created = await createUser(tx, { ...user, confirmed: true });
      answer.users[user.username] = { cookie: await createSession(tx, created.id) };
    }

    for (const org of orgs) {
      const existing = await tx.query('SELECT 1 FROM rs_orgs WHERE slug = $1', [org.slug]);
      if (existing.length > 0) throw new ApiError(409, { error: `Already exists: org ${org.slug}` });
      const owner = (await getUserByUsername(tx, org.owner))!;
      const rows = await tx.query<{ id: string }>(
        'INSERT INTO rs_orgs (slug, name, owner_user_id) VALUES ($1, $2, $3) RETURNING id',
        [org.slug, org.name, owner.id],
      );
      const orgId = Number(rows[0].id);
      for (const team of org.teams ?? []) {
        const teamRows = await tx.query<{ id: string }>(
          'INSERT INTO rs_teams (org_id, name) VALUES ($1, $2) RETURNING id',
          [orgId, team.name],
        );
        for (const member of team.members ?? []) {
          const user = (await getUserByUsername(tx, member))!;
          await tx.query('INSERT INTO rs_team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
            teamRows[0].id,
            user.id,
          ]);
        }
      }
    }
  });

  for (const repo of repos) {
    const sink = new EventSink();
    let repoId = 0;
    await withTx(async (tx) => {
      const existing = await getRepo(tx, repo.org, repo.name);
      if (existing) throw new ApiError(409, { error: `Already exists: repo ${repo.org}/${repo.name}` });
      const orgRows = await tx.query<{ id: string; owner_user_id: string }>(
        'SELECT id, owner_user_id FROM rs_orgs WHERE slug = $1',
        [repo.org],
      );
      if (orgRows.length === 0) throw notFound();
      const settings = repo.settings ?? {};
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO rs_repos (org_id, name, visibility, default_branch, required_approvals, required_checks, queue_on)
         VALUES ($1, $2, $3, 'main', $4, $5, $6) RETURNING id`,
        [
          orgRows[0].id,
          repo.name,
          repo.visibility ?? 'private',
          settings.required_approvals ?? 1,
          settings.required_checks ?? [],
          settings.queue ?? false,
        ],
      );
      repoId = Number(rows[0].id);
      await tx.query("INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, 'owner')", [
        repoId,
        orgRows[0].owner_user_id,
      ]);
      for (const grant of repo.roles ?? []) {
        const [kind, value] = grant.subject.split(':');
        if (kind === 'user') {
          const user = (await getUserByUsername(tx, value))!;
          await tx.query(
            `INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, $3)
             ON CONFLICT (repo_id, subject_type, subject_id) DO UPDATE SET role = $3`,
            [repoId, user.id, grant.role],
          );
        } else {
          const teamName = value.includes('/') ? value.split('/')[1] : value;
          const teamRows = await tx.query<{ id: string }>(
            'SELECT id FROM rs_teams WHERE org_id = $1 AND name = $2',
            [orgRows[0].id, teamName],
          );
          if (teamRows.length === 0) throw notFound();
          await tx.query(
            `INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'team', $2, $3)
             ON CONFLICT (repo_id, subject_type, subject_id) DO UPDATE SET role = $3`,
            [repoId, teamRows[0].id, grant.role],
          );
        }
      }

      const creator = (await tx.query<{ username: string; name: string }>(
        'SELECT username, name FROM rs_users WHERE id = $1',
        [orgRows[0].owner_user_id],
      ))[0];
      const root = await createRevision(tx, repoId, {
        parents: [],
        message: 'Initial revision',
        authorUsername: creator.username,
        authorName: creator.name,
        contents: new Map(),
      });
      await setBranchRevision(tx, repoId, 'main', root);

      const keys: Record<string, StepResult> = {};
      for (const step of repo.steps ?? []) {
        const current = (await getRepo(tx, repo.org, repo.name))!;
        const result = await runStep(tx, current, step, keys, sink);
        if (typeof step.key === 'string') keys[step.key] = result;
      }
      answer.repos[`${repo.org}/${repo.name}`] = { id: repoId, keys };
    });
    publish(repoId, sink.list());
  }

  sendJson(ctx.response, 201, answer);
}

export async function handleGradingClock(ctx: Ctx): Promise<void> {
  guard(ctx);
  const seconds = body(ctx).advance_seconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
    throw invalidFields({ advance_seconds: 'Must be a whole number from 0 to 86400' });
  }
  const offset = await withTx((tx) => advanceClock(tx, seconds));
  await processDueTimers();
  await flushLive();
  sendJson(ctx.response, 200, { now: isoUtc(serverNow()), offset_seconds: offset });
}
