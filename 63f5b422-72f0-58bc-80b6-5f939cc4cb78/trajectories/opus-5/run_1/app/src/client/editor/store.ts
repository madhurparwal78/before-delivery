import { applyOp, type ApplyContext } from '../../shared/apply.js';
import { notices } from '../../shared/notices.js';
import type { Op, PublicOp } from '../../shared/ops.js';
import { findNode, findPage } from '../../shared/tree.js';
import type {
  Breakpoint,
  Entry,
  Page,
  PlinthDocument,
  PlinthNode,
  Role,
} from '../../shared/types.js';
import { announceWithToast } from '../announce.js';
import { api } from '../net.js';

export type PanelName =
  | 'none'
  | 'tokens'
  | 'collection'
  | 'images'
  | 'history'
  | 'comments'
  | 'publish'
  | 'share';

export interface Person {
  id: string;
  name: string;
  role: Role;
}

export interface ImageRecord {
  id: string;
  status: string;
  fileName: string;
  width: number;
  height: number;
}

export interface VersionSummary {
  id: string;
  name: string;
  author: { id: string; name: string };
  createdAt: string;
  seq: number;
}

export interface Thread {
  id: string;
  pageId: string;
  nodeId: string;
  nodeName: string;
  author: { id: string; name: string };
  body: string;
  createdAt: string;
  status: 'open' | 'resolved';
  replies: { id: string; author: { id: string; name: string }; body: string; createdAt: string }[];
}

export interface Member {
  userId?: string;
  inviteId?: string;
  email: string;
  name?: string;
  role: Role;
  status: 'active' | 'invited';
}

export interface PublishInfo {
  state: 'not_published' | 'live' | 'live_changed' | 'unpublished';
  publishId: string | null;
  publishedSeq: number | null;
  url: string | null;
}

export interface MotionState {
  motion: 'closed' | 'opening' | 'open' | 'closing';
  progress: number;
}

export interface EditorState {
  workspaceId: string;
  workspaceName: string;
  user: { id: string; name: string };
  role: Role;
  doc: PlinthDocument;
  previewDoc: PlinthDocument | null;
  previewVersion: VersionSummary | null;
  pageId: string;
  bp: Breakpoint;
  panel: PanelName;
  selectedId: string | null;
  collapsed: Set<string>;
  seq: number;
  presence: Person[];
  remoteSelections: Map<string, string>;
  images: ImageRecord[];
  versions: VersionSummary[];
  threads: Thread[];
  members: Member[];
  publish: PublishInfo;
  storageDown: boolean;
  fan: MotionState;
  stylePanel: MotionState;
  navigatorOpen: boolean;
  layout: 'desktop' | 'tablet' | 'phone';
  updatedFrames: Set<Breakpoint>;
  busy: { upload: boolean; publish: boolean; restore: boolean };
  publishFailed: boolean;
}

export const state: EditorState = {
  workspaceId: '',
  workspaceName: '',
  user: { id: '', name: '' },
  role: 'viewer',
  doc: {
    id: '',
    name: '',
    slug: '',
    seq: 0,
    tokens: [],
    pages: [],
    components: [],
    collection: { name: 'Entries', fields: [], entries: [] },
  },
  previewDoc: null,
  previewVersion: null,
  pageId: '',
  bp: 'desktop',
  panel: 'none',
  selectedId: null,
  collapsed: new Set<string>(),
  seq: 0,
  presence: [],
  remoteSelections: new Map<string, string>(),
  images: [],
  versions: [],
  threads: [],
  members: [],
  publish: { state: 'not_published', publishId: null, publishedSeq: null, url: null },
  storageDown: false,
  fan: { motion: 'closed', progress: 0 },
  stylePanel: { motion: 'open', progress: 1 },
  navigatorOpen: false,
  layout: 'desktop',
  updatedFrames: new Set<Breakpoint>(),
  busy: { upload: false, publish: false, restore: false },
  publishFailed: false,
};

let renderHook: () => void = () => undefined;

export function setRenderHook(hook: () => void): void {
  renderHook = hook;
}

export function render(): void {
  renderHook();
}

export function canEdit(): boolean {
  return (state.role === 'owner' || state.role === 'editor') && state.previewDoc === null;
}

export function activeDoc(): PlinthDocument {
  return state.previewDoc ?? state.doc;
}

export function currentPage(): Page | undefined {
  const doc = activeDoc();
  return findPage(doc, state.pageId) ?? doc.pages[0];
}

export function nodeById(nodeId: string | null): PlinthNode | undefined {
  if (nodeId === null) return undefined;
  return findNode(activeDoc(), nodeId)?.node;
}

export function selectedNode(): PlinthNode | undefined {
  return nodeById(state.selectedId);
}

export function orderedEntries(): Entry[] {
  return [...activeDoc().collection.entries].sort((a, b) => a.order - b.order);
}

export function syncUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('page', state.pageId);
  url.searchParams.set('bp', state.bp);
  if (state.panel === 'publish') url.searchParams.set('panel', 'publish');
  else url.searchParams.delete('panel');
  if (state.previewVersion) url.searchParams.set('version', state.previewVersion.id);
  else url.searchParams.delete('version');
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

let socket: WebSocket | undefined;
let opCounter = 0;
const clientId = Math.random().toString(36).slice(2, 10);

export interface Ack {
  seq: number;
  created: Record<string, string> | null;
  ids: string[];
  effects: Op[] | null;
}

const waiting = new Map<string, { resolve: (ack: Ack) => void; reject: (error: Error) => void }>();

export class OpRejected extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function replayIds(ids: readonly string[]): ApplyContext {
  let index = 0;
  return {
    newId: () => {
      const id = ids[index];
      index += 1;
      if (id === undefined) throw new Error('The server issued no id for this change.');
      return id;
    },
  };
}

function localContext(): ApplyContext {
  return {
    newId: () => {
      throw new Error('Ids come from the server.');
    },
  };
}

const ID_CREATING = new Set([
  'insert_node',
  'insert_instance',
  'duplicate_node',
  'add_page',
  'create_component',
]);

function createsIds(body: PublicOp): boolean {
  if (body.kind === 'put_entry') return body.entryId === undefined;
  return ID_CREATING.has(body.kind);
}

export async function reloadDocument(): Promise<void> {
  const doc = await api.get<PlinthDocument>(`/api/workspaces/${state.workspaceId}/document`);
  state.doc = doc;
  state.seq = doc.seq;
  if (!findPage(doc, state.pageId)) state.pageId = doc.pages[0]?.id ?? '';
  render();
}

function announceRejection(code: string, message: string, body: PublicOp): void {
  if (code === 'invalid_move') {
    const nodeId = 'nodeId' in body ? body.nodeId : undefined;
    const node = nodeId === undefined ? undefined : nodeById(nodeId);
    announceWithToast(notices.refusedMove(node?.name ?? 'that node'));
    return;
  }
  announceWithToast(message);
}

/** Sends one operation, applying it at once unless the server must make ids. */
export async function send(body: PublicOp): Promise<Ack> {
  opCounter += 1;
  const opId = `${clientId}-${opCounter}`;
  const baseSeq = state.seq;
  const optimistic = !createsIds(body) && body.kind !== 'undo' && body.kind !== 'redo';
  if (optimistic) {
    applyOp(state.doc, body, localContext());
    render();
  }
  const envelope = { opId, baseSeq, ...body };
  try {
    const ack = await new Promise<Ack>((resolve, reject) => {
      if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
        waiting.set(opId, { resolve, reject });
        socket.send(JSON.stringify({ type: 'op', op: envelope }));
        return;
      }
      api
        .post<{ seq: number; created?: Record<string, string> }>(
          `/api/workspaces/${state.workspaceId}/operations`,
          envelope,
        )
        .then((result) => {
          resolve({ seq: result.seq, created: result.created ?? null, ids: [], effects: null });
        })
        .catch(reject);
    });
    state.seq = Math.max(state.seq, ack.seq);
    state.doc.seq = state.seq;
    operationAccepted();
    if (!optimistic) {
      const ctx = replayIds(ack.ids);
      for (const effect of ack.effects ?? [body]) applyOp(state.doc, effect, ctx);
      repairSelection();
      render();
    }
    return ack;
  } catch (error) {
    const code = error instanceof OpRejected ? error.code : 'error';
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    await reloadDocument();
    announceRejection(code, message, body);
    throw error;
  }
}

/** A selection on a node that has gone moves to the page root. */
function repairSelection(): void {
  if (state.selectedId !== null && !findNode(state.doc, state.selectedId)) {
    state.selectedId = currentPage()?.root.id ?? null;
  }
}

function applyRemote(message: Record<string, unknown>): void {
  const seq = Number(message['seq'] ?? 0);
  const ids = (message['ids'] ?? []) as string[];
  const effects = (message['effects'] ?? null) as Op[] | null;
  const op = message['op'] as PublicOp;
  const ctx = replayIds(ids);
  for (const effect of effects ?? [op]) applyOp(state.doc, effect, ctx);
  state.seq = Math.max(state.seq, seq);
  state.doc.seq = state.seq;
  repairSelection();
  operationAccepted();
}

const acceptedHooks: (() => void)[] = [];

/** Runs after any accepted operation, mine or someone else's. */
export function onAccepted(hook: () => void): void {
  acceptedHooks.push(hook);
}

function operationAccepted(): void {
  for (const hook of acceptedHooks) hook();
}

export type LiveHandler = (message: Record<string, unknown>) => void;

const liveHandlers: LiveHandler[] = [];

export function onLive(handler: LiveHandler): void {
  liveHandlers.push(handler);
}

function handleMessage(message: Record<string, unknown>): void {
  const type = message['type'];
  if (type === 'ack') {
    const opId = String(message['opId']);
    const pending = waiting.get(opId);
    waiting.delete(opId);
    pending?.resolve({
      seq: Number(message['seq']),
      created: (message['created'] ?? null) as Record<string, string> | null,
      ids: (message['ids'] ?? []) as string[],
      effects: (message['effects'] ?? null) as Op[] | null,
    });
    return;
  }
  if (type === 'reject') {
    const opId = String(message['opId']);
    const pending = waiting.get(opId);
    waiting.delete(opId);
    const error = (message['error'] ?? {}) as { code?: string; message?: string };
    pending?.reject(
      new OpRejected(String(error.code ?? 'error'), String(error.message ?? 'Refused.')),
    );
    return;
  }
  if (type === 'op') {
    const author = (message['author'] ?? {}) as { id?: string };
    if (author.id !== state.user.id) {
      applyRemote(message);
      for (const handler of liveHandlers) handler(message);
      render();
    }
    return;
  }
  for (const handler of liveHandlers) handler(message);
}

export function connectLive(): void {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = `?workspace=${state.workspaceId}`;
  const connection = new WebSocket(url);
  socket = connection;
  connection.addEventListener('message', (event) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    handleMessage(parsed);
  });
  connection.addEventListener('close', (event) => {
    socket = undefined;
    if (event.code === 4404) window.location.assign('/');
  });
}

export function sendLive(message: Record<string, unknown>): void {
  if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function sayWithToast(text: string): void {
  announceWithToast(text);
}
