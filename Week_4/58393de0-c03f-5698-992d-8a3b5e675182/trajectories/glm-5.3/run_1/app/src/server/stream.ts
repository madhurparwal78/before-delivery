import type { ServerResponse } from 'node:http';

export type StreamEvent =
  | { event: 'student-joined'; data: { classroomId: string; student: { id: string; nickname: string } } }
  | { event: 'student-renamed'; data: { classroomId: string; studentId: string; nickname: string } }
  | { event: 'student-removed'; data: { classroomId: string; studentId: string; nickname: string } }
  | { event: 'project-saved'; data: { projectId: string; ownerId: string; classroomId: string | null; revision: number; savedAt: string; kind: string; name: string } }
  | { event: 'project-handed-in'; data: { projectId: string; ownerId: string; classroomId: string | null } }
  | { event: 'classroom-state'; data: { classroomId: string; state: string; serverNow: string; secondsToHandIn: number } }
  | { event: 'access-ended'; data: { classroomId: string; message: string } };

export interface StreamClient {
  res: ServerResponse;
  accountId: string;
  kind: 'educator' | 'student' | 'personal';
  classroomIds: Set<string>;
}

const clients = new Set<StreamClient>();

export function openStream(res: ServerResponse, accountId: string, kind: StreamClient['kind'], classroomIds: Set<string>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const client: StreamClient = { res, accountId, kind, classroomIds: new Set(classroomIds) };
  clients.add(client);
  res.write(': connected\n\n');
  const commentTimer = setInterval(() => {
    if (clients.has(client)) {
      try { res.write(': keepalive\n\n'); } catch { unregister(client); }
    }
  }, 15000);
  res.on('close', () => {
    clearInterval(commentTimer);
    unregister(client);
  });
}

function unregister(client: StreamClient): void {
  clients.delete(client);
  try { client.res.end(); } catch { /* already closed */ }
}

export function closeForAccountClassroom(accountId: string, classroomId: string, message: string): void {
  for (const client of [...clients]) {
    if (client.accountId !== accountId || !client.classroomIds.has(classroomId)) continue;
    client.classroomIds.delete(classroomId);
    send(client, { event: 'access-ended', data: { classroomId, message } });
    if (client.kind === 'student' || client.classroomIds.size === 0) unregister(client);
  }
}

function send(client: StreamClient, ev: StreamEvent): void {
  try {
    client.res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  } catch { unregister(client); }
}

interface Audience { classroomId?: string | null; ownerId?: string }

export function broadcast(ev: StreamEvent, audience: Audience): void {
  for (const client of clients) {
    const inClassroom = audience.classroomId !== undefined && audience.classroomId !== null && client.classroomIds.has(audience.classroomId);
    const isOwner = audience.ownerId !== undefined && client.accountId === audience.ownerId;
    if (inClassroom || isOwner) send(client, ev);
  }
}
