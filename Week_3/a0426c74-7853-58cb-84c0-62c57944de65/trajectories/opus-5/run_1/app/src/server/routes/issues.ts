import { ApiError, MESSAGES } from '../../shared/errors.js';
import {
  type IssueState,
  type Role,
  type RfiState,
  ballInCourtRefusal,
  issueMoveAllowed,
  issueRefusal,
  rfiMoveAllowed,
  rfiRefusal,
  roleAtLeast,
} from '../../shared/transitions.js';
import { notFound, requireRole, requireSignedIn, roleForFolder } from '../access.js';
import { one, query } from '../db.js';
import { broadcast, loadDrawing } from '../drawings.js';
import { readJson, requireNumber, requireString, route, sendJson, stringField } from '../http.js';
import { newId } from '../ids.js';
import { sheetById, versionById } from '../publish.js';
import { drawingAccess } from './folders.js';

interface IssueRow {
  id: string;
  drawing_id: string;
  version_id: string;
  title: string;
  x: number;
  y: number;
  state: IssueState;
  creator: string;
}

interface RfiRow {
  id: string;
  issue_id: string;
  question: string;
  state: RfiState;
  asker: string;
  addressee: string;
  ball_in_court: string;
  answer: string | null;
}

async function rfisOfIssue(issueId: string): Promise<RfiRow[]> {
  return query<RfiRow>(
    'select id, issue_id, question, state, asker, addressee, ball_in_court, answer from rfis where issue_id = $1 order by created_at',
    [issueId],
  );
}

function rfiPayload(rfi: RfiRow): Record<string, unknown> {
  return {
    id: rfi.id,
    issue_id: rfi.issue_id,
    question: rfi.question,
    state: rfi.state,
    asker: rfi.asker,
    addressee: rfi.addressee,
    ball_in_court: rfi.ball_in_court,
    answer: rfi.answer,
  };
}

async function issuePayload(issue: IssueRow): Promise<Record<string, unknown>> {
  const rfis = await rfisOfIssue(issue.id);
  return {
    id: issue.id,
    drawing_id: issue.drawing_id,
    version_id: issue.version_id,
    title: issue.title,
    x: Number(issue.x),
    y: Number(issue.y),
    state: issue.state,
    creator: issue.creator,
    rfi_ids: rfis.map((rfi) => rfi.id),
    rfis: rfis.map(rfiPayload),
  };
}

async function issuesOfDrawing(drawingId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<IssueRow>(
    'select id, drawing_id, version_id, title, x, y, state, creator from issues where drawing_id = $1 order by created_at',
    [drawingId],
  );
  const out: Record<string, unknown>[] = [];
  for (const row of rows) out.push(await issuePayload(row));
  return out;
}

async function announceIssues(drawingId: string, type: 'issue' | 'rfi'): Promise<void> {
  const state = await loadDrawing(drawingId);
  if (!state) return;
  await broadcast(state, type, { issues: await issuesOfDrawing(drawingId) });
}

async function issueAccess(username: string, issueId: string): Promise<{ issue: IssueRow; role: Role }> {
  const issue = await one<IssueRow>(
    'select id, drawing_id, version_id, title, x, y, state, creator from issues where id = $1',
    [issueId],
  );
  if (!issue) throw notFound();
  const state = await loadDrawing(issue.drawing_id);
  if (!state) throw notFound();
  const role = await roleForFolder(username, state.folder_id);
  if (!role) throw notFound();
  return { issue, role };
}

export function registerIssueRoutes(): void {
  route('POST', '/api/versions/:id/issues', async (context) => {
    const username = requireSignedIn(context.username);
    const version = await versionById(context.params.id);
    if (!version) throw notFound();
    const sheet = await sheetById(version.sheet_id);
    if (!sheet) throw notFound();
    const state = await loadDrawing(sheet.drawing_id);
    if (!state) throw notFound();
    const role = await roleForFolder(username, state.folder_id);
    if (!role) throw notFound();
    requireRole(role, 'markup');
    const body = await readJson(context);
    const id = newId('iss');
    await query(
      'insert into issues (id, drawing_id, version_id, title, x, y, state, creator) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        sheet.drawing_id,
        version.id,
        requireString(body, 'title'),
        requireNumber(body, 'x'),
        requireNumber(body, 'y'),
        'open',
        username,
      ],
    );
    const issue = await one<IssueRow>(
      'select id, drawing_id, version_id, title, x, y, state, creator from issues where id = $1',
      [id],
    );
    await announceIssues(sheet.drawing_id, 'issue');
    sendJson(context.res, 201, await issuePayload(issue as IssueRow));
  });

  route('GET', '/api/drawings/:id/issues', async (context) => {
    const username = requireSignedIn(context.username);
    const { state } = await drawingAccess(username, context.params.id);
    sendJson(context.res, 200, { issues: await issuesOfDrawing(state.id) });
  });

  route('POST', '/api/issues/:id/transitions', async (context) => {
    const username = requireSignedIn(context.username);
    const { issue, role } = await issueAccess(username, context.params.id);
    requireRole(role, 'markup');
    const body = await readJson(context);
    const to = requireString(body, 'to');
    if (!['open', 'answered', 'closed'].includes(to)) throw new ApiError('invalid', MESSAGES.invalid);
    const wanted = to as IssueState;
    if (wanted === 'open' && issue.creator !== username && !roleAtLeast(role, 'manage')) {
      throw new ApiError('forbidden', MESSAGES.forbidden);
    }
    if (!issueMoveAllowed(issue.state, wanted)) {
      throw new ApiError('illegal_transition', issueRefusal(issue.state, wanted));
    }
    if (wanted === 'closed') {
      const rfis = await rfisOfIssue(issue.id);
      if (rfis.some((rfi) => rfi.state !== 'closed')) throw new ApiError('rfi_open', MESSAGES.closeRfiFirst);
    }
    await query('update issues set state = $2 where id = $1', [issue.id, wanted]);
    const updated = { ...issue, state: wanted };
    await announceIssues(issue.drawing_id, 'issue');
    sendJson(context.res, 200, await issuePayload(updated));
  });

  route('POST', '/api/issues/:id/rfis', async (context) => {
    const username = requireSignedIn(context.username);
    const { issue, role } = await issueAccess(username, context.params.id);
    requireRole(role, 'markup');
    const body = await readJson(context);
    const id = newId('rfi');
    const addressee = requireString(body, 'addressee');
    await query(
      'insert into rfis (id, issue_id, question, state, asker, addressee, ball_in_court) values ($1,$2,$3,$4,$5,$6,$7)',
      [id, issue.id, requireString(body, 'question'), 'draft', username, addressee, username],
    );
    const rfi = await one<RfiRow>(
      'select id, issue_id, question, state, asker, addressee, ball_in_court, answer from rfis where id = $1',
      [id],
    );
    await announceIssues(issue.drawing_id, 'rfi');
    sendJson(context.res, 201, rfiPayload(rfi as RfiRow));
  });

  route('POST', '/api/rfis/:id/transitions', async (context) => {
    const username = requireSignedIn(context.username);
    const rfi = await one<RfiRow>(
      'select id, issue_id, question, state, asker, addressee, ball_in_court, answer from rfis where id = $1',
      [context.params.id],
    );
    if (!rfi) throw notFound();
    const { issue, role } = await issueAccess(username, rfi.issue_id);
    requireRole(role, 'markup');
    const body = await readJson(context);
    const to = requireString(body, 'to');
    if (!['sent', 'answered', 'closed'].includes(to)) throw new ApiError('invalid', MESSAGES.invalid);
    const wanted = to as RfiState;
    if (rfi.ball_in_court !== username) {
      throw new ApiError('not_ball_in_court', ballInCourtRefusal(rfi.ball_in_court));
    }
    if (!rfiMoveAllowed(rfi.state, wanted)) {
      throw new ApiError('illegal_transition', rfiRefusal(rfi.state, wanted));
    }
    const answer = stringField(body, 'answer');
    if (wanted === 'answered' && (answer === null || answer.trim() === '')) {
      throw new ApiError('invalid', MESSAGES.invalid, { fields: { answer: 'Write an answer first.' } });
    }
    let ball = rfi.ball_in_court;
    if (wanted === 'sent') ball = rfi.addressee;
    if (wanted === 'answered') ball = rfi.asker;
    await query('update rfis set state = $2, ball_in_court = $3, answer = coalesce($4, answer) where id = $1', [
      rfi.id,
      wanted,
      ball,
      answer,
    ]);
    const updated = (await one<RfiRow>(
      'select id, issue_id, question, state, asker, addressee, ball_in_court, answer from rfis where id = $1',
      [rfi.id],
    )) as RfiRow;
    await announceIssues(issue.drawing_id, 'rfi');
    sendJson(context.res, 200, rfiPayload(updated));
  });
}
