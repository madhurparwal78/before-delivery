// Editor client state: the workspace document, connection, and selection.
import {
  BREAKPOINTS, BP_WIDTH, BP_LABEL, TYPE_LABEL,
  type WorkspaceDocument, type DocumentNode, type Page, type Breakpoint, type NodeType, type Role,
} from '../shared/domain.js';
import { computedDeclarations, declarationsToCss, focalPoint } from '../shared/style.js';

export interface Person { id: string; name: string; role: string }

export interface ThreadReply { id: string; author: { id: string; name: string }; body: string; createdAt: string }
export interface Thread {
  id: string; pageId: string; nodeId: string; nodeName: string;
  author: { id: string; name: string }; body: string; createdAt: string;
  status: 'open' | 'resolved'; replies: ThreadReply[];
}

export interface PublishStatusClient {
  state: 'not_published' | 'live' | 'live_changed' | 'unpublished';
  publishId: string | null; publishedSeq: number | null; url: string | null;
}

export interface VersionSummaryClient { id: string; name: string; author: { id: string; name: string }; createdAt: string; seq: number }

export interface ImageSummary { id: string; status: string; fileName: string; width: number; height: number }

export class EditorState {
  workspaceId = '';
  workspaceName = '';
  slug = '';
  userId = '';
  userName = '';
  role: Role = 'viewer';
  canEdit = false;
  isOwner = false;
  document: WorkspaceDocument | null = null;
  previewDocument: WorkspaceDocument | null = null;
  versionId: string | null = null;
  pageId: string | null = null;
  bp: Breakpoint = 'desktop';
  selectedNodeId: string | null = null;
  expanded = new Set<string>();
  rovingRowId: string | null = null;
  seq = 0;
  baseSeq = 0;
  people: Person[] = [];
  remoteSelections = new Map<string, string | null>();
  cursors = new Map<string, { name: string; x: number; y: number }>();
  threads: Thread[] = [];
  publish: PublishStatusClient = { state: 'not_published', publishId: null, publishedSeq: null, url: null };
  versions: VersionSummaryClient[] = [];
  images: ImageSummary[] = [];
  storageOutage = false;
  publishFailed = false;
  pendingDeleteTarget: string | null = null;
  readonly = false; // version preview

  page(): Page | null {
    const doc = this.document;
    if (!doc) return null;
    return doc.pages.find((p) => p.id === this.pageId) ?? doc.pages[0] ?? null;
  }

  shownDocument(): WorkspaceDocument | null {
    return this.previewDocument ?? this.document;
  }

  findNode(nodeId: string): DocumentNode | null {
    const page = this.page();
    if (!page) return null;
    return findInTree(page.root, nodeId);
  }

  findNodeParent(nodeId: string): { node: DocumentNode; parent: DocumentNode | null } | null {
    const page = this.page();
    if (!page) return null;
    if (page.root.id === nodeId) return { node: page.root, parent: null };
    const parent = findParentInTree(page.root, nodeId);
    if (!parent) return null;
    const node = parent.children.find((c) => c.id === nodeId);
    return node ? { node, parent } : null;
  }

  visibleRows(): { node: DocumentNode; level: number }[] {
    const page = this.page();
    if (!page) return [];
    const rows: { node: DocumentNode; level: number }[] = [];
    const walk = (node: DocumentNode, level: number) => {
      rows.push({ node, level });
      if (this.expanded.has(node.id) || node.children.length === 0) {
        if (this.expanded.has(node.id)) for (const c of node.children) walk(c, level + 1);
      }
    };
    walk(page.root, 0);
    return rows;
  }
}

export function findInTree(node: DocumentNode, nodeId: string): DocumentNode | null {
  if (node.id === nodeId) return node;
  for (const c of node.children) {
    const f = findInTree(c, nodeId);
    if (f) return f;
  }
  return null;
}

function findParentInTree(node: DocumentNode, nodeId: string): DocumentNode | null {
  for (const c of node.children) {
    if (c.id === nodeId) return node;
    const f = findParentInTree(c, nodeId);
    if (f) return f;
  }
  return null;
}

export function treeOrderNodes(page: Page): DocumentNode[] {
  const out: DocumentNode[] = [];
  const walk = (n: DocumentNode) => { out.push(n); n.children.forEach(walk); };
  walk(page.root);
  return out;
}

let opCounter = 0;
export function nextOpId(): string {
  return `c${Date.now().toString(36)}_${(opCounter++).toString(36)}`;
}
