import { api, ApiFailure, serverNow, upload } from "./api";
import {
  announceDelivery,
  announceUpload,
  getState,
  type Outgoing,
  placeMessage,
  putEntries,
  rememberChannels,
  revokeChannel,
  setHistory,
  setState,
  setThread,
  updateOutgoing,
} from "./store";
import type { Channel, Entry, Message } from "./types";

const PAGE = 30;

// A channel that was on the rail and is missing from a refetch was lost during this session
// (its revocation fell between streams), so it shows the lost-access copy, not not-found.
export async function loadChannels(): Promise<void> {
  const body = await api<{ channels: Channel[] }>("GET", "/api/channels");
  rememberChannels(body.channels);
  const current = new Set(body.channels.map((c) => c.id));
  for (const lost of getState().channels.filter((c) => !current.has(c.id))) revokeChannel(lost.id);
  setState({ channels: body.channels, channelsLoaded: true });
}

function isMessage(entry: Entry): entry is Message {
  return !entry.deleted;
}

// --- Delivery and read reports --------------------------------------------------------------

// A report that got no answer or a server error is tried again after this pause.
const REPORT_RETRY_MS = 2_000;
const deliveredSent = new Set<string>();
const readSent = new Set<string>();
let deliveryQueue: string[] = [];
let deliveryScheduled = false;

async function report(ids: string[], state: "delivered" | "read"): Promise<boolean> {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      await api("POST", "/api/receipts", { message_ids: chunk, state });
    } catch (error) {
      // One unreadable id (deleted meanwhile) refuses the batch; report the rest one by one.
      if (error instanceof ApiFailure && error.status === 404 && chunk.length > 1) {
        for (const id of chunk) await report([id], state);
      } else if (!(error instanceof ApiFailure && error.status === 404)) {
        return false;
      }
    }
  }
  return true;
}

// Every message received from history or events is reported delivered straight away.
export function noteReceived(entries: Entry[]): void {
  const me = getState().me?.user.id;
  for (const entry of entries) {
    if (isMessage(entry) && entry.author.id !== me && !deliveredSent.has(entry.id)) {
      deliveredSent.add(entry.id);
      deliveryQueue.push(entry.id);
    }
  }
  if (deliveryQueue.length === 0 || deliveryScheduled) return;
  deliveryScheduled = true;
  queueMicrotask(() => {
    const ids = deliveryQueue;
    deliveryQueue = [];
    deliveryScheduled = false;
    void report(ids, "delivered").then((ok) => {
      if (ok) return;
      ids.forEach((id) => deliveredSent.delete(id));
      setTimeout(() => noteReceived(ids.flatMap((id) => getState().entries[id] ?? [])), REPORT_RETRY_MS);
    });
  });
}

// A read is reported once a message version has been on screen for a second.
export function reportRead(message: Message): void {
  const key = `${message.id}:${message.version}`;
  if (readSent.has(key) || message.author.id === getState().me?.user.id) return;
  readSent.add(key);
  void report([message.id], "read").then((ok) => {
    if (ok) return;
    readSent.delete(key);
    setTimeout(() => {
      const current = getState().entries[message.id];
      if (current && isMessage(current) && current.version === message.version) reportRead(current);
    }, REPORT_RETRY_MS);
  });
}

export function alreadyRead(message: Message): boolean {
  return readSent.has(`${message.id}:${message.version}`);
}

// --- History and threads ----------------------------------------------------------------------

type Page = { messages: Entry[]; next_cursor: string | null };

export async function loadHistory(channelId: string): Promise<void> {
  const current = getState().histories[channelId];
  setHistory(channelId, { status: current?.status === "ready" ? "ready" : "loading", ids: current?.ids ?? [], nextCursor: current?.nextCursor ?? null, older: "idle" });
  try {
    const body = await api<Page>("GET", `/api/channels/${encodeURIComponent(channelId)}/messages?limit=${PAGE}`);
    putEntries(body.messages);
    setHistory(channelId, { status: "ready", ids: body.messages.map((m) => m.id), nextCursor: body.next_cursor, older: "idle" });
    noteReceived(body.messages);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) setHistory(channelId, { status: "not_found", ids: [], nextCursor: null, older: "idle" });
    else throw error;
  }
}

export async function loadOlder(channelId: string): Promise<void> {
  const view = getState().histories[channelId];
  if (!view || view.status !== "ready" || !view.nextCursor || view.older === "loading") return;
  setHistory(channelId, { ...view, older: "loading" });
  try {
    const body = await api<Page>("GET", `/api/channels/${encodeURIComponent(channelId)}/messages?limit=${PAGE}&before=${encodeURIComponent(view.nextCursor)}`);
    putEntries(body.messages);
    const latest = getState().histories[channelId] ?? view;
    setHistory(channelId, { ...latest, ids: [...body.messages.map((m) => m.id), ...latest.ids], nextCursor: body.next_cursor, older: "idle" });
    noteReceived(body.messages);
  } catch {
    const latest = getState().histories[channelId] ?? view;
    setHistory(channelId, { ...latest, older: "error" });
  }
}

type ThreadPage = { root: Entry; replies: Entry[]; next_cursor: string | null };

export async function loadThread(rootId: string, channelId: string, before?: string): Promise<void> {
  const existing = getState().threads[rootId];
  if (!before) setThread(rootId, { status: existing?.status === "ready" ? "ready" : "loading", ids: existing?.ids ?? [], nextCursor: existing?.nextCursor ?? null });
  try {
    const query = `limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const body = await api<ThreadPage>("GET", `/api/messages/${encodeURIComponent(rootId)}/thread?${query}`);
    if (body.root.channel_id !== channelId) throw new ApiFailure(404, null);
    putEntries([body.root, ...body.replies]);
    const ids = body.replies.map((m) => m.id);
    const latest = getState().threads[rootId];
    setThread(rootId, { status: "ready", ids: before && latest ? [...ids, ...latest.ids] : ids, nextCursor: body.next_cursor });
    noteReceived([body.root, ...body.replies]);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) setThread(rootId, { status: "not_found", ids: [], nextCursor: null });
    else throw error;
  }
}

// --- Sending ------------------------------------------------------------------------------------

const SEND_TIMEOUT_MS = 15_000;

type Sent = { message: Message };

function failureText(error: unknown): { line: string; outage: boolean } {
  if (error instanceof ApiFailure && error.body && error.status < 500) {
    const fieldCopy = error.body.errors ? Object.values(error.body.errors)[0] : undefined;
    return { line: fieldCopy ?? error.body.message, outage: false };
  }
  if (error instanceof ApiFailure && error.body) return { line: error.body.message, outage: true };
  return { line: "Message failed to send. Use Retry send.", outage: true };
}

function photoWord(count: number): string {
  return count === 1 ? "photo" : "photos";
}

export function createOutgoing(item: Omit<Outgoing, "state" | "failure" | "attempt" | "createdAt">): void {
  const outgoing: Outgoing = { ...item, state: "pending", failure: null, attempt: 0, createdAt: serverNow() };
  setState((current) => ({ outbox: [...current.outbox, outgoing] }));
  void attemptSend(outgoing.clientMessageId);
}

// One attempt of a send. A later attempt or a timeout makes this attempt's answer stale.
export async function attemptSend(clientMessageId: string): Promise<void> {
  const item = getState().outbox.find((o) => o.clientMessageId === clientMessageId);
  if (!item) return;
  const attempt = item.attempt + 1;
  updateOutgoing(clientMessageId, { state: "pending", failure: null, attempt });
  let timedOut = false;
  const current = () => !timedOut && getState().outbox.some((o) => o.clientMessageId === clientMessageId && o.attempt === attempt);
  // Upload copy follows this attempt even once the live event has already placed its message.
  const uploading = () => !timedOut && !getState().outbox.some((o) => o.clientMessageId === clientMessageId && o.attempt !== attempt);
  const path = `/api/channels/${encodeURIComponent(item.channelId)}/messages`;
  const fields = {
    client_message_id: item.clientMessageId,
    text: item.text,
    thread_root_id: item.threadRootId,
    quoted_message_id: item.quote?.messageId ?? null,
  };

  const timer = setTimeout(() => {
    if (!current()) return;
    timedOut = true;
    updateOutgoing(clientMessageId, { state: "failed", failure: "Message failed to send. Use Retry send." });
    announceDelivery("Message failed to send. Use Retry send.");
  }, SEND_TIMEOUT_MS);

  try {
    let sent: Sent;
    if (item.files.length > 0) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) if (value !== null) form.append(key, value);
      for (const file of item.files) form.append("file", file, file.name);
      const count = item.files.length;
      let quarter = 0;
      setUploadFraction(0);
      const result = await upload<Sent>(path, form, (fraction) => {
        if (!uploading()) return;
        setUploadFraction(fraction);
        const reached = Math.floor(fraction * 4);
        while (quarter < reached) {
          quarter += 1;
          announceUpload(`Uploading ${count} ${photoWord(count)}: ${quarter * 25}%.`);
        }
      });
      sent = result.body;
      if (uploading()) {
        while (quarter < 4) {
          quarter += 1;
          announceUpload(`Uploading ${count} ${photoWord(count)}: ${quarter * 25}%.`);
        }
        announceUpload(count === 1 ? "1 photo sent." : `${count} photos sent.`);
      }
    } else {
      sent = await api<Sent>("POST", path, fields);
    }
    clearTimeout(timer);
    if (!current()) return;
    placeMessage(sent.message);
  } catch (error) {
    clearTimeout(timer);
    if (!current()) return;
    const { line, outage } = failureText(error);
    updateOutgoing(clientMessageId, { state: "failed", failure: line });
    if (item.files.length > 0 && error instanceof ApiFailure && error.body) announceUpload(`Photo upload stopped: ${line}`);
    announceDelivery(outage ? "Message failed to send. Use Retry send." : `Message failed to send: ${line}`);
  } finally {
    // Only the newest attempt of a send may take the progress bar down.
    const latest = getState().outbox.find((o) => o.clientMessageId === clientMessageId);
    if (item.files.length > 0 && (!latest || latest.attempt === attempt)) setUploadFraction(null);
  }
}

// The visible progress bar's value: null while no photo send is in flight.
let uploadFraction: number | null = null;
const uploadListeners = new Set<() => void>();
function setUploadFraction(value: number | null): void {
  uploadFraction = value;
  uploadListeners.forEach((listener) => listener());
}
export const uploadProgress = {
  get: () => uploadFraction,
  subscribe: (listener: () => void) => {
    uploadListeners.add(listener);
    return () => uploadListeners.delete(listener);
  },
};
