import type { ClientFrame, ServerFrame } from '../../shared/types.ts';

// The one WebSocket at /ws (same origin, same port).

export interface Live {
  send: (frame: ClientFrame) => void;
  close: () => void;
}

export function connect(join: ClientFrame, onFrame: (frame: ServerFrame) => void, onClose: (code: number) => void = () => undefined): Live {
  const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
  socket.addEventListener('open', () => socket.send(JSON.stringify(join)));
  socket.addEventListener('message', (event: MessageEvent<string>) => onFrame(JSON.parse(event.data) as ServerFrame));
  socket.addEventListener('close', (event) => onClose(event.code));
  return {
    send: (frame) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)); },
    close: () => socket.close(),
  };
}
