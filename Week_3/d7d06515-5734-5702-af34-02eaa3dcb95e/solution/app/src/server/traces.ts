// Traces and issues: a reviewer's overlay on a drawing. Nothing here ever touches the drawing version, base objects or activity.
import { randomUUID } from 'node:crypto';
import { COPY } from '../shared/copy.ts';
import { presentObject } from '../shared/geometry.ts';
import type { IssueView, StoredObject, TraceState, TraceSummary, TraceView, Units } from '../shared/types.ts';
import { assertMay, authorizeDrawing, requireCaller, type DrawingAccess } from './access.ts';
import { config } from './config.ts';
import { isUuid, pool, query, transaction, type Queryable } from './db.ts';
import { createTraceObjects } from './engine/index.ts';
import { lockDrawingRow } from './drawing-store.ts';
import { publishDrawing } from './events.ts';
import { HttpError, registerRoute, validation, type Context, type Reply } from './http.ts';
import { sendMail } from './smtp.ts';

interface TraceRow { id: string; drawing_id: string; name: string; author_key: string; author_name: string; state: TraceState; notice: 'sent' | 'not_sent' | null }

/** The trace state machine: the only place that says which moves exist and what refuses the others. */
const MOVES = {
  edit: { from: 'open', to: 'open', refusal: 'trace_not_open' },
  submit: { from: 'open', to: 'submitted', refusal: 'trace_not_open' },
  close: { from: 'submitted', to: 'closed', refusal: 'trace_not_submitted' },
} as const;
type Move = keyof typeof MOVES;

const TRACE_COMMANDS = ['LINE', 'PLINE', 'CIRCLE', 'REVCLOUD', 'MTEXT', 'ERASE'];
const TRACE_COLUMNS = 'id, drawing_id, name, author_key, author_name, state, notice';

const summaryOf = (row: TraceRow): TraceSummary => ({ id: row.id, name: row.name, state: row.state, author: row.author_name, notice: row.notice });

async function loadTrace(client: Queryable, id: string, lock: boolean): Promise<TraceRow> {
  const found = isUuid(id)
    ? await client.query<TraceRow>(`SELECT ${TRACE_COLUMNS} FROM traces WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])
    : null;
  const row = found?.rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  return row;
}

/** Locks the trace and refuses the move unless the trace is in the state that move starts from. */
async function lockForMove(client: Queryable, id: string, move: Move): Promise<TraceRow> {
  const row = await loadTrace(client, id, true);
  if (row.state !== MOVES[move].from) throw new HttpError(409, { error: MOVES[move].refusal });
  return row;
}

async function traceView(client: Queryable, row: TraceRow): Promise<TraceView> {
  const drawing = await client.query<{ units: Units }>('SELECT units FROM drawings WHERE id = $1', [row.drawing_id]);
  const units = drawing.rows[0]?.units ?? 'mm';
  const { rows } = await client.query<{ data: StoredObject }>('SELECT data FROM trace_objects WHERE trace_id = $1 ORDER BY seq', [row.id]);
  return { ...summaryOf(row), objects: rows.map((r) => presentObject(r.data, units)) };
}

async function issuesOf(client: Queryable, drawingId: string): Promise<IssueView[]> {
  const { rows } = await client.query<IssueView>('SELECT number, trace_id, text, status FROM issues WHERE drawing_id = $1 ORDER BY number', [drawingId]);
  return rows;
}

/** A trace and the caller's access to its drawing: 401, 404 and 410 come before anything about the trace itself. */
async function openTrace(ctx: Context): Promise<{ trace: TraceRow; access: DrawingAccess }> {
  requireCaller(ctx);
  const trace = await loadTrace(pool, ctx.params.id ?? '', false);
  return { trace, access: await authorizeDrawing(ctx, trace.drawing_id) };
}

/** Only a trace's author changes it: everyone else is refused by their access first, and the owner and edit holders as `forbidden`. */
function assertAuthor(access: DrawingAccess, trace: TraceRow): void {
  assertMay(access.access, 'trace-own', access);
  if (trace.author_key === access.actor.key) return;
  assertMay(access.access, 'owner', access);
  throw new HttpError(403, { error: 'forbidden' });
}

async function createTrace(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'trace', access);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 80) throw validation({ name: COPY.traceNameInvalid });
  const rows = await query<TraceRow>(
    `INSERT INTO traces (id, drawing_id, name, author_key, author_name, state, created_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6) RETURNING ${TRACE_COLUMNS}`,
    [randomUUID(), access.drawing.id, name, access.actor.key, access.actor.name, access.now]);
  const trace = rows[0];
  if (!trace) throw new HttpError(404, { error: 'not_found' });
  await publishDrawing(trace.drawing_id, { type: 'trace', trace: summaryOf(trace) });
  return { status: 201, body: { trace: { ...summaryOf(trace), objects: [] } } };
}

async function readTrace(ctx: Context): Promise<Reply> {
  const { trace } = await openTrace(ctx);
  return { status: 200, body: { trace: await traceView(pool, trace) } };
}

async function eraseInTrace(client: Queryable, traceId: string, args: unknown): Promise<void> {
  const raw = typeof args === 'object' && args !== null ? (args as Record<string, unknown>).handles : undefined;
  const handles = Array.isArray(raw) ? raw.filter((h): h is string => typeof h === 'string') : [];
  if (handles.length === 0) throw validation({ handles: COPY.noObjectFound });
  const found = await client.query<{ handle: string }>('SELECT handle FROM trace_objects WHERE trace_id = $1 AND handle = ANY($2::text[])', [traceId, handles]);
  const own = new Set(found.rows.map((r) => r.handle));
  const foreign = handles.find((h) => !own.has(h));
  if (foreign !== undefined) throw validation({ handles: foreign.startsWith('T') ? COPY.noObjectFound : COPY.baseObjectInTrace });
  await client.query('DELETE FROM trace_objects WHERE trace_id = $1 AND handle = ANY($2::text[])', [traceId, handles]);
}

async function addToTrace(client: Queryable, trace: TraceRow, command: string, args: unknown): Promise<void> {
  const drawing = await client.query<{ next_trace_handle: number; layer: string }>(
    `SELECT next_trace_handle, (SELECT name FROM layers WHERE drawing_id = d.id AND current) AS layer FROM drawings d WHERE d.id = $1`, [trace.drawing_id]);
  const head = drawing.rows[0];
  if (!head) throw new HttpError(404, { error: 'not_found' });
  const created = createTraceObjects(command, args, head.next_trace_handle, head.layer);
  if (!created.ok) throw validation(created.errors);
  const top = await client.query<{ top: number }>('SELECT COALESCE(MAX(seq), 0) AS top FROM trace_objects WHERE trace_id = $1', [trace.id]);
  const first = (top.rows[0]?.top ?? 0) + 1;
  const rows = created.objects.map((o, i) => ({ handle: o.handle, seq: first + i, data: o }));
  await client.query(
    `INSERT INTO trace_objects (trace_id, handle, seq, data)
     SELECT $1, r.handle, r.seq, r.data FROM jsonb_to_recordset($2::jsonb) AS r(handle text, seq bigint, data jsonb)`,
    [trace.id, JSON.stringify(rows)]);
  await client.query('UPDATE drawings SET next_trace_handle = $2 WHERE id = $1', [trace.drawing_id, created.next_trace_handle]);
}

async function traceCommand(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const { trace, access } = await openTrace(ctx);
  assertAuthor(access, trace);
  const view = await transaction(async (client) => {
    // The drawing row serialises the handle counter across every trace of the drawing.
    await lockDrawingRow(client, trace.drawing_id);
    const open = await lockForMove(client, trace.id, 'edit');
    const command = typeof body.command === 'string' ? body.command : '';
    if (!TRACE_COMMANDS.includes(command)) throw validation({ command: `Unknown command "${command}". Press F1 for the command reference.` });
    if (command === 'ERASE') await eraseInTrace(client, open.id, body.args);
    else await addToTrace(client, open, command, body.args);
    return traceView(client, open);
  });
  return { status: 200, body: { trace: view } };
}

/** Moves a locked trace to the state its move leads to. */
async function applyMove(client: Queryable, trace: TraceRow, move: Move): Promise<TraceRow> {
  await client.query('UPDATE traces SET state = $2 WHERE id = $1', [trace.id, MOVES[move].to]);
  return { ...trace, state: MOVES[move].to };
}

async function submitTrace(ctx: Context): Promise<Reply> {
  const { trace, access } = await openTrace(ctx);
  assertAuthor(access, trace);
  const { submitted, issueCount } = await transaction(async (client) => {
    await lockDrawingRow(client, trace.drawing_id);
    const open = await lockForMove(client, trace.id, 'submit');
    const notes = await client.query<{ contents: string }>(
      `SELECT data->>'contents' AS contents FROM trace_objects WHERE trace_id = $1 AND data->>'type' = 'mtext' ORDER BY seq`, [open.id]);
    const last = await client.query<{ last: number }>('SELECT COALESCE(MAX(number), 0) AS last FROM issues WHERE drawing_id = $1', [open.drawing_id]);
    const first = (last.rows[0]?.last ?? 0) + 1;
    const issues = notes.rows.map((n, i) => ({ number: first + i, text: n.contents }));
    await client.query(
      `INSERT INTO issues (drawing_id, number, trace_id, text)
       SELECT $1, r.number, $2, r.text FROM jsonb_to_recordset($3::jsonb) AS r(number integer, text text)`,
      [open.drawing_id, open.id, JSON.stringify(issues)]);
    return { submitted: await applyMove(client, open, 'submit'), issueCount: issues.length };
  });
  const owner = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [access.ownerUserId]);
  const accepted = await sendMail({
    to: owner[0]?.email ?? '',
    subject: `Trace "${submitted.name}" submitted on ${access.drawing.name}`,
    text: [
      `${submitted.author_name} submitted the trace "${submitted.name}" on ${access.drawing.name}.`,
      `Issues: ${issueCount}`,
      `${config.publicUrl}/d/${submitted.drawing_id}`,
    ].join('\n'),
  });
  const notice = accepted ? 'sent' : 'not_sent';
  await pool.query('UPDATE traces SET notice = $2 WHERE id = $1', [submitted.id, notice]);
  const summary = summaryOf({ ...submitted, notice });
  await publishDrawing(submitted.drawing_id, { type: 'trace', trace: summary });
  await publishDrawing(submitted.drawing_id, { type: 'issues', issues: await issuesOf(pool, submitted.drawing_id) });
  return { status: 200, body: { trace: summary } };
}

async function closeTrace(ctx: Context): Promise<Reply> {
  const { trace, access } = await openTrace(ctx);
  assertMay(access.access, 'owner', access);
  const closed = await transaction(async (client) => applyMove(client, await lockForMove(client, trace.id, 'close'), 'close'));
  const summary = summaryOf(closed);
  await publishDrawing(closed.drawing_id, { type: 'trace', trace: summary });
  return { status: 200, body: { trace: summary } };
}

async function listIssues(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  return { status: 200, body: { issues: await issuesOf(pool, access.drawing.id) } };
}

async function resolveIssue(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'owner', access);
  const number = Number(ctx.params.number);
  const issue = await transaction(async (client) => {
    const found = Number.isInteger(number)
      ? await client.query<IssueView>('SELECT number, trace_id, text, status FROM issues WHERE drawing_id = $1 AND number = $2 FOR UPDATE', [access.drawing.id, number])
      : null;
    const row = found?.rows[0];
    if (!row) throw new HttpError(404, { error: 'not_found' });
    if (row.status === 'resolved') throw new HttpError(409, { error: 'issue_resolved' });
    await client.query(`UPDATE issues SET status = 'resolved' WHERE drawing_id = $1 AND number = $2`, [access.drawing.id, number]);
    return { ...row, status: 'resolved' as const };
  });
  await publishDrawing(access.drawing.id, { type: 'issues', issues: await issuesOf(pool, access.drawing.id) });
  return { status: 200, body: { issue } };
}

export function registerTraceRoutes(): void {
  registerRoute('POST', '/api/drawings/:id/traces', createTrace);
  registerRoute('GET', '/api/traces/:id', readTrace);
  registerRoute('POST', '/api/traces/:id/commands', traceCommand);
  registerRoute('POST', '/api/traces/:id/submit', submitTrace);
  registerRoute('POST', '/api/traces/:id/close', closeTrace);
  registerRoute('GET', '/api/drawings/:id/issues', listIssues);
  registerRoute('POST', '/api/drawings/:id/issues/:number/resolve', resolveIssue);
}
