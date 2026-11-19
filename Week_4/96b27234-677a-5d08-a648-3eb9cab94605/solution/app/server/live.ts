import { EARSHOT_REACH, SOMEONE, type ChatMessage, type MeFrame, type PersonEvent, type SessionFrame } from "../shared/protocol.js";
import { query } from "./db.js";
import type { Note } from "./notify.js";
import { namesFor } from "./blocks.js";
import { projectInside } from "./projection.js";
import { enqueue, meConns, send, sessionConns, type Conn } from "./registry.js";
import { loadSession, type SessionRow } from "./sessiondata.js";
import { onPersonEvent, onSessionEvent, type SessionEvent } from "./valkey.js";
import { votesOf } from "./votes.js";

type StateFrame = Extract<SessionFrame, { type: "state" }>;

/** The whole room as one viewer sees it: the frame pushed on the room socket and the inside part of the session detail. */
export async function roomState(session: SessionRow, viewerId: string): Promise<StateFrame | null> {
  const view = await projectInside(session, viewerId);
  if (!view) return null;
  const votes = await votesOf(session.id);
  const [voted, eligible, blocked, muted, names] = await Promise.all([
    query<{ vote_id: string }>("SELECT b.vote_id FROM ballots b JOIN votes v ON v.id = b.vote_id WHERE v.session_id = $1 AND b.person_id = $2", [session.id, viewerId]),
    query<{ vote_id: string }>("SELECT e.vote_id FROM vote_eligible e JOIN votes v ON v.id = e.vote_id WHERE v.session_id = $1 AND e.person_id = $2", [session.id, viewerId]),
    query<{ id: string }>("SELECT to_id AS id FROM blocks WHERE from_id = $1", [viewerId]),
    query<{ id: string }>("SELECT to_id AS id FROM mutes WHERE from_id = $1", [viewerId]),
    namesFor(viewerId, [...new Set(votes.map((vote) => vote.targetId))]),
  ]);
  return {
    type: "state",
    roomVersion: view.roomVersion,
    hostId: session.hostId,
    count: session.count,
    layout: view.layout,
    features: view.features,
    people: view.people,
    nearby: view.nearby,
    nearest: view.nearest,
    votes: votes.map((vote) => ({
      ...vote,
      canVote: vote.status === "open" && eligible.some((row) => row.vote_id === vote.id) && !voted.some((row) => row.vote_id === vote.id),
    })),
    voteTargetNames: Object.fromEntries(names),
    relations: { blocked: blocked.map((row) => row.id), muted: muted.map((row) => row.id) },
    reach: EARSHOT_REACH,
  };
}

async function stateFor(conn: Conn): Promise<StateFrame | null> {
  const session = await loadSession(conn.sessionId ?? "", conn.worldId);
  return session ? roomState(session, conn.personId) : null;
}

export const sendState = async (conn: Conn): Promise<void> => {
  const frame = await stateFor(conn);
  if (frame) send(conn, frame);
  else conn.ws.close(4004, "gone");
};

function noteText(note: Note, viewerId: string, names: Map<string, string>): string | null {
  const name = (id: string): string => names.get(id) ?? SOMEONE;
  switch (note.t) {
    case "arrived":
      return note.p === viewerId ? null : `${name(note.p)} arrived.`;
    case "left":
      return note.p === viewerId ? null : `${name(note.p)} left.`;
    case "nearby":
      return note.viewer === viewerId ? `${name(note.p)} is nearby.` : null;
    case "host":
      return `${name(note.p)} is now the host.`;
    case "removed-vote":
      return note.p === viewerId ? null : `${name(note.p)} was removed by a vote.`;
    case "vote-failed":
      return "The vote did not pass.";
  }
}

async function deliverState(conn: Conn, notes: Note[]): Promise<void> {
  const frame = await stateFor(conn);
  if (!frame) return;
  send(conn, frame);
  const mentioned = notes.flatMap((note) => ("p" in note ? [note.p] : []));
  const names = await namesFor(conn.personId, mentioned);
  for (const note of notes) {
    const text = noteText(note, conn.personId, names);
    if (text) send(conn, { type: "announce", text } satisfies SessionFrame);
  }
}

async function handleSession(sessionId: string, event: SessionEvent): Promise<void> {
  const conns = [...(sessionConns.get(sessionId) ?? [])];
  if (event.kind === "state") {
    for (const conn of conns) enqueue(conn, () => deliverState(conn, (event.notes as Note[]) ?? []));
  } else if (event.kind === "chat") {
    const message = event.message as Omit<ChatMessage, "fromName">;
    const recipients = event.recipients as string[];
    for (const conn of conns) {
      if (conn.personId !== message.fromId && !recipients.includes(conn.personId)) continue;
      enqueue(conn, async () => {
        const names = await namesFor(conn.personId, [message.fromId]);
        send(conn, { type: "chat", message: { ...message, fromName: names.get(message.fromId) ?? SOMEONE } } satisfies SessionFrame);
      });
    }
  } else if (event.kind === "kick") {
    for (const conn of conns) {
      if (conn.personId !== event.personId) continue;
      enqueue(conn, async () => {
        if (event.forced) send(conn, { type: "removed" } satisfies SessionFrame);
        conn.ws.close(event.forced ? 4001 : 4000, "left");
      });
    }
  }
}

/** Warnings are shown once: whoever claims an undelivered warning sends it. */
export async function deliverWarnings(conn: Conn): Promise<void> {
  const claimed = await query<{ id: number }>(
    "UPDATE warnings SET delivered = true WHERE person_id = $1 AND NOT delivered RETURNING id",
    [conn.personId],
  );
  for (let index = 0; index < claimed.length; index += 1) send(conn, { type: "notice", text: "A moderator has warned you." } satisfies MeFrame);
}

async function handlePerson(personId: string, frame: unknown): Promise<void> {
  const conns = [...(meConns.get(personId) ?? [])];
  if (conns.length === 0) return;
  const typed = frame as PersonEvent;
  for (const conn of conns) {
    enqueue(conn, async () => {
      if (typed.type === "warning") await deliverWarnings(conn);
      else send(conn, typed);
    });
  }
}

export function startLive(): void {
  onSessionEvent((sessionId, event) => void handleSession(sessionId, event));
  onPersonEvent((personId, frame) => void handlePerson(personId, frame));
}
