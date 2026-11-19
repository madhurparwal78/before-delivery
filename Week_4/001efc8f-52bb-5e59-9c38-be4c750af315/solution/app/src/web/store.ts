import { useSyncExternalStore } from "react";
import type { Channel, Entry, Me, Message, Quote } from "./types";

// The shell's client state. Components read it through useStore(); every change replaces the
// top-level object so React sees it.

export type Outgoing = {
  clientMessageId: string;
  channelId: string;
  threadRootId: string | null;
  text: string;
  quote: { messageId: string; authorName: string; text: string } | null;
  files: File[];
  createdAt: number;
  state: "pending" | "failed";
  failure: string | null;
  attempt: number;
};

type HistoryView = {
  status: "loading" | "ready" | "not_found";
  ids: string[];
  nextCursor: string | null;
  older: "idle" | "loading" | "error";
};

type ThreadView = { status: "loading" | "ready" | "not_found"; ids: string[]; nextCursor: string | null };

type Announcement = { id: number; text: string };

type State = {
  phase: "booting" | "signedOut" | "ready";
  signInNote: string | null;
  me: Me | null;
  channels: Channel[];
  channelsLoaded: boolean;
  revoked: Record<string, string>;
  entries: Record<string, Entry>;
  histories: Record<string, HistoryView>;
  threads: Record<string, ThreadView>;
  outbox: Outgoing[];
  pendingPins: Record<string, true>;
  notice: Announcement | null;
  delivery: Announcement | null;
  upload: Announcement | null;
};

const initial: State = {
  phase: "booting",
  signInNote: null,
  me: null,
  channels: [],
  channelsLoaded: false,
  revoked: {},
  entries: {},
  histories: {},
  threads: {},
  outbox: [],
  pendingPins: {},
  notice: null,
  delivery: null,
  upload: null,
};

let state = initial;
const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState);
}

// The signed-in person; only screens shown after sign-in call it.
export function useMe(): Me {
  const { me } = useStore();
  if (!me) throw new Error("useMe outside a signed-in screen");
  return me;
}

export function resetSession(phase: State["phase"], signInNote: string | null = null): void {
  state = { ...initial, phase, signInNote, notice: state.notice };
  for (const listener of listeners) listener();
}

let counter = 0;
export function notify(text: string): void {
  setState({ notice: { id: ++counter, text } });
}
export function announceDelivery(text: string): void {
  setState({ delivery: { id: ++counter, text } });
}
// The first upload step shows at once; steps announced in the same task wait for a task each,
// so every step renders in the region one by one.
const uploadQueue: string[] = [];
let uploadBusy = false;
function showUpload(text: string): void {
  setState({ upload: { id: ++counter, text } });
  uploadBusy = true;
  setTimeout(() => {
    const next = uploadQueue.shift();
    if (next === undefined) uploadBusy = false;
    else showUpload(next);
  }, 0);
}
export function announceUpload(text: string): void {
  if (uploadBusy) uploadQueue.push(text);
  else showUpload(text);
}

// Own messages' last announced delivery step, so each step is announced once as it happens.
const announced = new Map<string, { delivered: boolean; read: number }>();

function announceSteps(previous: Message | undefined, message: Message): void {
  if (message.author.id !== state.me?.user.id) return;
  const seen = announced.get(message.id) ?? {
    delivered: (previous?.delivered_count ?? message.delivered_count) > 0,
    read: previous?.read_count ?? message.read_count,
  };
  if (!seen.delivered && message.delivered_count > 0 && message.read_count === 0) announceDelivery("Message delivered.");
  if (message.read_count > seen.read) announceDelivery(`Message read by ${message.read_count}.`);
  announced.set(message.id, { delivered: seen.delivered || message.delivered_count > 0, read: Math.max(seen.read, message.read_count) });
}

function refreshQuotes(entries: Record<string, Entry>, quoted: string, quote: Quote): Record<string, Entry> {
  let next = entries;
  for (const entry of Object.values(entries)) {
    if (!entry.deleted && entry.quote?.message_id === quoted) {
      if (next === entries) next = { ...entries };
      next[entry.id] = { ...entry, quote };
    }
  }
  return next;
}

// Stores messages from any source (history, threads, sends, events) under their ids. A stored
// own message resolves its pending send, whichever of the answer or the live event comes first.
export function putEntries(list: Entry[]): void {
  setState((current) => {
    const me = current.me?.user.id;
    const pending = new Set(current.outbox.map((o) => o.clientMessageId));
    const resolved = new Set<string>();
    let entries = { ...current.entries };
    for (const entry of list) {
      const previous = entries[entry.id];
      entries[entry.id] = entry;
      if (entry.deleted) continue;
      if (entry.author.id === me && entry.client_message_id !== null && pending.has(entry.client_message_id) && !resolved.has(entry.client_message_id)) {
        resolved.add(entry.client_message_id);
        announced.set(entry.id, { delivered: false, read: 0 });
        announceDelivery("Message sent.");
      }
      announceSteps(previous && !previous.deleted ? previous : undefined, entry);
      // A quote always shows the quoted message's current text.
      entries = refreshQuotes(entries, entry.id, { message_id: entry.id, author_name: entry.author.name, text: entry.text, edited: entry.edited, deleted: false });
    }
    return { entries, outbox: current.outbox.filter((o) => !resolved.has(o.clientMessageId)) };
  });
}

function sortIds(ids: string[], entries: Record<string, Entry>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const x = entries[a];
    const y = entries[b];
    if (!x || !y) return 0;
    return x.sent_at === y.sent_at ? (a.toLowerCase() < b.toLowerCase() ? -1 : 1) : x.sent_at < y.sent_at ? -1 : 1;
  });
}

export function setHistory(channelId: string, view: HistoryView): void {
  setState((current) => ({ histories: { ...current.histories, [channelId]: { ...view, ids: sortIds(view.ids, current.entries) } } }));
}

export function setThread(rootId: string, view: ThreadView): void {
  setState((current) => ({ threads: { ...current.threads, [rootId]: { ...view, ids: sortIds(view.ids, current.entries) } } }));
}

// A new or replayed message joins its channel history or its open thread, once.
export function placeMessage(message: Message): void {
  putEntries([message]);
  setState((current) => {
    if (message.thread_root_id === null) {
      const view = current.histories[message.channel_id];
      if (!view || view.status !== "ready" || view.ids.includes(message.id)) return {};
      return { histories: { ...current.histories, [message.channel_id]: { ...view, ids: sortIds([...view.ids, message.id], current.entries) } } };
    }
    const thread = current.threads[message.thread_root_id];
    if (!thread || thread.status !== "ready" || thread.ids.includes(message.id)) return {};
    return { threads: { ...current.threads, [message.thread_root_id]: { ...thread, ids: sortIds([...thread.ids, message.id], current.entries) } } };
  });
}

// A deleted message leaves every list at once; a root with replies stays as its placeholder.
export function removeMessage(messageId: string): void {
  setState((current) => {
    const entry = current.entries[messageId];
    let entries = { ...current.entries };
    const histories = { ...current.histories };
    const threads = { ...current.threads };
    if (entry && !entry.deleted && entry.thread_root_id === null && entry.reply_count > 0) {
      entries[messageId] = { id: entry.id, channel_id: entry.channel_id, deleted: true, sent_at: entry.sent_at, reply_count: entry.reply_count };
    } else {
      delete entries[messageId];
      for (const [id, view] of Object.entries(histories)) {
        if (view.ids.includes(messageId)) histories[id] = { ...view, ids: view.ids.filter((x) => x !== messageId) };
      }
      for (const [id, view] of Object.entries(threads)) {
        if (view.ids.includes(messageId)) threads[id] = { ...view, ids: view.ids.filter((x) => x !== messageId) };
      }
    }
    entries = refreshQuotes(entries, messageId, { message_id: messageId, deleted: true });
    return { entries, histories, threads };
  });
}

// A revocation carries only the channel id, and a channel-list refresh can drop the channel before
// that event is applied. Names are remembered as channels are seen so the lost-access copy still
// has one either way.
const seenNames = new Map<string, string>();

export function rememberChannels(channels: Channel[]): void {
  for (const channel of channels) seenNames.set(channel.id, channel.name);
}

export function upsertChannel(channel: Channel): void {
  seenNames.set(channel.id, channel.name);
  setState((current) => {
    const others = current.channels.filter((c) => c.id !== channel.id);
    const revoked = { ...current.revoked };
    delete revoked[channel.id];
    return { channels: [...others, channel].sort((a, b) => (a.name < b.name ? -1 : 1)), revoked };
  });
}

export function revokeChannel(channelId: string): void {
  setState((current) => {
    const name = current.channels.find((c) => c.id === channelId)?.name ?? seenNames.get(channelId);
    const histories = { ...current.histories };
    delete histories[channelId];
    return {
      channels: current.channels.filter((c) => c.id !== channelId),
      revoked: name ? { ...current.revoked, [channelId]: name } : current.revoked,
      histories,
      outbox: current.outbox.filter((o) => o.channelId !== channelId),
    };
  });
}

export function updateOutgoing(clientMessageId: string, patch: Partial<Outgoing>): void {
  setState((current) => ({ outbox: current.outbox.map((o) => (o.clientMessageId === clientMessageId ? { ...o, ...patch } : o)) }));
}

export function dropOutgoing(clientMessageId: string): void {
  setState((current) => ({ outbox: current.outbox.filter((o) => o.clientMessageId !== clientMessageId) }));
}
