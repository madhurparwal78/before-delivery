import type { CommentRecord, ExportRecord, VersionRecord } from '../api.js';
import {
  type DiagramDocument,
  type Page,
  type Role,
  type Shape,
  findPage,
  isLayerLocked,
  isLayerVisible,
  layersTopFirst,
  pagesInOrder,
  readingOrder,
  visibleShapes,
} from '../../shared/document.js';
import { type Box, boxOf, unionBox } from '../../shared/geometry.js';
import { type RoutedConnector, routePage } from '../../shared/router.js';
import type { Operation } from '../../shared/operation.js';

export interface PresencePerson {
  userId: string;
  name: string;
  role: Role;
}

export interface RemoteCursor {
  userId: string;
  name: string;
  page: string;
  x: number;
  y: number;
  drawnX: number;
  drawnY: number;
}

export interface QueuedOperation {
  opId: string;
  baseSeq: number;
  op: Operation;
}

export interface PendingOperation {
  opId: string;
  op: Operation;
  /** What to announce when the acknowledgement lands, with the count it carries. */
  announce: { kind: 'moved'; label: string } | { kind: 'none' };
  /** Labels captured when the change was sent, for the deleted and replaced notices. */
  labels: Record<string, string>;
  /** A replayed change is not announced; the saved banner covers it. */
  replayed: boolean;
  /** Runs with the server ids once the change is acknowledged. */
  onAck?: (ids: Record<string, string>) => void;
}

export type ConnectionState = 'live' | 'offline' | 'ended';

export interface DragPreview {
  /** Shapes drawn at the values the drop would commit. */
  shapes: Map<string, Box>;
  routes: Map<string, RoutedConnector>;
  portDots: { x: number; y: number }[];
}

export interface ConnectMode {
  source: string;
  candidates: string[];
  highlight: number;
  port: 'n' | 'e' | 's' | 'w' | null;
}

export interface WorkspaceState {
  diagramId: string;
  me: { id: string; email: string; name: string };
  role: Role;
  ownerName: string;
  document: DiagramDocument;
  pageId: string;
  /** A read-only preview of a version, when the address carries one. */
  preview: { version: VersionRecord; document: DiagramDocument } | null;
  selection: string[];
  focusedShape: string | null;
  snapToGrid: boolean;
  zoom: number;
  view: { x: number; y: number };
  drag: DragPreview | null;
  connect: ConnectMode | null;
  comments: CommentRecord[];
  versions: VersionRecord[];
  exports: ExportRecord[];
  presence: PresencePerson[];
  cursors: Map<string, RemoteCursor>;
  connection: ConnectionState;
  queue: QueuedOperation[];
  pending: Map<string, PendingOperation>;
  savedBanner: boolean;
  routes: Map<string, RoutedConnector>;
  leftRailOpen: boolean;
  inspectorOpen: boolean;
  openSheet: 'layers' | 'inspector' | 'comments' | 'history' | null;
  inspectorTab: 'inspector' | 'comments' | 'history';
  outlineOpen: boolean;
  commentTarget: string | null;
  exportPaused: boolean;
}

export const ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300, 400] as const;

/** The document the screen shows: the version being previewed, or the live document. */
export function shownDocument(state: WorkspaceState): DiagramDocument {
  return state.preview?.document ?? state.document;
}

const EMPTY_PAGE: Page = {
  id: '',
  name: '',
  order: 0,
  layers: [],
  shapes: [],
  connectors: [],
  groups: [],
};

export function currentPage(state: WorkspaceState): Page {
  const doc = shownDocument(state);
  return findPage(doc, state.pageId) ?? pagesInOrder(doc)[0] ?? EMPTY_PAGE;
}

export function recomputeRoutes(state: WorkspaceState): void {
  state.routes = routePage(currentPage(state));
}

export function canEditNow(state: WorkspaceState): boolean {
  return (state.role === 'owner' || state.role === 'editor') && state.preview === null;
}

export function selectedShapes(state: WorkspaceState): Shape[] {
  const page = currentPage(state);
  return state.selection
    .map((id) => page.shapes.find((shape) => shape.id === id))
    .filter((shape): shape is Shape => shape !== undefined);
}

export function selectionBox(state: WorkspaceState): Box | null {
  const shapes = selectedShapes(state);
  if (shapes.length === 0) return null;
  return unionBox(shapes.map(boxOf));
}

/** Shapes a pointer or keyboard may select: those on a visible, unlocked layer. */
export function selectableShapes(page: Page): Shape[] {
  return page.shapes.filter(
    (shape) => isLayerVisible(page, shape.layer) && !isLayerLocked(page, shape.layer),
  );
}

export function focusOrder(page: Page): Shape[] {
  return readingOrder(visibleShapes(page));
}

/** A selection that includes any group member includes every member of that group. */
export function expandGroups(page: Page, ids: readonly string[]): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    const shape = page.shapes.find((s) => s.id === id);
    if (!shape) continue;
    if (shape.group === null) {
      result.add(shape.id);
      continue;
    }
    const group = page.groups.find((g) => g.id === shape.group);
    for (const member of group?.members ?? [shape.id]) result.add(member);
  }
  return [...result];
}

/** The top visible, unlocked layer of a page, where new shapes land. */
export function insertLayer(page: Page): string | null {
  const layer = layersTopFirst(page).find((candidate) => candidate.visible && !candidate.locked);
  return layer?.id ?? null;
}

function queueKey(diagramId: string, userId: string): string {
  return `linewell.queue.${diagramId}.${userId}`;
}

/** The queue and its count survive a reload during an outage. */
export function loadQueue(diagramId: string, userId: string): QueuedOperation[] {
  try {
    const raw = window.localStorage.getItem(queueKey(diagramId, userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOperation[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(state: WorkspaceState): void {
  try {
    window.localStorage.setItem(queueKey(state.diagramId, state.me.id), JSON.stringify(state.queue));
  } catch {
    // Storage is unavailable; the queue stays in memory for this page.
  }
}

interface ExportMemory {
  requested: string[];
  announced: string[];
}

function exportKey(diagramId: string, userId: string): string {
  return `linewell.exports.${diagramId}.${userId}`;
}

export function exportMemory(diagramId: string, userId: string): ExportMemory {
  try {
    const raw = window.localStorage.getItem(exportKey(diagramId, userId));
    if (raw === null) return { requested: [], announced: [] };
    const parsed = JSON.parse(raw) as Partial<ExportMemory>;
    return { requested: parsed.requested ?? [], announced: parsed.announced ?? [] };
  } catch {
    return { requested: [], announced: [] };
  }
}

export function rememberExport(
  diagramId: string,
  userId: string,
  change: Partial<ExportMemory>,
): void {
  const memory = exportMemory(diagramId, userId);
  const next: ExportMemory = {
    requested: [...new Set([...memory.requested, ...(change.requested ?? [])])],
    announced: [...new Set([...memory.announced, ...(change.announced ?? [])])],
  };
  try {
    window.localStorage.setItem(exportKey(diagramId, userId), JSON.stringify(next));
  } catch {
    // Storage is unavailable; the announcement may repeat after a reload.
  }
}

let opCounter = 0;

export function newOpId(userId: string): string {
  opCounter += 1;
  return `${userId.slice(2, 8)}-${Date.now().toString(36)}-${opCounter}`;
}
