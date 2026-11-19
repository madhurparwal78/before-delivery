export type LiveMessage = Record<string, unknown> & { kind: string };

/** The one same-origin live stream; handlers run inside the message handler. */
export function connectLive(handle: (message: LiveMessage) => void): EventSource {
  const stream = new EventSource('/api/live');
  stream.onmessage = (event) => {
    handle(JSON.parse(event.data) as LiveMessage);
  };
  return stream;
}
