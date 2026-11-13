import { ApiFailure, del, patch, post } from '../api';
import type { NodeKind, TriggerNode } from '../../shared/types';
import { acquireLock, heldByOther, holdingCopy, releaseLock } from './locks';
import { putNode, removeNode } from './mutate';
import { refreshRoom } from './rooms';
import { EDITS_PAUSED } from './copy';
import { editor, openDialog, say } from './state';

export interface NodeForm {
  title: string;
  kind: NodeKind;
  prerequisites: string[];
  placementId: string | null;
  answer: string | null;
}

export function selectNode(id: string | null): void {
  const previous = editor.get().selectedNodeId;
  if (previous === id) return;
  if (previous) releaseLock('node', previous);
  editor.set({ selectedNodeId: id });
  if (id) void acquireLock('node', id);
}

/** N and Shift+N: step through the nodes in chain order, opening the Trigger graph sheet if it is closed. */
export function stepNode(delta: 1 | -1): void {
  const { nodes, selectedNodeId } = editor.get();
  openDialog('graph');
  if (nodes.length === 0) return;
  const index = nodes.findIndex((n) => n.id === selectedNodeId);
  const next = index < 0 ? (delta === 1 ? 0 : nodes.length - 1) : (index + delta + nodes.length) % nodes.length;
  selectNode(nodes[next]!.id);
}

export const nodeHolder = (id: string) => heldByOther('node', id);

type Fields = Record<string, string>;

function refused(error: unknown): Fields {
  if (!(error instanceof ApiFailure)) throw error;
  if (error.code === 'playtest_running') say(EDITS_PAUSED);
  else if (error.code === 'locked') say(holdingCopy('node', error.body.holder as { userId: string; displayName: string }));
  else if (error.code === 'stale_version') {
    say('Someone saved a newer change. Your view has been refreshed.');
    putNode(error.body.current as TriggerNode);
  }
  return error.fieldErrors;
}

export async function addNode(): Promise<void> {
  const { roomId } = editor.get();
  try {
    const { node } = await post<{ node: TriggerNode }>(`/api/rooms/${roomId}/nodes`, { title: 'New puzzle', kind: 'puzzle', prerequisites: [], answer: null, placementId: null });
    putNode(node);
    await refreshRoom();
    selectNode(node.id);
  } catch (error) {
    refused(error);
  }
}

export async function saveNode(node: TriggerNode, form: NodeForm): Promise<Fields> {
  const { roomId } = editor.get();
  try {
    const { node: saved } = await patch<{ node: TriggerNode }>(`/api/rooms/${roomId}/nodes/${node.id}`, { version: node.version, ...form });
    putNode(saved);
    await refreshRoom();
    return {};
  } catch (error) {
    return refused(error);
  }
}

export async function deleteNode(node: TriggerNode): Promise<void> {
  const { roomId } = editor.get();
  try {
    releaseLock('node', node.id);
    await del(`/api/rooms/${roomId}/nodes/${node.id}`);
    removeNode(node.id);
    await refreshRoom();
  } catch (error) {
    refused(error);
  }
}
