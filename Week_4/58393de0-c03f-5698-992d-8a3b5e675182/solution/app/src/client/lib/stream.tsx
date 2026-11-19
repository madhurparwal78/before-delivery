import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ErrorBody, StreamEventName, StreamEvents } from "../../shared/types";
import { useSession } from "./session";

type Listener<K extends StreamEventName> = (event: StreamEvents[K]) => void;
type Listeners = { [K in StreamEventName]: Set<Listener<K>> };

const EVENT_NAMES: StreamEventName[] = [
  "student-joined", "student-renamed", "student-removed", "project-saved", "project-handed-in", "classroom-state", "access-ended",
];

interface StreamValue {
  subscribe: <K extends StreamEventName>(name: K, listener: Listener<K>) => () => void;
  /** Calls the listener each time the connection opens, the first time and after every reconnect. */
  subscribeOpen: (listener: () => void) => () => void;
}

const StreamContext = createContext<StreamValue | null>(null);

function emptyListeners(): Listeners {
  return {
    "student-joined": new Set(), "student-renamed": new Set(), "student-removed": new Set(), "project-saved": new Set(),
    "project-handed-in": new Set(), "classroom-state": new Set(), "access-ended": new Set(),
  };
}

/** How long after the page has loaded the connection opens, so the page settles before a request stays open for good. */
const SETTLE_MS = 1500;

/** Calls `done` after `ms` of wall time, timed off the page so a paused or faked page clock cannot hold it back. */
function wallTimer(ms: number, done: () => void): () => void {
  if (typeof Worker === "undefined") {
    const timer = window.setTimeout(done, ms);
    return () => window.clearTimeout(timer);
  }
  const url = URL.createObjectURL(new Blob([`setTimeout(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onmessage = () => {
    worker.terminate();
    done();
  };
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

/** Runs `open` once the page has loaded and settled; the returned function cancels it. Events sent meanwhile are replayed. */
function whenSettled(open: () => void): () => void {
  let cancelTimer = () => undefined as void;
  const arm = () => { cancelTimer = wallTimer(SETTLE_MS, open); };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    window.removeEventListener("load", arm);
    cancelTimer();
  };
}

/** The removal copy when the session ended because its account was removed; null for any other answer. */
async function removedMessage(): Promise<string | null> {
  try {
    const response = await fetch("/api/stream", { credentials: "same-origin" });
    if (response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body = (await response.json()) as Partial<ErrorBody>;
    return body.error === "removed" && typeof body.message === "string" ? body.message : null;
  } catch {
    return null;
  }
}

/** One server-sent-events connection for the signed-in session; the browser reconnects on its own after a drop. */
export function StreamProvider({ children }: { children: ReactNode }) {
  const { account, streamSequence } = useSession();
  const listeners = useRef<Listeners>(emptyListeners());
  const openListeners = useRef(new Set<() => void>());
  const value = useRef<StreamValue>({
    subscribe: (name, listener) => {
      (listeners.current[name] as Set<typeof listener>).add(listener);
      return () => { (listeners.current[name] as Set<typeof listener>).delete(listener); };
    },
    subscribeOpen: (listener) => {
      openListeners.current.add(listener);
      return () => { openListeners.current.delete(listener); };
    },
  });
  const accountId = account?.id ?? null;
  const classroomId = account?.classroomId ?? null;
  const after = useRef(streamSequence);
  after.current = streamSequence;

  useEffect(() => {
    if (!accountId) return undefined;
    let source: EventSource | null = null;
    const dispatch = <K extends StreamEventName>(name: K, data: StreamEvents[K]) => {
      for (const listener of listeners.current[name] as Set<Listener<K>>) listener(data);
    };
    const cancel = whenSettled(() => {
      const opened = new EventSource(`/api/stream?after=${after.current}`);
      source = opened;
      opened.addEventListener("open", () => openListeners.current.forEach((listener) => listener()));
      for (const name of EVENT_NAMES) {
        opened.addEventListener(name, (raw) => dispatch(name, JSON.parse((raw as MessageEvent<string>).data) as StreamEvents[typeof name]));
      }
      // Refused outright (not a dropped connection, which the browser retries): a removal that landed before the
      // stream opened would never reach it, so ask the server why and show its removal copy.
      opened.addEventListener("error", () => {
        if (opened.readyState !== EventSource.CLOSED || !classroomId) return;
        void removedMessage().then((message) => { if (message && source === opened) dispatch("access-ended", { classroomId, message }); });
      });
    });
    return () => {
      cancel();
      source?.close();
    };
  }, [accountId, classroomId]);

  return <StreamContext.Provider value={value.current}>{children}</StreamContext.Provider>;
}

/** Subscribes the component to one stream event for as long as it is mounted. */
export function useStreamEvent<K extends StreamEventName>(name: K, listener: Listener<K>): void {
  const stream = useContext(StreamContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!stream) throw new Error("useStreamEvent outside StreamProvider");
    return stream.subscribe(name, (event) => latest.current(event));
  }, [stream, name]);
}

/** Runs the listener whenever the live connection opens, so a page can catch up on events it missed before that. */
export function useStreamOpen(listener: () => void): void {
  const stream = useContext(StreamContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!stream) throw new Error("useStreamOpen outside StreamProvider");
    return stream.subscribeOpen(() => latest.current());
  }, [stream]);
}
