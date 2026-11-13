import type { EventFrame } from '../events/outbox.js';
import { latestSequence } from '../events/outbox.js';
import type { RequestContext } from './server.js';

const POLL_MILLISECONDS = 250;
const COMMENT_MILLISECONDS = 15_000;
const BATCH = 200;

interface StreamSource {
  readonly read: (afterSequence: number) => Promise<EventFrame[]>;
  readonly stillOpen?: () => Promise<boolean>;
}

function readLastEventId(context: RequestContext): number | null {
  const header = context.headers['last-event-id'];
  const given = Array.isArray(header) ? header[0] : header;
  const candidate = given ?? context.search.get('lastEventId') ?? '';
  if (!/^[0-9]+$/.test(candidate)) return null;
  return Number(candidate);
}

/** A WHATWG server-sent event stream resuming from Last-Event-ID without gaps. */
export async function openStream(context: RequestContext, source: StreamSource): Promise<void> {
  const { response, request } = context;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let cursor = readLastEventId(context);
  if (cursor === null) {
    cursor = await latestSequence().catch(() => 0);
  }
  response.write(':\n\n');
  let open = true;
  request.on('close', () => {
    open = false;
  });
  let lastComment = Date.now();
  while (open && !response.writableEnded) {
    try {
      if (source.stillOpen !== undefined && !(await source.stillOpen())) break;
      const frames = await source.read(cursor);
      for (const frame of frames) {
        cursor = frame.sequence;
        response.write(
          `id: ${frame.sequence}\nevent: ${frame.type}\ndata: ${JSON.stringify({
            type: frame.type,
            aggregate: frame.aggregate,
            aggregateId: frame.aggregateId,
            sequence: frame.sequence,
            at: frame.at,
            data: frame.data,
          })}\n\n`,
        );
      }
      if (frames.length === BATCH) continue;
    } catch {
      // The records are out of reach; the stream waits and resumes where it left off.
    }
    if (Date.now() - lastComment >= COMMENT_MILLISECONDS) {
      response.write(':\n\n');
      lastComment = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MILLISECONDS));
  }
  response.end();
}
