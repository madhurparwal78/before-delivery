import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { errorBodySchema, roomEventSchema, type StoredEvent } from "../../shared/schemas";

type Source = { role: "stage" } | { clientId: string };
export type Notice = "quiet" | "pending" | "backup" | "returned";
export type Delivery = { replay: boolean };
type Handlers = {
  onEvent: (event: StoredEvent, delivery: Delivery) => void;
  // Only a phone's seat can be retired or its room ended under it.
  onSuperseded?: () => void;
  onGone?: () => void;
};

const STREAM_RETRY_MS = 5000;
const RECONNECT_MS = 1000;
const CATCH_UP_MS = 250;
const pollReply = z.object({ events: z.array(z.object({ id: z.number().int(), type: z.string(), data: z.unknown() })) });

type StreamEnd = { kind: "ended" } | { kind: "superseded" } | { kind: "gone" } | { kind: "refused"; live: boolean } | { kind: "dropped" };

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

function parseData(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toStored(id: number, type: string, data: unknown): StoredEvent | null {
  const parsed = roomEventSchema.safeParse({ type, data });
  return parsed.success ? { ...parsed.data, id } : null;
}

function sourceQuery(source: Source): string {
  return "role" in source ? "role=stage" : `clientId=${encodeURIComponent(source.clientId)}`;
}

// Live events over a server-sent stream with a polling fallback (the backup link), resumed from the last event id.
export function useRoomEvents(roomId: string, source: Source | null, afterId: number | null, handlers: Handlers): Notice {
  const [notice, setNotice] = useState<Notice>("quiet");
  const latest = useRef(handlers);
  latest.current = handlers;
  const sourceKey = source ? sourceQuery(source) : null;

  useEffect(() => {
    if (sourceKey === null || afterId === null) return;
    const control = new AbortController();
    const { signal } = control;
    let cursor = afterId;
    let everBackup = false;

    const deliver = (event: StoredEvent, replay: boolean): void => {
      if (event.id <= cursor) return;
      cursor = event.id;
      latest.current.onEvent(event, { replay });
    };

    async function streamOnce(onOpen: () => void): Promise<StreamEnd> {
      let response: Response;
      try {
        response = await fetch(`/api/rooms/${roomId}/stream?${sourceKey}`, {
          headers: { "last-event-id": String(cursor), accept: "text/event-stream" },
          credentials: "same-origin",
          signal,
        });
      } catch {
        return { kind: "dropped" };
      }
      if (!response.ok || !response.body) {
        const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
        const code = body.success ? body.data.error : "";
        if (response.status === 409) return { kind: "superseded" };
        if (response.status === 410) return { kind: "gone" };
        return { kind: "refused", live: code !== "live_unavailable" };
      }
      onOpen();
      setNotice(everBackup ? "returned" : "quiet");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let replaying = true;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return { kind: "dropped" };
          buffer += decoder.decode(value, { stream: true });
          let cut = buffer.indexOf("\n\n");
          while (cut >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            cut = buffer.indexOf("\n\n");
            let id = "";
            let type = "";
            const data: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) {
                if (line === ": live") replaying = false;
              } else if (line.startsWith("id:")) id = line.slice(3).trim();
              else if (line.startsWith("event:")) type = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            }
            if (type === "superseded") return { kind: "superseded" };
            const event = toStored(Number(id), type, parseData(data.join("\n")));
            if (event) {
              deliver(event, replaying);
              if (event.type === "ended") return { kind: "ended" };
            }
          }
        }
      } catch {
        return { kind: "dropped" };
      }
    }

    async function pollLoop(stop: AbortSignal): Promise<void> {
      while (!stop.aborted && !signal.aborted) {
        const startedAt = performance.now();
        let response: Response;
        try {
          response = await fetch(`/api/rooms/${roomId}/poll?${sourceKey}&after=${cursor}`, { credentials: "same-origin", signal: stop });
        } catch {
          await sleep(RECONNECT_MS, stop);
          continue;
        }
        if (response.status === 409) return latest.current.onSuperseded?.();
        if (response.status === 410) return latest.current.onGone?.();
        if (!response.ok) {
          await sleep(RECONNECT_MS, stop);
          continue;
        }
        const reply = pollReply.safeParse(await response.json().catch(() => undefined));
        if (!reply.success) continue;
        const replay = reply.data.events.length > 0 && performance.now() - startedAt < CATCH_UP_MS;
        for (const raw of reply.data.events) {
          const event = toStored(raw.id, raw.type, raw.data);
          if (event) deliver(event, replay);
        }
      }
    }

    async function backupLink(): Promise<StreamEnd> {
      everBackup = true;
      setNotice("backup");
      const polling = new AbortController();
      const stopPolling = (): void => polling.abort();
      const poller = pollLoop(polling.signal);
      try {
        while (!signal.aborted) {
          await sleep(STREAM_RETRY_MS, signal);
          if (signal.aborted) break;
          const end = await streamOnce(stopPolling);
          if (end.kind !== "refused" || end.live) return end;
        }
        return { kind: "dropped" };
      } finally {
        polling.abort();
        await poller;
      }
    }

    void (async () => {
      let end = await streamOnce(() => undefined);
      while (!signal.aborted) {
        if (end.kind === "superseded") return latest.current.onSuperseded?.();
        if (end.kind === "gone") return latest.current.onGone?.();
        if (end.kind === "ended") return;
        if (end.kind === "refused" && !end.live) {
          end = await backupLink();
          continue;
        }
        setNotice("pending");
        await sleep(RECONNECT_MS, signal);
        end = await streamOnce(() => undefined);
      }
    })();

    return () => control.abort();
  }, [roomId, sourceKey, afterId === null]);

  return notice;
}
