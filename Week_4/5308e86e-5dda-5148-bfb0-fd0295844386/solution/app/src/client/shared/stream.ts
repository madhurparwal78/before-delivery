/** The live transaction stream: one connection, reconnecting by itself with the last event id it saw. */
import { ending, onSessionEnd, revoke, storedToken } from "./session.js";

const RECONNECT_MS = 2_000;
/** The first connection waits until the page has settled, so loading a page never leaves a request open. */
const FIRST_CONNECT_MS = 1_500;

interface StreamEvents {
  onTransaction: (row: Record<string, any>) => void;
  /** The stream is connected again after having been lost. */
  onReconnected: () => void;
}

export function openStream(handlers: StreamEvents): void {
  let lastEventId: string | null = null;
  // The first connection counts as one made after a gap: the refresh it triggers covers anything created before it opened.
  let lost = true;
  let controller: AbortController | null = null;
  let timer = 0;

  async function connect(): Promise<void> {
    if (ending.ended) return;
    controller = new AbortController();
    const params = new URLSearchParams({ token: storedToken() ?? "" });
    if (lastEventId) params.set("last_event_id", lastEventId);
    try {
      const response = await fetch(`/api/stream?${params}`, { signal: controller.signal, cache: "no-store" });
      if (ending.ended) return;
      if (response.status === 401) {
        revoke();
        return;
      }
      if (!response.ok || !response.body) throw new Error("stream unavailable");
      if (lost) handlers.onReconnected();
      lost = false;
      await read(response.body.getReader());
    } catch {
      // Falls through to the reconnect below.
    }
    if (ending.ended) return;
    lost = true;
    timer = window.setTimeout(connect, RECONNECT_MS);
  }

  async function read(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done || ending.ended) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        deliver(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  function deliver(block: string): void {
    let id = "";
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event !== "transaction" || data === "") return;
    if (id) lastEventId = id;
    handlers.onTransaction(JSON.parse(data));
  }

  onSessionEnd(() => {
    window.clearTimeout(timer);
    controller?.abort();
  });
  timer = window.setTimeout(connect, FIRST_CONNECT_MS);
}
