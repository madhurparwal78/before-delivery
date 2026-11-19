import type { ServerResponse } from 'node:http';
import type { ClassroomState, StreamEventName, StreamEvents } from '../shared/types.js';
import { CLASSROOM_COLUMNS, classroomState, secondsToHandIn, type ClassroomRow } from './classrooms.js';
import { query } from './db.js';
import { serverNowMs } from './clock.js';

interface Connection {
  id: number;
  res: ServerResponse;
  accountId: string;
  kind: 'educator' | 'personal' | 'student';
  classroomIds: Set<string>;
}

const connections = new Map<number, Connection>();
let nextId = 1;

export const openStream = (
  res: ServerResponse,
  account: { id: string; kind: 'educator' | 'personal' | 'student' },
  classroomIds: string[],
): void => {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': quarkyard stream open\n\n');
  const connection: Connection = {
    id: nextId,
    res,
    accountId: account.id,
    kind: account.kind,
    classroomIds: new Set(classroomIds),
  };
  nextId += 1;
  connections.set(connection.id, connection);
  res.on('close', () => {
    connections.delete(connection.id);
  });
};

const write = <E extends StreamEventName>(connection: Connection, event: E, data: StreamEvents[E]): void => {
  connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const send = <E extends StreamEventName>(
  event: E,
  data: StreamEvents[E],
  wants: (connection: Connection) => boolean,
): void => {
  for (const connection of connections.values()) {
    if (wants(connection)) write(connection, event, data);
  }
};

/** Educators of the classroom. */
const educatorsOfClassroom = (classroomId: string) => (connection: Connection): boolean =>
  connection.kind === 'educator' && connection.classroomIds.has(classroomId);

export const emitStudentJoined = (classroomId: string, student: { id: string; nickname: string }): void => {
  send('student-joined', { classroomId, student }, educatorsOfClassroom(classroomId));
};

export const emitStudentRenamed = (classroomId: string, studentId: string, nickname: string): void => {
  send('student-renamed', { classroomId, studentId, nickname }, educatorsOfClassroom(classroomId));
};

export const emitStudentRemoved = (classroomId: string, studentId: string, nickname: string): void => {
  send('student-removed', { classroomId, studentId, nickname }, educatorsOfClassroom(classroomId));
};

export const emitProjectSaved = (data: StreamEvents['project-saved']): void => {
  send(
    'project-saved',
    data,
    (connection) =>
      connection.accountId === data.ownerId ||
      (data.classroomId !== null && educatorsOfClassroom(data.classroomId)(connection)),
  );
};

export const emitProjectHandedIn = (data: StreamEvents['project-handed-in']): void => {
  send(
    'project-handed-in',
    data,
    (connection) => connection.accountId === data.ownerId || educatorsOfClassroom(data.classroomId)(connection),
  );
};

export const emitClassroomState = (row: ClassroomRow): void => {
  const nowMs = serverNowMs();
  const data: StreamEvents['classroom-state'] = {
    classroomId: row.id,
    state: classroomState(row, nowMs),
    serverNow: new Date(nowMs).toISOString(),
    secondsToHandIn: secondsToHandIn(row, nowMs),
  };
  lastKnownState.set(row.id, data.state);
  send('classroom-state', data, (connection) => connection.classroomIds.has(row.id));
};

export const emitAccessEnded = (accountId: string, classroomId: string, message: string): void => {
  for (const connection of [...connections.values()]) {
    if (connection.accountId !== accountId || !connection.classroomIds.has(classroomId)) continue;
    write(connection, 'access-ended', { classroomId, message });
    connection.res.end();
    connections.delete(connection.id);
  }
};

export const emitAllClassroomStates = async (): Promise<void> => {
  const rows = await query<ClassroomRow>(`select ${CLASSROOM_COLUMNS} from classrooms`);
  for (const row of rows) emitClassroomState(row);
};

const lastKnownState = new Map<string, ClassroomState>();
let sinceHeartbeat = 0;

const tick = async (): Promise<void> => {
  if (connections.size === 0) {
    lastKnownState.clear();
    return;
  }
  const watched = new Set<string>();
  for (const connection of connections.values()) {
    for (const id of connection.classroomIds) watched.add(id);
  }
  if (watched.size === 0) return;
  const rows = await query<ClassroomRow>(
    `select ${CLASSROOM_COLUMNS} from classrooms where id = any($1::uuid[])`,
    [[...watched]],
  );
  sinceHeartbeat += 5;
  const heartbeat = sinceHeartbeat >= 30;
  if (heartbeat) sinceHeartbeat = 0;
  for (const row of rows) {
    const state = classroomState(row);
    if (lastKnownState.get(row.id) !== state) {
      emitClassroomState(row);
    } else if (heartbeat && state !== 'archived') {
      emitClassroomState(row);
    }
  }
};

/** Re-checks every watched classroom's state at least once every 5 seconds. */
export const startStreamClock = (): void => {
  setInterval(() => {
    void tick().catch(() => undefined);
  }, 5000).unref();
  setInterval(() => {
    for (const connection of connections.values()) connection.res.write(': keep-alive\n\n');
  }, 15000).unref();
};
