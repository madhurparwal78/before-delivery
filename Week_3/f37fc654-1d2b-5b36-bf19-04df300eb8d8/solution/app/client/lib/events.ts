// The signed-in user's server-sent events, read over fetch so they share the session cookie.
type Handler = (event: string, data: Record<string, unknown>) => void;

const handlers = new Set<Handler>();
let running = false;

export function onEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

async function connect(): Promise<void> {
  const response = await fetch("/api/events", { credentials: "same-origin", headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let at: number;
    while ((at = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) handlers.forEach((h) => h(event, JSON.parse(data) as Record<string, unknown>));
    }
  }
}

export function startEvents(): void {
  if (running) return;
  running = true;
  const loop = (): void => {
    connect().catch(() => undefined).finally(() => setTimeout(loop, 3000));
  };
  loop();
}
