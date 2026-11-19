import { useEffect, useRef } from "react";

interface LiveMessage {
  topic: string;
  event: string;
  data: Record<string, unknown>;
  server_time: string;
}

type Handler = (message: LiveMessage) => void;

const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let retry = 0;

function open(): void {
  if (socket && socket.readyState <= 1) return;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const next = new WebSocket(`${scheme}://${location.host}/api/live`);
  socket = next;
  next.addEventListener("open", () => {
    retry = 0;
    const topics = [...handlers.keys()];
    if (topics.length > 0) next.send(JSON.stringify({ subscribe: topics }));
  });
  next.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as LiveMessage;
    for (const handler of [...(handlers.get(message.topic) ?? [])]) handler(message);
  });
  next.addEventListener("close", () => {
    if (socket !== next) return;
    socket = null;
    if (handlers.size > 0) setTimeout(open, Math.min(5000, 250 * 2 ** retry++));
  });
}

function send(payload: unknown): void {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
}

/** Subscribes a handler to a topic until the returned function is called. */
function subscribe(topic: string, handler: Handler): () => void {
  const set = handlers.get(topic) ?? new Set<Handler>();
  const first = set.size === 0;
  set.add(handler);
  handlers.set(topic, set);
  open();
  if (first) send({ subscribe: [topic] });
  return () => {
    set.delete(handler);
    if (set.size === 0) {
      handlers.delete(topic);
      send({ unsubscribe: [topic] });
    }
  };
}

/** Runs `handler` for every message on the given topics while the component is mounted. */
export function useTopics(topics: string[], handler: Handler): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = topics.join("|");
  useEffect(() => {
    const stops = key === "" ? [] : key.split("|").map((topic) => subscribe(topic, (message) => latest.current(message)));
    return () => stops.forEach((stop) => stop());
  }, [key]);
}

/** Registers presence on a record while its form is open: an immediate heartbeat, then one every 10 seconds. */
export function usePresence(number: string | null, onViewers: (users: Array<{ username: string; display_name: string }>) => void): void {
  const latest = useRef(onViewers);
  latest.current = onViewers;
  useEffect(() => {
    if (!number) return undefined;
    const stop = subscribe(`presence:${number}`, (message) => latest.current((message.data.users as Array<{ username: string; display_name: string }>) ?? []));
    const beat = (): void => send({ presence: number });
    const wait = setTimeout(beat, 150);
    const timer = setInterval(beat, 10_000);
    return () => {
      clearTimeout(wait);
      clearInterval(timer);
      stop();
    };
  }, [number]);
}
