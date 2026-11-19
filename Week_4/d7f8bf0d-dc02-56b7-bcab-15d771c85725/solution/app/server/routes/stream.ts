import type { Ctx, Reply } from '../http/pipeline'

// Server-sent events: replay what the browser missed from the Valkey Stream, then carry on live.
export async function serveEvents(c: Ctx, stream: string, committedSeq: number): Promise<Reply> {
  const header = c.req.headers['last-event-id']
  const raw = typeof header === 'string' ? header : c.query.get('last_event_id')
  const lastEventId = raw === null || raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw)
  c.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  })
  c.res.write(': connected\n\n')
  await c.services.hub.subscribe(stream, c.res, lastEventId, committedSeq)
  return { streamed: true }
}
