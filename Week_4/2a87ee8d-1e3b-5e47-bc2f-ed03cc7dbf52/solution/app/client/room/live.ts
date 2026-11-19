// The live board stream. It reconnects by itself after a drop and sends the last event id it received, so the
// server can catch it up. Read with fetch so the Last-Event-ID header can be set on every reconnect.
import type { Presence } from "../types.js";

interface LiveHandlers {
  board: (version: number) => void;
  presence: (p: Presence) => void;
  ended: () => void;
  down: () => void;
  up: () => void;
}

export function openLive(workshopId: string, on: LiveHandlers): () => void {
  let lastId: string | null = null;
  let controller: AbortController | null = null;
  let retry = 0;
  let stopped = false;
  let isDown = false;

  const drop = () => {
    controller?.abort();
    controller = null;
    if (!isDown) {
      isDown = true;
      on.down();
    }
    schedule();
  };

  const schedule = () => {
    if (stopped || retry) return;
    retry = window.setTimeout(() => {
      retry = 0;
      void connect();
    }, 1000);
  };

  const dispatch = (event: string, id: string | null, data: string) => {
    if (event === "board" && id !== null) {
      lastId = id;
      on.board(Number(id));
    } else if (event === "presence") on.presence(JSON.parse(data) as Presence);
    else if (event === "ended") {
      stopped = true;
      on.ended();
    }
  };

  const connect = async () => {
    if (stopped || controller) return;
    const mine = new AbortController();
    controller = mine;
    try {
      const response = await fetch(`/api/workshops/${workshopId}/stream`, {
        headers: { Accept: "text/event-stream", ...(lastId !== null ? { "Last-Event-ID": lastId } : {}) },
        credentials: "same-origin",
        cache: "no-store",
        signal: mine.signal,
      });
      if (response.status === 401) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (body?.error?.code === "session_ended") {
          stopped = true;
          on.ended();
          return;
        }
      }
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      if (isDown) {
        isDown = false;
        on.up();
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let event = "message";
      let id: string | null = null;
      let data = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, cut).replace(/\r$/, "");
          buffer = buffer.slice(cut + 1);
          if (line === "") {
            if (data || event !== "message") dispatch(event, id, data);
            event = "message";
            id = null;
            data = "";
          } else if (!line.startsWith(":")) {
            const colon = line.indexOf(":");
            const key = colon < 0 ? line : line.slice(0, colon);
            const val = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (key === "event") event = val;
            else if (key === "id") id = val;
            else if (key === "data") data = data ? `${data}\n${val}` : val;
          }
        }
      }
      throw new Error("stream closed");
    } catch {
      if (controller === mine) {
        controller = null;
        if (!stopped) drop();
      }
    }
  };

  const offline = () => drop();
  const online = () => {
    clearTimeout(retry);
    retry = 0;
    void connect();
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  void connect();

  return () => {
    stopped = true;
    controller?.abort();
    clearTimeout(retry);
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
  };
}
