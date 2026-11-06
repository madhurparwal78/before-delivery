import { api, sessionEnded, store, type User } from "./lib.ts";

/** The signed-in person, re-read after their own role change. */
export const session = store<User | null>(null);

/** `reduced` while the system asks for reduced motion, followed live (DP-48). */
const query = matchMedia("(prefers-reduced-motion: reduce)");
export const motion = store<"reduced" | "full">(query.matches ? "reduced" : "full");
function applyMotion(): void {
  const value = query.matches ? "reduced" : "full";
  document.documentElement.dataset.motion = value;
  motion.set(value);
}
query.addEventListener("change", applyMotion);
applyMotion();
export const reduced = () => motion.get() === "reduced";

/** The seq of the latest activity event this screen has applied (main[data-synced-seq]). */
export const syncedSeq = store<number | null>(null);

/** Copy in status "Activity": set by the person's own actions and own role change only. */
export const activity = store<{ text: string; n: number }>({ text: "", n: 0 });
export function announceActivity(text: string): void {
  activity.set({ text, n: activity.get().n + 1 });
}

interface ServiceStatus {
  evidence: "up" | "down";
  mail: "up" | "down";
  queued: number;
}

/** Banners follow GET /api/status; a poll sent before the latest action reply is ignored (DP-72). */
export const services = store<ServiceStatus>({ evidence: "up", mail: "up", queued: 0 });
let replyGeneration = 0;

async function pollStatus(): Promise<void> {
  const sentAt = replyGeneration;
  try {
    const s = await api<{ evidence: "up" | "down"; mail: "up" | "down"; queued_notices: number }>("GET", "/api/status");
    if (sentAt !== replyGeneration) return;
    services.set({ evidence: s.evidence, mail: s.mail, queued: s.queued_notices });
  } catch {
    /* the next poll retries */
  }
}

export function startStatusPolling(): void {
  void pollStatus();
  setInterval(() => void pollStatus(), 5_000);
}

export function evidenceDownNow(): void {
  replyGeneration++;
  services.set({ ...services.get(), evidence: "down" });
}

export function queuedFromReply(queued: number): void {
  replyGeneration++;
  services.set({ ...services.get(), queued });
}

export interface ActivityEvent {
  seq: number;
  action: string;
  target: { type: string; id: string };
}

type Listener = (event: ActivityEvent) => void;
const listeners = new Set<Listener>();

export function onActivity(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Follows GET /api/events in 10-second windows. When the stream ends, the session is read again: a
 * 401 ends the visit (DP-07); otherwise the stream resumes a second later from the last id it sent,
 * so the page falls quiet between windows without missing or repeating a row.
 */
export function openActivityStream(afterSeq: number | null): void {
  let last = afterSeq;
  const connect = async () => {
    try {
      const url = last === null ? "/api/events" : `/api/events?after_seq=${last}`;
      const res = await fetch(url, { headers: { Accept: "text/event-stream", "X-Stream-Window": "10" }, credentials: "same-origin" });
      if (res.status === 401) return sessionEnded();
      if (!res.ok || !res.body) throw new Error("stream refused");
      // A whole-body read of one window lets the browser record a clean finish, not an abort.
      const finished = res.clone().text().catch(() => "");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const id = block.split("\n").find((l) => l.startsWith("id: "));
          if (id) last = Number(id.slice(4));
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          const event = JSON.parse(data.slice(6)) as ActivityEvent;
          last = event.seq;
          for (const fn of [...listeners]) fn(event);
        }
      }
      await finished;
    } catch {
      /* fall through to the session check */
    }
    try {
      const me = await api<{ user: User }>("GET", "/api/session");
      session.set(me.user);
    } catch {
      return;
    }
    setTimeout(() => void connect(), 1_000);
  };
  void connect();
}

/** The person's own role changed: read the session again, then say so once (DP-08). */
export async function ownRoleChanged(): Promise<User> {
  const me = await api<{ user: User }>("GET", "/api/session");
  session.set(me.user);
  announceActivity(`Your role changed to ${me.user.role}.`);
  return me.user;
}

/** Restores focus to the element with the same data-focus-key after a repaint moved or relabelled it. */
export function rememberFocus(): () => void {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  return () => {
    if (!key) return;
    const el = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  };
}

/**
 * Viewport changes reach screens through media-query and resize events, and a 100 ms check backs
 * them up, so each published viewport always gets its layout.
 */
const viewportWatchers = new Set<() => void>();
let lastViewport = `${innerWidth}x${innerHeight}`;
function viewportChanged(): void {
  lastViewport = `${innerWidth}x${innerHeight}`;
  for (const fn of [...viewportWatchers]) fn();
}
addEventListener("resize", viewportChanged);
setInterval(() => {
  if (`${innerWidth}x${innerHeight}` !== lastViewport) viewportChanged();
  if ((query.matches ? "reduced" : "full") !== motion.get()) applyMotion();
}, 100);

export function watchViewport(fn: () => void): () => void {
  viewportWatchers.add(fn);
  return () => viewportWatchers.delete(fn);
}
