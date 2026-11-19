import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EARSHOT_REACH, LIVE_DOWN_TEXT, type ChatMessage, type Direction, type SessionDetail, type SessionFrame } from "../../shared/protocol";
import { call, type Reply } from "../lib/api";
import { navigate } from "../lib/router";
import { clearNotice, showNotice } from "../lib/store";
import { idle, type Result } from "../lib/useAction";

type RoomState = Omit<Extract<SessionFrame, { type: "state" }>, "type">;

const DEDUPE_MS = 2000;
const KEEP = 20;
const RETRY_MS = 2000;
const RIPPLE_STEP_MS = 60;
const RIPPLE_HOLD_MS = 500;
const OUTLINE_HOLD_MS = 2000;
const LIVE_KEY = "live";

interface Announcement {
  id: number;
  text: string;
}

export interface Ripple {
  phase: "none" | "growing" | "outline";
  radius: number;
  at: { x: number; y: number } | null;
}

const NO_RIPPLE: Ripple = { phase: "none", radius: 0, at: null };

const reducedQuery = (): MediaQueryList => window.matchMedia("(prefers-reduced-motion: reduce)");

/** Whether the person's system asks for reduced motion, following changes while the page is open. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = reducedQuery();
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => reducedQuery().matches,
  );
}

/** A narrow screen shows the phone arrangement; the width is read from the viewport, never from a timer. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(max-width: 699px)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(max-width: 699px)").matches,
  );
}

function initial(detail: SessionDetail): RoomState {
  const rich = detail as SessionDetail & Partial<RoomState>;
  return {
    roomVersion: detail.roomVersion,
    hostId: detail.hostId,
    count: detail.count,
    layout: detail.layout as RoomState["layout"],
    features: detail.features ?? [],
    people: detail.people ?? [],
    nearby: rich.nearby ?? [],
    nearest: rich.nearest ?? null,
    votes: rich.votes ?? [],
    voteTargetNames: rich.voteTargetNames ?? {},
    relations: rich.relations ?? { blocked: [], muted: [] },
    reach: rich.reach ?? EARSHOT_REACH,
  };
}

export function useRoom(detail: SessionDetail, selfId: string, reduced: boolean) {
  const id = detail.id;
  const [view, setView] = useState<RoomState>(() => initial(detail));
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [removed, setRemoved] = useState(false);
  const [ripple, setRipple] = useState<Ripple>(NO_RIPPLE);
  const [chatResult, setChatResult] = useState<Result>(idle);
  const last = useRef<{ text: string; at: number } | null>(null);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const socket = useRef<WebSocket | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Identical consecutive text within 2 seconds of page clock is not repeated; the latest 20 are kept. */
  const announce = useCallback((text: string): void => {
    const now = Date.now();
    if (last.current && last.current.text === text && now - last.current.at < DEDUPE_MS) return;
    last.current = { text, at: now };
    counter.current += 1;
    const entry = { id: counter.current, text };
    setAnnouncements((list) => [...list, entry].slice(-KEEP));
  }, []);

  const liveDown = useCallback((): void => {
    showNotice(LIVE_DOWN_TEXT, LIVE_KEY);
    socket.current?.close();
  }, []);

  const refused = useCallback(
    (reply: Reply<unknown>): void => {
      if (reply.error === LIVE_DOWN_TEXT) liveDown();
      else if (reply.error && reply.status !== 404) announce(reply.error);
    },
    [announce, liveDown],
  );

  useEffect(() => {
    let closed = false;
    let down = false;
    let timer = 0;
    const loadChat = (): void => {
      void call<{ messages: ChatMessage[] }>("GET", `/api/sessions/${id}/chat`).then((reply) => {
        if (reply.ok) setChat((current) => [...reply.data.messages, ...current.filter((m) => !reply.data.messages.some((old) => old.id === m.id))]);
      });
    };
    const open = (): void => {
      const ws = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/sessions/${id}`);
      socket.current = ws;
      ws.onmessage = (event: MessageEvent<string>) => {
        const frame = JSON.parse(event.data) as SessionFrame;
        if (frame.type === "state") {
          const { type: _type, ...next } = frame;
          setView(next);
          if (down) {
            down = false;
            clearNotice(LIVE_KEY);
            announce("Live room restored.");
            loadChat();
          }
        } else if (frame.type === "announce") announce(frame.text);
        else if (frame.type === "chat") setChat((current) => (current.some((m) => m.id === frame.message.id) ? current : [...current, frame.message]));
        else setRemoved(true);
      };
      ws.onclose = (event) => {
        if (closed || socket.current !== ws) return;
        if (event.code === 4001 || event.code === 4004) {
          setRemoved(true);
          return;
        }
        if (event.code === 4000) {
          navigate("/sessions");
          return;
        }
        down = true;
        showNotice(LIVE_DOWN_TEXT, LIVE_KEY);
        timer = window.setTimeout(open, RETRY_MS);
      };
    };
    open();
    loadChat();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket.current?.close();
      timers.current.forEach((handle) => window.clearTimeout(handle));
      clearNotice(LIVE_KEY);
    };
  }, [id, announce]);

  /** Actions run one at a time in the order pressed, so no key is dropped. */
  const enqueue = useCallback((work: () => Promise<void>): void => {
    queue.current = queue.current.then(work).catch(() => undefined);
  }, []);

  const step = useCallback(
    async (direction: Direction): Promise<void> => {
      const reply = await call<{ result: string }>("POST", `/api/sessions/${id}/step`, { direction });
      if (reply.ok) {
        if (reply.data.result === "left") navigate("/sessions");
      } else refused(reply);
    },
    [id, refused],
  );

  const sitOrStand = useCallback(async (): Promise<void> => {
    const me = viewRef.current.people.find((person) => person.personId === selfId);
    const reply = await call("POST", `/api/sessions/${id}/${me?.seated ? "stand" : "sit"}`);
    if (!reply.ok) refused(reply);
  }, [id, selfId, refused]);

  const runRipple = useCallback(
    (reach: number): void => {
      timers.current.forEach((handle) => window.clearTimeout(handle));
      timers.current = [];
      const me = viewRef.current.people.find((person) => person.personId === selfId);
      const at = me ? { x: me.x, y: me.y } : null;
      const later = (work: () => void, ms: number): void => {
        timers.current.push(window.setTimeout(work, ms));
      };
      if (reduced) {
        setRipple({ phase: "outline", radius: reach, at });
        later(() => setRipple(NO_RIPPLE), OUTLINE_HOLD_MS);
        return;
      }
      setRipple({ phase: "growing", radius: 0, at });
      const grow = (radius: number): void => {
        setRipple({ phase: "growing", radius, at });
        if (radius < reach) later(() => grow(radius + 1), RIPPLE_STEP_MS);
        else later(() => setRipple(NO_RIPPLE), RIPPLE_HOLD_MS);
      };
      later(() => grow(1), RIPPLE_STEP_MS);
    },
    [reduced, selfId],
  );

  const sendChat = useCallback(
    async (text: string): Promise<boolean> => {
      setChatResult({ text: "Sending...", kind: "pending" });
      const reply = await call<{ heardBy: number }>("POST", `/api/sessions/${id}/chat`, { text });
      if (!reply.ok) {
        setChatResult({ text: reply.error, kind: "refused" });
        if (reply.error === LIVE_DOWN_TEXT) liveDown();
        return false;
      }
      setChatResult({ text: `Heard by ${reply.data.heardBy}.`, kind: "ok" });
      runRipple(viewRef.current.reach);
      return true;
    },
    [id, liveDown, runRipple],
  );

  return { view, announcements, announce, chat, removed, ripple, chatResult, enqueue, step, sitOrStand, sendChat, refused, liveDown };
}
