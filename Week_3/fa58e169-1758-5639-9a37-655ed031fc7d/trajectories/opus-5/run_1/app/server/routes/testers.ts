import { randomUUID } from 'node:crypto';
import { createSession, createUser, currentUser, newToken, passwordMatches, requireUser, userByEmail } from '../auth';
import { limits } from '../config';
import { copy } from '../copy';
import { one, query } from '../db';
import { ApiError, conflict, invalid, notFound, type Router } from '../http';
import { invitationMail, MAIL_FAILED, noteMail, sendMail } from '../mail';
import { publish } from '../live';
import {
  analyse,
  cellsPayload,
  designerPattern,
  getPattern,
  latestVersion,
  loadVersionChart,
  roleOf,
  rowsPayload,
  testerPattern,
  type PatternRow,
} from '../patterns';
import { counterSet, counterStep } from '../valkey';
import { hoursSince, validEmail } from './accounts';
import { testerList } from './charts';

interface InviteRow {
  id: string;
  pattern_id: string;
  email: string;
  user_id: string | null;
  status: string;
  token: string;
  sent_at: Date;
  version: number | null;
  row: number;
}

function inviteStatus(invite: InviteRow): 'sent' | 'accepted' | 'expired' {
  if (invite.status === 'accepted') return 'accepted';
  if (hoursSince(invite.sent_at) > limits.inviteTtlHours) return 'expired';
  return 'sent';
}

async function versionHeight(pattern: PatternRow, version: number): Promise<number> {
  const loaded = await loadVersionChart(pattern, version);
  return loaded ? loaded.chart.height : pattern.height;
}

async function publishTesters(pattern: PatternRow): Promise<void> {
  await publish(pattern.id, { kind: 'testers', testers: await testerList(pattern.id) });
}

export function registerTesterRoutes(router: Router): void {
  router.post('/api/patterns/:id/testers', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern } = await designerPattern(user, ctx.params.id);
    if (!validEmail(ctx.body.email)) throw invalid('email', copy.testerEmail);
    const email = (ctx.body.email as string).trim();
    const already = await one(
      `select 1 from testers where pattern_id = $1 and lower(email) = lower($2) and status = 'accepted'`,
      [pattern.id, email],
    );
    if (already) throw conflict('already_testing', copy.testerAlready);
    const version = await latestVersion(pattern.id);
    if (version === 0) throw conflict('no_version', copy.testerNoVersion);

    const id = randomUUID();
    const token = newToken();
    const account = await userByEmail(email);
    await query(
      `insert into testers (id, pattern_id, email, user_id, status, token, version, row)
       values ($1, $2, $3, $4, 'sent', $5, $6, 1)`,
      [id, pattern.id, email, account?.id ?? null, token, version],
    );
    const mail = invitationMail(pattern.name, token);
    try {
      await sendMail(email, mail.subject, mail.body);
    } catch {
      await query('delete from testers where id = $1', [id]);
      throw new ApiError(503, { error: 'mail_unavailable', message: MAIL_FAILED });
    }
    ctx.res.statusCode = 201;
    return { id, email, status: 'sent' };
  });

  router.get('/api/invites/:token', async (ctx) => {
    const invite = await one<InviteRow>('select * from testers where token = $1', [ctx.params.token]);
    if (!invite) throw notFound();
    const pattern = await getPattern(invite.pattern_id);
    if (!pattern) throw notFound();
    const account = await userByEmail(invite.email);
    return {
      patternName: pattern.name,
      hasAccount: account !== null,
      status: inviteStatus(invite),
    };
  });

  router.post('/api/invites/:token/accept', async (ctx) => {
    const invite = await one<InviteRow>('select * from testers where token = $1', [ctx.params.token]);
    if (!invite) throw notFound();
    const pattern = await getPattern(invite.pattern_id);
    if (!pattern) throw notFound();
    const account = await userByEmail(invite.email);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    let name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';

    if (account) {
      if (password.length < 10) throw invalid('password', copy.signUpPassword);
      if (!passwordMatches(password, account.passwordHash)) {
        throw new ApiError(401, { error: 'invalid_credentials', message: copy.signInWrong });
      }
    } else {
      if (name === '') throw invalid('name', copy.signUpName);
      if (password.length < 10) throw invalid('password', copy.signUpPassword);
    }

    const status = inviteStatus(invite);
    if (status === 'accepted') throw conflict('invite_used', copy.inviteUsed);
    if (status === 'expired') throw conflict('invite_expired', copy.inviteExpired);

    let userId: string;
    if (account) {
      userId = account.id;
      name = account.name;
    } else {
      const made = await createUser(name, invite.email, password, true);
      userId = made.id;
    }
    const version = await latestVersion(pattern.id);
    await query(
      `update testers set status = 'accepted', user_id = $2, accepted_at = now(), version = $3, row = 1
       where id = $1`,
      [invite.id, userId, version],
    );
    await counterSet(pattern.id, userId, 1);
    await createSession(userId, ctx.res);
    await publishTesters(pattern);
    return { patternId: pattern.id };
  });

  router.get('/api/patterns/:id/follow', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, tester } = await testerPattern(user, ctx.params.id);
    const version = tester.version ?? (await latestVersion(pattern.id));
    const loaded = await loadVersionChart(pattern, version);
    if (!loaded) throw notFound();
    const analysis = analyse(loaded.chart);
    const notes = await query<{ row: number; count: string }>(
      `select row, count(*)::text as count from notes
       where pattern_id = $1 and user_id = $2 and version = $3 group by row`,
      [pattern.id, user.id, version],
    );
    const counts = new Map(notes.map((note) => [note.row, Number(note.count)]));
    return {
      id: pattern.id,
      name: pattern.name,
      craft: pattern.craft,
      mode: pattern.mode,
      terms: pattern.terms,
      castOn: loaded.chart.castOn,
      width: loaded.chart.width,
      height: loaded.chart.height,
      colours: loaded.chart.colours,
      repeats: loaded.chart.repeats,
      cells: cellsPayload(loaded.chart),
      rows: rowsPayload(analysis, counts),
      version,
      latestVersion: await latestVersion(pattern.id),
      row: tester.row,
    };
  });

  router.post('/api/patterns/:id/follow', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, tester } = await testerPattern(user, ctx.params.id);
    const version = Number(ctx.body.version);
    const latest = await latestVersion(pattern.id);
    if (!Number.isInteger(version) || version !== latest) {
      throw invalid('version', copy.followLatest);
    }
    const height = await versionHeight(pattern, version);
    const kept = Math.min(tester.row, height);
    const movedFrom = kept === tester.row ? null : tester.row;
    await query('update testers set version = $2, row = $3 where id = $1', [tester.id, version, kept]);
    await counterSet(pattern.id, user.id, kept);
    await publish(pattern.id, {
      kind: 'counter',
      userId: user.id,
      name: user.name,
      row: kept,
      version,
      movedFrom,
    });
    await publishTesters(pattern);
    return { version, row: kept, movedFrom };
  });

  router.get('/api/patterns/:id/counter', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, tester } = await testerPattern(user, ctx.params.id);
    const version = tester.version ?? (await latestVersion(pattern.id));
    return { row: tester.row, version, total: await versionHeight(pattern, version) };
  });

  router.post('/api/patterns/:id/counter', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, tester } = await testerPattern(user, ctx.params.id);
    const stepId = typeof ctx.body.stepId === 'string' ? ctx.body.stepId : '';
    if (stepId !== '') {
      const earlier = await one<{ row: number }>(
        'select row from counter_steps where pattern_id = $1 and user_id = $2 and step_id = $3',
        [pattern.id, user.id, stepId],
      );
      if (earlier) {
        const current = await one<{ row: number }>('select row from testers where id = $1', [tester.id]);
        return { row: current?.row ?? earlier.row };
      }
    }
    const from = Number(ctx.body.from);
    if (!Number.isInteger(from) || from < 1) throw invalid('from', 'Send the row you are stepping from.');
    const step = Number(ctx.body.step);
    if (step !== 1 && step !== -1) throw invalid('step', 'A step is 1 or -1.');
    if (stepId === '') throw invalid('stepId', 'Send a stepId for each step.');

    const version = tester.version ?? (await latestVersion(pattern.id));
    const total = await versionHeight(pattern, version);
    const loadRow = async (): Promise<number> => {
      const row = await one<{ row: number }>('select row from testers where id = $1', [tester.id]);
      return row?.row ?? 1;
    };

    let row = await counterStep(pattern.id, user.id, from, step, total, loadRow);
    if (row === null) {
      const moved = await one<{ row: number }>(
        `update testers set row = row + $2 where id = $1 and row = $3
         and row + $2 between 1 and $4 returning row`,
        [tester.id, step, from, total],
      );
      row = moved ? moved.row : await loadRow();
    } else {
      await query('update testers set row = $2 where id = $1', [tester.id, row]);
    }
    await query(
      `insert into counter_steps (pattern_id, user_id, step_id, row) values ($1, $2, $3, $4)
       on conflict do nothing`,
      [pattern.id, user.id, stepId, row],
    );
    await publish(pattern.id, {
      kind: 'counter',
      userId: user.id,
      name: user.name,
      row,
      version,
      movedFrom: null,
    });
    return { row };
  });

  router.post('/api/patterns/:id/notes', async (ctx) => {
    const user = await requireUser(ctx);
    const { pattern, tester } = await testerPattern(user, ctx.params.id);
    const version = tester.version ?? (await latestVersion(pattern.id));
    const total = await versionHeight(pattern, version);
    const row = Number(ctx.body.row);
    if (!Number.isInteger(row) || row < 1 || row > total) {
      throw invalid('row', 'That row is not in this version.');
    }
    const text = typeof ctx.body.text === 'string' ? ctx.body.text.trim() : '';
    if (text === '') throw invalid('text', copy.noteEmpty);
    if (text.length > limits.noteMaxChars) throw invalid('text', copy.noteLong);

    const id = randomUUID();
    await query(
      'insert into notes (id, pattern_id, user_id, row, text, version) values ($1, $2, $3, $4, $5, $6)',
      [id, pattern.id, user.id, row, text, version],
    );
    await publish(pattern.id, {
      kind: 'note',
      id,
      userId: user.id,
      tester: user.name,
      row,
      text,
      version,
    });
    await publishTesters(pattern);
    const owner = await one<{ email: string }>(
      'select u.email from patterns p join users u on u.id = p.owner_id where p.id = $1',
      [pattern.id],
    );
    if (owner) {
      const mail = noteMail(pattern.name, row, text);
      try {
        await sendMail(owner.email, mail.subject, mail.body);
      } catch {
        // The note stands even when its notice cannot be sent.
      }
    }
    ctx.res.statusCode = 201;
    return { id, row, text, version };
  });

  router.get('/api/patterns/:id/notes', async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) throw new ApiError(401, { error: 'unauthenticated' });
    const pattern = await getPattern(ctx.params.id);
    if (!pattern) throw notFound();
    const role = await roleOf(user, pattern);
    if (!role) throw notFound();
    const rows =
      role === 'tester'
        ? await query<{ row: number; text: string; tester: string; version: number }>(
            `select n.row, n.text, u.name as tester, n.version from notes n
             join users u on u.id = n.user_id
             where n.pattern_id = $1 and n.user_id = $2 order by n.row, n.created_at`,
            [pattern.id, user.id],
          )
        : await query<{ row: number; text: string; tester: string; version: number }>(
            `select n.row, n.text, u.name as tester, n.version from notes n
             join users u on u.id = n.user_id
             where n.pattern_id = $1 order by n.row, n.created_at`,
            [pattern.id],
          );
    return { notes: rows };
  });
}
