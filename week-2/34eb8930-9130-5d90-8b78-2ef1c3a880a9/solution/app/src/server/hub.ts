import type { WebSocket } from "ws";

/** One open page socket. */
export interface Client {
  ws: WebSocket;
  personId: string;
  documentId: string | null;
  lastFrameAt: number;
  ended: boolean;
}

const byPerson = new Map<string, Set<Client>>();

export function register(c: Client): void {
  const set = byPerson.get(c.personId) ?? new Set<Client>();
  set.add(c);
  byPerson.set(c.personId, set);
}

export function unregister(c: Client): void {
  const set = byPerson.get(c.personId);
  set?.delete(c);
  if (set && !set.size) byPerson.delete(c.personId);
}

export function send(c: Client, frame: object): void {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(frame));
}

/** Frames for every socket of a person, joined or not (`notice`, `lists_changed`). */
export function toPerson(personId: string, frame: object): void {
  for (const c of byPerson.get(personId) ?? []) send(c, frame);
}

export function listsChanged(personIds: Iterable<string>): void {
  for (const id of new Set(personIds)) toPerson(id, { type: "lists_changed" });
}

export function socketsOf(personId: string): Client[] {
  return [...(byPerson.get(personId) ?? [])];
}
