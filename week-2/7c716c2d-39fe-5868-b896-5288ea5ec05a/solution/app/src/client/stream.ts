// The page's one event stream: read over fetch so a reconnect can send the last event id it saw.
import type { Issue, Knock, Message, Room, UnreadBody } from "./api";

/** The published events (brief: Event stream), narrowed by name. */
export type StreamEvent =
  | { name: "message" | "thread_reply"; data: Message }
  | { name: "message_deleted"; data: { id: number; channel_id: string; thread_root_id: number | null } }
  | { name: "unread"; data: UnreadBody }
  | { name: "typing"; data: { channel_id: string; typing: string[] } }
  | { name: "presence"; data: { person_id: string; status: "active" | "away" } }
  | { name: "room"; data: Room }
  | { name: "knock"; data: Knock }
  | { name: "issue"; data: Issue }
  | { name: "doc"; data: { id: string; project_id: string; version: number; updated_by: string } }
  | { name: "notice" | "reset"; data: Record<string, never> }
  | { name: "revoked"; data: { scope: "channel" | "project" | "workspace"; id: string } };

const SETTLE_MS = 1200;

interface StreamHandlers {
  event: (event: StreamEvent) => void;
  signedOut: () => void;
  trouble: () => void;
}

/** `resume` is a server-rendered page's event cursor: the stream opens once the page has settled and replays from it. */
export function openStream(handlers: StreamHandlers, resume: string | null = null): () => void {
  let lastId: string | null = resume;
  let stopped = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const retry = (ms: number): void => {
    if (!stopped) timer = setTimeout(() => void connect(), ms);
  };

  const dispatch = (block: string): void => {
    let name = "message";
    const data: string[] = [];
    let id: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    if (data.length === 0) return;
    if (id !== null) lastId = id;
    handlers.event({ name, data: JSON.parse(data.join("\n")) } as StreamEvent);
  };

  const connect = async (): Promise<void> => {
    controller = new AbortController();
    try {
      const response = await fetch("/api/events", {
        headers: { Accept: "text/event-stream", ...(lastId ? { "Last-Event-ID": lastId } : {}) },
        signal: controller.signal,
        credentials: "same-origin",
      });
      if (response.status === 401) {
        handlers.signedOut();
        return;
      }
      if (!response.ok || !response.body) {
        handlers.trouble();
        retry(5000);
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r\n/g, "\n");
        let end = buffer.indexOf("\n\n");
        while (end !== -1) {
          dispatch(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf("\n\n");
        }
      }
      retry(1000);
    } catch {
      if (!stopped) {
        handlers.trouble();
        retry(2000);
      }
    }
  };

  if (resume === null) void connect();
  else retry(SETTLE_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
