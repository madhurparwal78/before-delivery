import { pool, rows } from '../db.js';
import { onConnectionClosed, onConnectionOpened, publish, type LiveConnection } from '../live.js';

/** A member leaves the list this long after their last editor stream closes, so a reload does not flicker. */
const LEAVE_DELAY_MS = 1500;

interface Editor {
  id: string;
  name: string;
  order: number;
  streams: number;
  leaving: NodeJS.Timeout | null;
}

const editorsByJob = new Map<string, Map<string, Editor>>();
let opened = 0;

/** The other admins with this job's editor open, earliest first. */
export function othersEditing(jobId: string, memberId: string): Array<{ id: string; name: string }> {
  return [...(editorsByJob.get(jobId)?.values() ?? [])]
    .filter((editor) => editor.id !== memberId && editor.leaving === null)
    .sort((a, b) => a.order - b.order)
    .map(({ id, name }) => ({ id, name }));
}

function announce(jobId: string): void {
  for (const editor of editorsByJob.get(jobId)?.values() ?? []) {
    if (editor.leaving === null) publish([editor.id], { type: 'job_presence', job_id: jobId, editing: othersEditing(jobId, editor.id) });
  }
}

async function join(connection: LiveConnection, jobId: string): Promise<void> {
  const [member] = await rows<{ name: string }>(pool, 'SELECT name FROM members WHERE id = $1', [connection.memberId]);
  if (connection.response.destroyed) return;
  const editors = editorsByJob.get(jobId) ?? new Map<string, Editor>();
  editorsByJob.set(jobId, editors);
  const existing = editors.get(connection.memberId);
  if (existing) {
    existing.streams += 1;
    if (existing.leaving) clearTimeout(existing.leaving);
    existing.leaving = null;
  } else {
    editors.set(connection.memberId, { id: connection.memberId, name: member?.name ?? '', order: opened++, streams: 1, leaving: null });
  }
  announce(jobId);
}

function leave(connection: LiveConnection, jobId: string): void {
  const editors = editorsByJob.get(jobId);
  const editor = editors?.get(connection.memberId);
  if (!editors || !editor) return;
  editor.streams -= 1;
  if (editor.streams > 0) return;
  editor.leaving = setTimeout(() => {
    editors.delete(editor.id);
    announce(jobId);
  }, LEAVE_DELAY_MS);
  editor.leaving.unref();
  announce(jobId);
}

/** Tracks which company admins have a job's editor open, from their (already authorised) editor event streams. */
export function registerEditorPresence(): void {
  onConnectionOpened((connection) => {
    if (connection.editorJobId) void join(connection, connection.editorJobId).catch((error: unknown) => console.error('presence join failed', error));
  });
  onConnectionClosed((connection) => {
    if (connection.editorJobId) leave(connection, connection.editorJobId);
  });
}
