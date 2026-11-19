/**
 * The one live channel. Clients subscribe to published topics; every committed
 * change reaches each subscribed open page within 2 seconds. List change notices
 * are batched for LIVE_SETTLE_MS before being sent.
 */

import type { WebSocket } from 'ws';

import { iso, now } from '../clock';
import { settings } from '../config';

export type Topic = string;

export interface LiveMessage {
  readonly topic: Topic;
  readonly event: string;
  readonly data: unknown;
}

interface Client {
  readonly socket: WebSocket;
  readonly username: string;
  readonly topics: Set<Topic>;
}

const clients = new Set<Client>();

export function addClient(socket: WebSocket, username: string): Client {
  const client: Client = { socket, username, topics: new Set() };
  clients.add(client);
  return client;
}

export function removeClient(client: Client): void {
  clients.delete(client);
}

export function subscribe(client: Client, topics: readonly Topic[]): void {
  for (const topic of topics) client.topics.add(topic);
}

export function unsubscribe(client: Client, topics: readonly Topic[]): void {
  for (const topic of topics) client.topics.delete(topic);
}

function sendTo(client: Client, message: LiveMessage): void {
  if (client.socket.readyState !== 1) return;
  client.socket.send(
    JSON.stringify({
      topic: message.topic,
      event: message.event,
      data: message.data,
      server_time: iso(now()),
    }),
  );
}

/** Sends one message to everyone subscribed to its topic. */
export function publish(message: LiveMessage): void {
  for (const client of clients) {
    if (client.topics.has(message.topic)) sendTo(client, message);
  }
}

/** Sends to one person's open pages, whatever they are subscribed to. */
export function publishToUser(username: string, message: LiveMessage): void {
  for (const client of clients) {
    if (client.username === username) sendTo(client, message);
  }
}

const pendingLists = new Map<string, { numbers: Set<string>; timer: NodeJS.Timeout }>();

/**
 * A record someone else creates is announced, not inserted, so list notices are
 * batched for the settle delay and then sent once.
 */
export function noticeListChange(table: string, number: string, event: 'created' | 'updated'): void {
  const key = `${table}:${event}`;
  const existing = pendingLists.get(key);
  if (existing) {
    existing.numbers.add(number);
    return;
  }
  const numbers = new Set([number]);
  const timer = setTimeout(() => {
    pendingLists.delete(key);
    publish({ topic: `list:${table}`, event, data: { numbers: [...numbers] } });
  }, settings().LIVE_SETTLE_MS);
  pendingLists.set(key, { numbers, timer });
}

export function topicsOf(username: string): Topic[] {
  const out: Topic[] = [];
  for (const client of clients) {
    if (client.username === username) out.push(...client.topics);
  }
  return out;
}

export function clientCount(): number {
  return clients.size;
}

export type { Client as LiveClient };
