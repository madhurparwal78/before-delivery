import crypto from 'node:crypto';
import type { IssueRow, Point, Trace } from '../shared/api';
import { copy } from '../shared/copy';
import type { Units } from '../shared/format';
import { argsOf, readBoolean, readHandles, readPoint, readPositive, readText } from './args';
import { one, query, queryOn, transaction } from './db';
import { fail, invalid } from './errors';
import { DEFAULT_TEXT_HEIGHT, serializeObject, type ObjectGeometry, type StoredObject } from './model';
import type { ObjectType } from '../shared/api';

export interface TraceRecord {
  id: string;
  drawing_id: string;
  name: string;
  state: 'open' | 'submitted' | 'closed';
  author: string;
  author_key: string;
  notice: 'sent' | 'not_sent' | null;
  created_at: Date;
}

export const TRACE_COMMANDS = ['LINE', 'PLINE', 'CIRCLE', 'REVCLOUD', 'MTEXT', 'ERASE'] as const;
export type TraceCommand = (typeof TRACE_COMMANDS)[number];

export function isTraceCommand(value: unknown): value is TraceCommand {
  return typeof value === 'string' && (TRACE_COMMANDS as readonly string[]).includes(value);
}

export async function findTrace(id: string): Promise<TraceRecord | null> {
  return await one<TraceRecord>('select * from traces where id = $1', [id]);
}

export async function loadTraceObjects(traceId: string): Promise<StoredObject[]> {
  return await query<StoredObject>(
    `select handle, type, layer, color, linetype, linetype_scale, lineweight, dimension_style,
       text_style, multileader_style, data, ord from trace_objects where trace_id = $1 order by ord`,
    [traceId],
  );
}

export async function serializeTrace(trace: TraceRecord, units: Units): Promise<Trace> {
  const objects = await loadTraceObjects(trace.id);
  const all = new Map(objects.map((object) => [object.handle, object]));
  return {
    id: trace.id,
    name: trace.name,
    state: trace.state,
    author: trace.author,
    notice: trace.notice,
    objects: objects.map((object) => serializeObject(object, all, units)),
  };
}

export async function createTrace(options: {
  drawingId: string;
  name: string;
  author: string;
  authorKey: string;
  now: Date;
}): Promise<TraceRecord> {
  const trimmed = options.name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) invalid('name', copy.traces.nameError);
  const rows = await query<TraceRecord>(
    `insert into traces (id, drawing_id, name, state, author, author_key, notice, created_at)
     values ($1,$2,$3,'open',$4,$5,null,$6) returning *`,
    [crypto.randomUUID(), options.drawingId, trimmed, options.author, options.authorKey, options.now],
  );
  return rows[0]!;
}

export function assertTraceOpen(trace: TraceRecord): void {
  if (trace.state !== 'open') fail('trace_not_open');
}

export function assertTraceSubmitted(trace: TraceRecord): void {
  if (trace.state !== 'submitted') fail('trace_not_submitted');
}

export function assertTraceAuthor(trace: TraceRecord, actorKey: string): void {
  if (trace.author_key !== actorKey) fail('forbidden');
}

/** Trace object handles are `T` followed by a per-drawing counter, starting at `T1`. */
async function nextTraceHandle(drawingId: string): Promise<string> {
  const rows = await query<{ trace_counter: number }>(
    'update drawings set trace_counter = trace_counter + 1 where id = $1 returning trace_counter',
    [drawingId],
  );
  return `T${rows[0]!.trace_counter.toString(16).toUpperCase()}`;
}

async function insertTraceObject(
  traceId: string,
  handle: string,
  type: ObjectType,
  data: ObjectGeometry,
  ord: number,
): Promise<void> {
  await query(
    `insert into trace_objects (trace_id, handle, type, layer, color, linetype, linetype_scale, lineweight,
       dimension_style, text_style, multileader_style, data, ord)
     values ($1,$2,$3,'0','ByLayer','ByLayer',1,'ByLayer','Standard','Standard','Standard',$4,$5)`,
    [traceId, handle, type, JSON.stringify(data), ord],
  );
}

function readPoints(args: Record<string, unknown>, field: string, minimum: number): Point[] {
  const value = args[field];
  if (!Array.isArray(value) || value.length < minimum) invalid('args', copy.history.invalidPoint);
  return (value as unknown[]).map((entry, index) => readPoint({ [index]: entry }, String(index)));
}

/** Trace edits never touch base geometry or the drawing version. */
export async function runTraceCommand(
  trace: TraceRecord,
  command: TraceCommand,
  rawArgs: unknown,
): Promise<void> {
  const args = argsOf(rawArgs);
  const existing = await loadTraceObjects(trace.id);
  let ord = existing.length;

  const create = async (type: ObjectType, data: ObjectGeometry): Promise<void> => {
    ord += 1;
    await insertTraceObject(trace.id, await nextTraceHandle(trace.drawing_id), type, data, ord);
  };

  switch (command) {
    case 'LINE': {
      const points = readPoints(args, 'points', 2);
      for (let i = 0; i < points.length - 1; i += 1) {
        await create('line', { start: points[i]!, end: points[i + 1]! });
      }
      if (readBoolean(args, 'close') && points.length > 2) {
        await create('line', { start: points.at(-1)!, end: points[0]! });
      }
      return;
    }
    case 'PLINE': {
      await create('polyline', { vertices: readPoints(args, 'points', 2), closed: readBoolean(args, 'closed') });
      return;
    }
    case 'CIRCLE': {
      await create('circle', { center: readPoint(args, 'center'), radius: readPositive(args, 'radius') });
      return;
    }
    case 'REVCLOUD': {
      await create('revcloud', { first: readPoint(args, 'first'), opposite: readPoint(args, 'opposite') });
      return;
    }
    case 'MTEXT': {
      await create('mtext', {
        position: readPoint(args, 'position'),
        width: args.width === undefined ? 2000 : readPositive(args, 'width'),
        height: args.height === undefined ? DEFAULT_TEXT_HEIGHT : readPositive(args, 'height'),
        contents: readText(args, 'contents', 4000),
      });
      return;
    }
    case 'ERASE': {
      const handles = readHandles(args, 'handles');
      const own = new Set(existing.map((object) => object.handle));
      if (handles.some((handle) => !own.has(handle))) fail('forbidden');
      for (const handle of handles) {
        await query('delete from trace_objects where trace_id = $1 and handle = $2', [trace.id, handle]);
      }
      return;
    }
  }
}

export async function listIssues(drawingId: string): Promise<IssueRow[]> {
  const rows = await query<{ number: number; trace_id: string; text: string; status: 'open' | 'resolved' }>(
    'select number, trace_id, text, status from issues where drawing_id = $1 order by number',
    [drawingId],
  );
  return rows.map((row) => ({ ...row }));
}

/** Submitting turns every MTEXT comment in the trace into a numbered issue. */
export async function submitTrace(trace: TraceRecord, now: Date): Promise<number> {
  return await transaction(async (client) => {
    await client.query("update traces set state = 'submitted' where id = $1", [trace.id]);
    const comments = await queryOn<{ data: { contents: string } }>(client, 
      "select data from trace_objects where trace_id = $1 and type = 'mtext' order by ord",
      [trace.id],
    );
    let created = 0;
    for (const comment of comments) {
      const next = await queryOn<{ issue_counter: number }>(client, 
        'update drawings set issue_counter = issue_counter + 1 where id = $1 returning issue_counter',
        [trace.drawing_id],
      );
      await client.query(
        `insert into issues (drawing_id, number, trace_id, text, status, created_at)
         values ($1,$2,$3,$4,'open',$5)`,
        [trace.drawing_id, next[0]!.issue_counter, trace.id, comment.data.contents, now],
      );
      created += 1;
    }
    return created;
  });
}

export async function setTraceNotice(traceId: string, notice: 'sent' | 'not_sent'): Promise<void> {
  await query('update traces set notice = $2 where id = $1', [traceId, notice]);
}

export async function closeTrace(traceId: string): Promise<void> {
  await query("update traces set state = 'closed' where id = $1", [traceId]);
}

export async function resolveIssue(drawingId: string, number: number): Promise<IssueRow> {
  const existing = await one<{ status: string }>(
    'select status from issues where drawing_id = $1 and number = $2',
    [drawingId, number],
  );
  if (existing === null) fail('not_found');
  if (existing.status === 'resolved') fail('issue_resolved');
  const rows = await query<{ number: number; trace_id: string; text: string; status: 'open' | 'resolved' }>(
    `update issues set status = 'resolved' where drawing_id = $1 and number = $2
     returning number, trace_id, text, status`,
    [drawingId, number],
  );
  return rows[0]!;
}
