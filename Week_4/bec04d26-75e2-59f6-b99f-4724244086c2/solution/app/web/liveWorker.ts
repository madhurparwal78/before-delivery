/**
 * The one `/api/events` stream of a signed-in user, shared by every tab of the browser profile. It lives in a
 * SharedWorker so the page itself holds no open request: the document settles once its own fetches are done.
 * Ports receive `{ kind: "message", data }` for each event, `{ kind: "reconnected" }` after a dropped stream
 * came back, and send `"stop"` when the tab signs out.
 */
interface Port {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as { onconnect: ((event: MessageEvent) => void) | null };
const ports = new Set<Port>();
/** Last clock and services event, replayed to a tab that joins an open stream (the server sends them once per connection). */
const latest = new Map<string, string>();
let source: EventSource | null = null;
let opened = false;

function broadcast(message: unknown): void {
  ports.forEach((port) => port.postMessage(message));
}

function connect(): void {
  if (source) return;
  source = new EventSource("/api/events");
  source.onmessage = (message: MessageEvent<string>) => {
    const type = (JSON.parse(message.data) as { type: string }).type;
    if (type === "clock" || type === "services") latest.set(type, message.data);
    broadcast({ kind: "message", data: message.data });
  };
  source.onopen = () => {
    if (opened) broadcast({ kind: "reconnected" });
    opened = true;
  };
}

function leave(port: Port): void {
  ports.delete(port);
  if (ports.size > 0) return;
  source?.close();
  source = null;
  opened = false;
  latest.clear();
}

scope.onconnect = (event) => {
  const port = event.ports[0] as unknown as Port;
  ports.add(port);
  port.onmessage = (message) => {
    if (message.data === "stop") leave(port);
  };
  latest.forEach((data) => port.postMessage({ kind: "message", data }));
  connect();
};
