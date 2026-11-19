/** Live transaction delivery: connections held open for the caller's company, and the session registry. */
import type { ServerResponse } from "node:http";
import { Buffer } from "node:buffer";

export interface TransactionRow {
  id: string;
  account_id: string;
  direction: "credit" | "debit";
  amount_cents: number;
  method: string;
  counterparty: string;
  memo: string | null;
  status: "posted";
  transfer_id: string | null;
  created_at: string;
}

interface Subscriber {
  companyId: string;
  sessionId: string;
  res: ServerResponse;
  /** Events published while the resume replay runs are buffered and flushed after it. */
  buffered: TransactionRow[] | null;
  /** Ids already sent during resume, so replay and buffered events never repeat; dropped once live. */
  sentIds: Set<string> | null;
  beat: NodeJS.Timeout;
}

const subscribers = new Set<Subscriber>();
const HEARTBEAT_MS = 15_000;

function frame(row: TransactionRow): Buffer {
  return Buffer.from(`id: ${row.id}\nevent: transaction\ndata: ${JSON.stringify(row)}\n\n`);
}

function deliver(subscriber: Subscriber, row: TransactionRow): void {
  if (subscriber.sentIds) {
    if (subscriber.sentIds.has(row.id)) return;
    subscriber.sentIds.add(row.id);
  }
  subscriber.res.write(frame(row));
}

export function openStream(companyId: string, sessionId: string, res: ServerResponse): Subscriber {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const subscriber: Subscriber = {
    companyId,
    sessionId,
    res,
    buffered: [],
    sentIds: new Set(),
    beat: setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS),
  };
  subscribers.add(subscriber);
  res.on("close", () => closeSubscriber(subscriber));
  return subscriber;
}

/** Sends the replay oldest first, then whatever was published meanwhile, then goes live. */
export function startLive(subscriber: Subscriber, replay: TransactionRow[]): void {
  for (const row of replay) deliver(subscriber, row);
  for (const row of subscriber.buffered ?? []) deliver(subscriber, row);
  subscriber.buffered = null;
  subscriber.sentIds = null;
}

function closeSubscriber(subscriber: Subscriber): void {
  clearInterval(subscriber.beat);
  subscribers.delete(subscriber);
  if (!subscriber.res.writableEnded) subscriber.res.end();
}

/** Delivers committed transactions to every open stream of the company. */
export function publishTransactions(companyId: string, rows: TransactionRow[]): void {
  for (const subscriber of subscribers) {
    if (subscriber.companyId !== companyId) continue;
    for (const row of rows) {
      if (subscriber.buffered) subscriber.buffered.push(row);
      else deliver(subscriber, row);
    }
  }
}

/** Closes every stream a signed-out session holds. */
export function closeSessionStreams(sessionId: string): void {
  for (const subscriber of [...subscribers]) {
    if (subscriber.sessionId === sessionId) closeSubscriber(subscriber);
  }
}
