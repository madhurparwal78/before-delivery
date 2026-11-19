import type { WebSocket } from 'ws';
import { db, newId } from './db.js';
import { loadAccessView, type AccessView } from './domain/access.js';
import { serializeContext, serializeFile, serializeFolder, type SerializeContext } from './domain/serialize.js';
import { storageTotals } from './domain/storageTotals.js';
import { clockBody } from './domain/clock.js';
import { serviceStatus } from './services/health.js';
import type { FileRow, FolderRow } from './domain/rows.js';
import * as copy from '../shared/copy.js';
import type { NoticeKind, Person, PersonRef, ServerEvent } from '../shared/types.js';

interface Connection {
  person: Person;
  socket: WebSocket;
}

const connections = new Set<Connection>();

export const addConnection = (person: Person, socket: WebSocket): (() => void) => {
  const connection: Connection = { person, socket };
  connections.add(connection);
  return () => connections.delete(connection);
};

const send = (connection: Connection, event: ServerEvent): void => {
  if (connection.socket.readyState === connection.socket.OPEN) {
    connection.socket.send(JSON.stringify(event));
  }
};

export const sendToPerson = (personId: string, event: ServerEvent): void => {
  for (const connection of connections) {
    if (connection.person.id === personId) send(connection, event);
  }
};

export const broadcastStatus = (): void => {
  const event: ServerEvent = { type: 'status', data: serviceStatus() };
  for (const connection of connections) send(connection, event);
};

export const broadcastClock = (): void => {
  const event: ServerEvent = { type: 'clock', data: clockBody() };
  for (const connection of connections) send(connection, event);
};

/** The people with at least one open screen, each once. */
const listeningPeople = (): Person[] => {
  const seen = new Map<string, Person>();
  for (const connection of connections) seen.set(connection.person.id, connection.person);
  return [...seen.values()];
};

export type EventBuilder = (
  view: AccessView,
  context: SerializeContext,
) => ServerEvent[] | Promise<ServerEvent[]>;

/** Works out, for each person with an open screen, which messages they may see. */
export const publish = async (build: EventBuilder): Promise<void> => {
  const people = listeningPeople();
  await Promise.all(
    people.map(async (person) => {
      const view = await loadAccessView(person, db);
      const context = await serializeContext(view, db);
      const events = await build(view, context);
      for (const event of events) sendToPerson(person.id, event);
    }),
  );
};

const visibleCounts = (
  view: AccessView,
  counts: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [folderId, value] of Object.entries(counts)) {
    if (view.folderAccess(folderId) !== null) out[folderId] = value;
  }
  return out;
};

export const publishFileCreated = async (
  file: FileRow,
  counts: Record<string, number>,
): Promise<void> => {
  await publish((view, context) => {
    const events: ServerEvent[] = [];
    if (view.fileAccess(file) !== null) {
      events.push({
        type: 'file_created',
        data: { file: serializeFile(context, file), folderCounts: visibleCounts(view, counts) },
      });
    }
    if (view.isStaff) events.push({ type: 'bin_changed', data: {} });
    return events;
  });
  await publishStorage();
};

export const publishFileUpdated = async (file: FileRow): Promise<void> => {
  await publish((view, context) =>
    view.fileAccess(file) === null
      ? []
      : [{ type: 'file_updated', data: { file: serializeFile(context, file) } }],
  );
};

export const publishFolderCreated = async (folder: FolderRow): Promise<void> => {
  await publish((view, context) =>
    view.folderAccess(folder.id) === null
      ? []
      : [{ type: 'folder_created', data: { folder: serializeFolder(context, folder) } }],
  );
};

export const publishFolderUpdated = async (folderId: string): Promise<void> => {
  await publish((view, context) => {
    const folder = view.folder(folderId);
    if (folder === null || view.folderAccess(folderId) === null) return [];
    return [{ type: 'folder_updated', data: { folder: serializeFolder(context, folder) } }];
  });
};

export const publishStorage = async (): Promise<void> => {
  const totals = await storageTotals();
  await publish((view) => (view.isStaff ? [{ type: 'storage', data: totals }] : []));
};

export const publishMoved = async (
  actor: PersonRef,
  toFolderId: string,
  movedFiles: { file: FileRow; fromFolderId: string }[],
  counts: Record<string, number>,
): Promise<void> => {
  await publish((view, context) => {
    const items = movedFiles
      .map((entry) => {
        const sourceVisible = view.folderAccess(entry.fromFolderId) !== null;
        const nowVisible = view.fileAccess(entry.file) !== null;
        if (!sourceVisible && !nowVisible) return null;
        return {
          fileId: entry.file.id,
          fromFolderId: sourceVisible ? entry.fromFolderId : null,
          file: nowVisible ? serializeFile(context, entry.file) : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return [];
    return [
      {
        type: 'moved',
        data: {
          toFolder: view.folderRef(toFolderId),
          actor,
          items,
          folderCounts: visibleCounts(view, counts),
        },
      },
    ];
  });
};

export const publishFilesRemoved = async (
  fileIds: string[],
  counts: Record<string, number>,
  concerned: { personId: string; itemName: string }[] = [],
): Promise<void> => {
  await publish((view) => {
    const events: ServerEvent[] = [
      { type: 'files_removed', data: { fileIds, folderCounts: visibleCounts(view, counts) } },
    ];
    if (view.isStaff) events.push({ type: 'bin_changed', data: {} });
    else events.push({ type: 'access_changed', data: {} });
    return events;
  });
  for (const entry of concerned) pushNotice(entry.personId, 'gone', entry.itemName);
  await publishStorage();
};

export const publishBinChanged = async (): Promise<void> => {
  await publish((view) => (view.isStaff ? [{ type: 'bin_changed', data: {} }] : []));
};

export const publishHandovers = async (): Promise<void> => {
  await publish((view) => (view.isStaff ? [{ type: 'handovers_changed', data: {} }] : []));
};

export const publishPolicies = async (): Promise<void> => {
  await publish((view) => (view.isStaff ? [{ type: 'policies_changed', data: {} }] : []));
};

export const publishGrantsChanged = async (
  itemType: 'folder' | 'file',
  itemId: string,
): Promise<void> => {
  await publish((view) =>
    view.isStaff ? [{ type: 'grants_changed', data: { itemType, itemId } }] : [],
  );
};

export const publishAccessChanged = (personId: string): void => {
  sendToPerson(personId, { type: 'access_changed', data: {} });
};

const noticeText = (kind: NoticeKind, ...parts: string[]): string => {
  const [first = '', second = ''] = parts;
  switch (kind) {
    case 'grant_ended':
      return copy.noticeGrantEnded(first, second);
    case 'grant_ended_fallback':
      return copy.noticeGrantEndedFallback(first, second);
    case 'lowered':
      return copy.noticeLowered(first);
    case 'removed':
      return copy.noticeRemoved(first);
    case 'write_forbidden':
      return copy.noticeWriteForbidden(first);
    case 'gone':
      return copy.noticeGone(first);
    case 'handover_accepted':
      return copy.noticeHandoverAccepted(first, second);
    case 'handover_declined':
      return copy.noticeHandoverDeclined(first, second);
    case 'handover_lapsed':
      return copy.noticeHandoverLapsed(first, second);
  }
};

export const pushNotice = (personId: string, kind: NoticeKind, ...parts: string[]): void => {
  sendToPerson(personId, {
    type: 'notice',
    data: { id: newId(), kind, text: noticeText(kind, ...parts) },
  });
};

export const pushUploadExpired = (
  personId: string,
  uploadId: string,
  name: string,
): void => {
  sendToPerson(personId, { type: 'upload_expired', data: { uploadId, name } });
};
