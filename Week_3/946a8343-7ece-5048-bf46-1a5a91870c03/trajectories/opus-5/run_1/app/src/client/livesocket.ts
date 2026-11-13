import { state, syncMainAttributes } from './state';

export type LiveMessage = { seq: number; type: string; data: Record<string, unknown> };

type Handler = (message: LiveMessage) => void;

let socket: WebSocket | null = null;
let currentProject: number | null = null;
let handler: Handler = () => undefined;

export function onLive(next: Handler): void {
  handler = next;
}

export function connect(projectId: number): void {
  if (currentProject === projectId && socket !== null && socket.readyState <= 1) return;
  disconnect();
  currentProject = projectId;
  void fetch(`/api/projects/${projectId}/live_seq`)
    .then(async (response) => (response.ok ? ((await response.json()) as { seq: number }) : null))
    .then((body) => {
      if (body === null) return;
      state.seq = Math.max(state.seq, body.seq);
      syncMainAttributes();
    })
    .catch(() => undefined);
  open(projectId);
}

function open(projectId: number): void {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const since = state.seq > 0 ? `&since=${state.seq}` : '';
  const connection = new WebSocket(`${protocol}://${window.location.host}/api/live?project=${projectId}${since}`);
  socket = connection;
  connection.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as LiveMessage | { type: 'resync' };
    if (message.type === 'resync') {
      handler({ seq: state.seq, type: 'resync', data: {} });
      return;
    }
    const full = message as LiveMessage;
    state.seq = Math.max(state.seq, full.seq);
    syncMainAttributes();
    handler(full);
  });
  connection.addEventListener('close', () => {
    if (currentProject !== projectId) return;
    window.setTimeout(() => {
      if (currentProject === projectId) open(projectId);
    }, 500);
  });
}

export function disconnect(): void {
  currentProject = null;
  if (socket !== null) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}
