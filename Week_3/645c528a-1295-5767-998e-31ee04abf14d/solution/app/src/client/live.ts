/** The one WebSocket to the server. Screens name topics; the server pushes balances, turns, clocks and counts. */
type Handler<Message> = (message: Message) => void;

const RECONNECT_MS = 1000;
const handlers = new Map<string, Set<Handler<never>>>();
let socket: WebSocket | null = null;
let wanted = false;

const SERVER_TOPIC = /^(table|tournament|tournaments|club)/;

function sendTopics(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ topics: [...handlers.keys()].filter((topic) => SERVER_TOPIC.test(topic)) }));
  }
}

function open(): void {
  if (socket !== null || !wanted) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const next = new WebSocket(`${scheme}//${location.host}/live`);
  socket = next;
  next.onopen = sendTopics;
  next.onmessage = (event) => {
    const { topic } = JSON.parse(String(event.data)) as { topic: string };
    handlers.get(topic)?.forEach((handler) => handler(JSON.parse(String(event.data)) as never));
  };
  next.onclose = () => {
    socket = null;
    if (wanted) setTimeout(open, RECONNECT_MS);
  };
}

export function connectLive(): void {
  wanted = true;
  open();
}

export function disconnectLive(): void {
  wanted = false;
  socket?.close();
}

export function subscribe<Message = Record<string, unknown>>(topic: string, handler: Handler<Message>): () => void {
  const set: Set<Handler<never>> = handlers.get(topic) ?? new Set();
  const added = set.size === 0;
  set.add(handler);
  handlers.set(topic, set);
  if (added) sendTopics();
  return () => {
    set.delete(handler);
    if (set.size === 0) {
      handlers.delete(topic);
      sendTopics();
    }
  };
}
