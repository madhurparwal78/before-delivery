import type { RequestCtx } from '../router.js';
import type { ApiDeps } from './api.js';
import type { RouteSpec } from './api.js';

interface StreamState {
  setId: string;
  lastSeq: number;
  write: (event: string, data: string, id?: string) => void;
  close: () => void;
}

const activeStreams = new Set<StreamState>();

export function makeEventStream (deps: ApiDeps, ctx: RequestCtx): void {
  const setId = ctx.params.setId;
  const afterParam = ctx.url.searchParams.get('after');
  const header = ctx.req.headers['last-event-id'];
  let lastSeq = 0;
  if (afterParam !== null) {
    lastSeq = Number(afterParam);
  } else if (typeof header === 'string' && header !== '') {
    lastSeq = Number(header);
  }
  if (!Number.isInteger(lastSeq) || lastSeq < 0) lastSeq = 0;

  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const write = (event: string, data: string, id?: string): void => {
    const parts = id !== undefined ? [`id: ${id}`] : [];
    parts.push(`event: ${event}`, `data: ${data}`, '');
    ctx.res.write(parts.join('\n') + '\n');
  };
  const state: StreamState = {
    setId,
    lastSeq,
    write,
    close: () => { activeStreams.delete(state); },
  };
  activeStreams.add(state);
  ctx.req.on('close', state.close);

  // First, replay every committed op after the requested sequence number.
  void (async () => {
    const result = await deps.pool.query(
      `SELECT o.seq, o.client_op_id, o.actor_id, o.target, o.type, o.payload, o.committed_at, u.display_name
         FROM ops o JOIN users u ON u.id = o.actor_id
        WHERE o.set_id = $1 AND o.seq > $2 ORDER BY o.seq`,
      [setId, lastSeq],
    );
    for (const row of result.rows as Array<{ seq: string; client_op_id: string; actor_id: string; target: string; type: string; payload: unknown; committed_at: Date; display_name: string }>) {
      state.lastSeq = Number(row.seq);
      write('op', JSON.stringify({
        seq: Number(row.seq),
        client_op_id: row.client_op_id,
        actor: { user_id: row.actor_id, display_name: row.display_name },
        target: row.target,
        type: row.type,
        payload: row.payload,
        committed_at: row.committed_at.toISOString(),
      }), row.seq);
    }
    void deps.collab.subscribe(`afterglass:set:${setId}`, (message) => {
      try {
        const parsed = JSON.parse(message) as { kind: string; body?: unknown; [key: string]: unknown };
        if (parsed.kind === 'op') {
          const body = parsed.body as Record<string, unknown>;
          state.lastSeq = Number(body.seq);
          write('op', JSON.stringify(body), String(body.seq));
        } else if (parsed.kind === 'lock') {
          write('lock', JSON.stringify(parsed.body));
        } else if (parsed.kind === 'presence') {
          const body = parsed.body as { members: unknown };
          write('presence', JSON.stringify(body));
        } else if (parsed.kind === 'show') {
          const body = parsed.body as { live_number: number };
          write('show', JSON.stringify(body));
        } else if (parsed.kind === 'status') {
          write('status', JSON.stringify(parsed.body));
        }
      } catch {
        // A malformed relay message is dropped; the stream stays open.
      }
    }).catch(() => {
      // When Valkey is down the stream still serves the initial replay.
    });
  })();
}

// The op commit path calls this after committing so live streams get the op at once.
export async function publishCommittedOp (deps: ApiDeps, setId: string, body: Record<string, unknown>): Promise<void> {
  await deps.collab.publish(`afterglass:set:${setId}`, JSON.stringify({ kind: 'op', body })).catch(() => {});
}

export const eventRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/sets/:setId/events', handler: (ctx) => makeEventStream(deps, ctx) },
]);

