import type { Document, Page, Shape, Connector, Role, UserRecord } from '../shared/model.js';
import type { OperationRequest, DocumentOp, OpAcknowledgement } from '../shared/model.js';

export interface WorkspaceState {
  document: Document;
  role: Role;
  user: UserRecord;
  versionId: string | null;
}

export interface QueuedOperation {
  opId: string;
  baseSeq: number;
  op: DocumentOp;
  /** Client-side label for notices, set at enqueue time. */
  label?: string;
  kind?: 'move' | 'other';
}

export interface ApiClient {
  getDocument(diagramId: string): Promise<{ document: Document; role: Role }>;
  sendOperation(diagramId: string, request: OperationRequest): Promise<OpAcknowledgement>;
}

export interface Attrs {
  [key: string]: string | number | boolean | null | undefined | ((event: Event) => void);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'onclick') {
        node.addEventListener('click', value as (event: Event) => void);
        continue;
      }
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'text') node.textContent = String(value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | boolean | null | undefined>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  return node;
}

export const svgText = (node: SVGElement, text: string): void => {
  node.textContent = text;
};

export function cloneDocument(doc: Document): Document {
  return JSON.parse(JSON.stringify(doc)) as Document;
}
void null;

export function findPage(doc: Document, pageId: string): Page | undefined {
  return doc.pages.find((p: Page) => p.id === pageId);
}

export function findShape(doc: Document, shapeId: string): { page: Page; shape: Shape } | undefined {
  for (const page of doc.pages) {
    const shape = page.shapes.find((s: Shape) => s.id === shapeId);
    if (shape) return { page, shape };
  }
  return undefined;
}

export function findConnector(doc: Document, connectorId: string): { page: Page; connector: Connector } | undefined {
  for (const page of doc.pages) {
    const connector = page.connectors.find((c: Connector) => c.id === connectorId);
    if (connector) return { page, connector };
  }
  return undefined;
}
