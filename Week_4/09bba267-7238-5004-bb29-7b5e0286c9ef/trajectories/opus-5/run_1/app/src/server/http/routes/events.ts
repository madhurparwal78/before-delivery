import { buyerTopic, offerTopic, OWNER_TOPIC, performanceTopic, subscribe } from '../../live';
import type { RequestContext } from '../context';

const HEARTBEAT_MS = 15_000;

/** Tells open pages that something they watch has changed; they then read the API again. */
export function streamEvents(context: RequestContext): void {
  const topics = new Set<string>([buyerTopic(context.buyerId)]);
  const performanceId = context.url.searchParams.get('performance');
  if (performanceId !== null) topics.add(performanceTopic(performanceId));
  const token = context.url.searchParams.get('offer');
  if (token !== null) topics.add(offerTopic(token));
  if (context.ownerSignedIn) topics.add(OWNER_TOPIC);

  const headers: Record<string, string | string[]> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
  if (context.cookies.length > 0) headers['set-cookie'] = [...context.cookies];
  context.res.writeHead(200, headers);
  context.res.write('event: ready\ndata: {}\n\n');

  const unsubscribe = subscribe({
    topics,
    notify: () => {
      context.res.write('event: changed\ndata: {}\n\n');
    },
  });
  const heartbeat = setInterval(() => {
    context.res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);
  context.req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    context.res.end();
  });
}
