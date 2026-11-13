// Live project channel: one WebSocket per project (`GET /api/live?project=<id>&since=<seq>`), shared by every subscriber on the
// page and ref-counted.
//
//   Message shape  { seq:number, type:string, data:{ say?: Say[] , ... } }   (`instance` messages carry no seq; `{"type":"resync"}`
//   asks every subscriber to reload). Say = { text, to?: username, pages?: page keys }; page keys are 'project', 'mr:<iid>',
//   'pipeline:<id>', 'job:<id>', 'train:<target>', 'board:<id>', 'issue:<iid>', 'env:<id>', 'wiki:<slug>', 'export', 'import'.
//
//   Every message is delivered to subscribers synchronously from the socket's onmessage handler (no timers, no frames).
//   Duplicates (seq <= highest applied) are dropped. After a drop the channel reconnects with backoff on page timers and
//   resumes with `since=<highest seq>`. Pages never open sockets themselves: <Main project> / <LiveMain project> (shell/main.tsx)
//   start the channel once the project's current seq is known.
//
//   subscribeProject(project, listener)   low level: { onMessage, onResync?, onSnapshot?, onDispatched? }
//   startChannel(project, seq|null)       opens the socket (called by Main); returns the stop function
//   sendPresence(project, iid|null)      the merge request this page has open (the server's `Viewing now`); resent on reconnect
//   useProjectLive(project, onMessage, onResync?)   hook: handler runs synchronously from the socket handler
//   useLiveResource({ project, types, load, deps, match? })   { data, error, loading, reload, setData }: reloads when a message
//                                          of one of `types` arrives and tells the page's seq tracker when that reload is applied
//   useLivePage()                          { begin(seq) -> done } for pages that apply effects asynchronously themselves: call
//                                          begin(msg.seq) in the handler and done() when the effect is on screen, so
//                                          <main data-seq> only advances after it.
import { createContext } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import { type Loader, type Resource, useResource } from "./api.ts";
import { setStorage } from "./instance.ts";
import { asNumber, asString, asStringList, isRecord, nextTick } from "./util.ts";

interface Say {
  text: string;
  to?: string;
  pages?: string[];
}

export interface LiveData {
  say?: Say[];
  [key: string]: unknown;
}

export interface LiveMessage {
  seq: number | null;
  type: string;
  data: LiveData;
}

interface LiveListener {
  onMessage(message: LiveMessage): void;
  onResync?(): void;
  /** The project's current seq became known at `tick` (see nextTick); anything loaded before it should be loaded again. */
  onSnapshot?(tick: number): void;
  /** Runs after every subscriber has seen the message. */
  onDispatched?(message: LiveMessage): void;
}

interface Channel {
  id: string;
  listeners: Set<LiveListener>;
  starts: number;
  socket: WebSocket | null;
  seq: number | null;
  attempts: number;
  retry: number | null;
  /** The request the page has open, told to the server on every (re)connect. */
  presence: number | null;
}

const channels = new Map<string, Channel>();

function channelFor(id: string): Channel {
  let channel = channels.get(id);
  if (!channel) {
    channel = { id, listeners: new Set(), starts: 0, socket: null, seq: null, attempts: 0, retry: null, presence: null };
    channels.set(id, channel);
  }
  return channel;
}

function collect(channel: Channel): void {
  if (channel.listeners.size === 0 && channel.starts === 0) channels.delete(channel.id);
}

function parseMessage(text: string): LiveMessage | "resync" | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const type = asString(raw.type);
  if (type === null) return null;
  if (type === "resync") return "resync";
  const data: LiveData = isRecord(raw.data) ? { ...raw.data } : {};
  if (data.say !== undefined) data.say = parseSay(data.say);
  return { seq: asNumber(raw.seq), type, data };
}

function parseSay(value: unknown): Say[] {
  if (!Array.isArray(value)) return [];
  const out: Say[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const text = asString(item.text);
    if (text === null) continue;
    const entry: Say = { text };
    const to = asString(item.to);
    if (to !== null) entry.to = to;
    if (Array.isArray(item.pages)) entry.pages = asStringList(item.pages);
    out.push(entry);
  }
  return out;
}

function deliver(channel: Channel, message: LiveMessage): void {
  if (message.seq !== null) {
    if (channel.seq !== null && message.seq <= channel.seq) return;
    channel.seq = message.seq;
  }
  const listeners = [...channel.listeners];
  for (const listener of listeners) {
    try {
      listener.onMessage(message);
    } catch (cause) {
      console.error(cause);
    }
  }
  for (const listener of listeners) {
    try {
      listener.onDispatched?.(message);
    } catch (cause) {
      console.error(cause);
    }
  }
}

function socketUrl(channel: Channel): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const since = channel.seq === null ? "" : `&since=${channel.seq}`;
  return `${scheme}://${location.host}/api/live?project=${encodeURIComponent(channel.id)}${since}`;
}

function connect(channel: Channel): void {
  if (channel.starts === 0 || channel.socket) return;
  const socket = new WebSocket(socketUrl(channel));
  channel.socket = socket;
  socket.onopen = () => {
    channel.attempts = 0;
    if (channel.presence !== null) socket.send(JSON.stringify({ type: "presence", mr: channel.presence }));
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const message = parseMessage(event.data);
    if (message === null) return;
    if (message === "resync") {
      for (const listener of [...channel.listeners]) listener.onResync?.();
      return;
    }
    if (message.type === "instance") {
      setStorage(message.data.storage === "down" ? "down" : "up");
      return;
    }
    deliver(channel, message);
  };
  socket.onclose = () => {
    if (channel.socket !== socket) return;
    channel.socket = null;
    if (channel.starts === 0) return;
    const delay = Math.min(500 * 2 ** channel.attempts, 10000);
    channel.attempts++;
    channel.retry = window.setTimeout(() => {
      channel.retry = null;
      connect(channel);
    }, delay);
  };
}

export function subscribeProject(project: string | number, listener: LiveListener): () => void {
  const channel = channelFor(String(project));
  channel.listeners.add(listener);
  return () => {
    channel.listeners.delete(listener);
    collect(channel);
  };
}

/** Tells the server which merge request this page has open (null: none). Sent at once when the socket is open, else on connect. */
export function sendPresence(project: string | number, mr: number | null): void {
  const channel = channelFor(String(project));
  channel.presence = mr;
  if (channel.socket?.readyState === WebSocket.OPEN) channel.socket.send(JSON.stringify({ type: "presence", mr }));
  collect(channel);
}

export function startChannel(project: string | number, seq: number | null): () => void {
  const channel = channelFor(String(project));
  channel.starts++;
  if (channel.starts === 1) {
    channel.seq = seq;
    channel.attempts = 0;
    const tick = nextTick();
    for (const listener of [...channel.listeners]) listener.onSnapshot?.(tick);
    connect(channel);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    channel.starts--;
    if (channel.starts > 0) return;
    if (channel.retry !== null) clearTimeout(channel.retry);
    channel.retry = null;
    const socket = channel.socket;
    channel.socket = null;
    channel.seq = null;
    socket?.close();
    collect(channel);
  };
}

export interface LivePage {
  project: string;
  /** Marks a message's effects as in progress; call the returned function once they are on screen. */
  begin(seq: number): () => void;
}

export const LivePageContext = createContext<LivePage | null>(null);

export function useLivePage(): LivePage | null {
  return useContext(LivePageContext);
}

export function useProjectLive(project: string | number, onMessage: (message: LiveMessage) => void, onResync?: () => void): void {
  const handlers = useRef({ onMessage, onResync });
  handlers.current = { onMessage, onResync };
  useLayoutEffect(
    () =>
      subscribeProject(project, {
        onMessage: (message) => handlers.current.onMessage(message),
        onResync: () => handlers.current.onResync?.(),
      }),
    [String(project)],
  );
}

interface LiveResourceOptions<T> {
  project: string | number;
  types: readonly string[];
  load: Loader<T>;
  deps?: readonly unknown[];
  match?: (message: LiveMessage) => boolean;
  /** For a hook called above <LiveMain>: a ref the page fills in (from useLivePage inside it) so data-seq still waits for the reload. */
  livePage?: { current: LivePage | null };
}

export function useLiveResource<T>(options: LiveResourceOptions<T>): Resource<T> {
  const resource = useResource(options.load, options.deps ?? []);
  const page = useLivePage();
  const latest = useRef({ resource, options, page });
  latest.current = { resource, options, page };
  useLayoutEffect(
    () =>
      subscribeProject(options.project, {
        onMessage(message) {
          const { resource: current, options: opts, page } = latest.current;
          const tracker = page ?? opts.livePage?.current ?? null;
          if (!opts.types.includes(message.type)) return;
          if (opts.match && !opts.match(message)) return;
          const done = message.seq !== null && tracker ? tracker.begin(message.seq) : null;
          void current.reload().then(done ?? undefined);
        },
        onResync() {
          void latest.current.resource.reload();
        },
        onSnapshot(tick) {
          if (latest.current.resource.startedTick() < tick) void latest.current.resource.reload();
        },
      }),
    [String(options.project)],
  );
  return resource;
}
