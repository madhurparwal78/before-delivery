export type Point = readonly [number, number];

export type Port = 'n' | 'e' | 's' | 'w';
export const PORTS: readonly Port[] = ['n', 'e', 's', 'w'];

export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'text';
export const SHAPE_KINDS: readonly ShapeKind[] = ['rectangle', 'ellipse', 'diamond', 'text'];

export type Role = 'owner' | 'editor' | 'viewer';

export interface Layer {
  id: string;
  name: string;
  order: number;
  visible: boolean;
  locked: boolean;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  layer: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  z: number;
  group: string | null;
}

export interface ConnectorEnd {
  shape: string;
  port: Port;
}

export interface Connector {
  id: string;
  layer: string;
  from: ConnectorEnd;
  to: ConnectorEnd;
  label: string;
  route: Point[];
}

export interface Group {
  id: string;
  members: string[];
}

export interface Page {
  id: string;
  name: string;
  order: number;
  layers: Layer[];
  shapes: Shape[];
  connectors: Connector[];
  groups: Group[];
}

export interface DiagramDocument {
  id: string;
  title: string;
  seq: number;
  pages: Page[];
}

/** Document limits. Breaking any of these is a 422 `invalid`. */
export const LIMITS = {
  coordMin: -20000,
  coordMax: 20000,
  sizeMin: 24,
  sizeMax: 2000,
  shapesPerPage: 500,
  connectorsPerPage: 500,
  pagesPerDiagram: 20,
  layersPerPage: 10,
  labelMax: 200,
  nameMin: 1,
  nameMax: 60,
  titleMin: 1,
  titleMax: 120,
  displayNameMax: 80,
  commentMax: 2000,
  versionNameMax: 80,
} as const;

export const GRID = 8;
export const INSERT_W = 160;
export const INSERT_H = 80;
export const INSERT_STEP = 208;
export const DUPLICATE_OFFSET = 24;

export function findPage(doc: DiagramDocument, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function pagesInOrder(doc: DiagramDocument): Page[] {
  return [...doc.pages].sort((a, b) => a.order - b.order);
}

/** Layers bottom first (`order` 0 is the bottom layer). */
export function layersBottomFirst(page: Page): Layer[] {
  return [...page.layers].sort((a, b) => a.order - b.order);
}

/** Layers as the layers rail lists them: top layer first. */
export function layersTopFirst(page: Page): Layer[] {
  return [...page.layers].sort((a, b) => b.order - a.order);
}

export function findShape(page: Page, shapeId: string): Shape | undefined {
  return page.shapes.find((s) => s.id === shapeId);
}

export function findLayer(page: Page, layerId: string): Layer | undefined {
  return page.layers.find((l) => l.id === layerId);
}

export function pageOfShape(doc: DiagramDocument, shapeId: string): Page | undefined {
  return doc.pages.find((p) => p.shapes.some((s) => s.id === shapeId));
}

export function pageOfLayer(doc: DiagramDocument, layerId: string): Page | undefined {
  return doc.pages.find((p) => p.layers.some((l) => l.id === layerId));
}

export function pageOfConnector(doc: DiagramDocument, connectorId: string): Page | undefined {
  return doc.pages.find((p) => p.connectors.some((c) => c.id === connectorId));
}

export function isLayerVisible(page: Page, layerId: string): boolean {
  return findLayer(page, layerId)?.visible === true;
}

export function isLayerLocked(page: Page, layerId: string): boolean {
  return findLayer(page, layerId)?.locked === true;
}

/** Shapes drawn on the canvas: those on a visible layer. */
export function visibleShapes(page: Page): Shape[] {
  return page.shapes.filter((s) => isLayerVisible(page, s.layer));
}

/**
 * A connector is shown, routed against and exported only when its own layer and
 * both end shapes' layers are visible.
 */
export function isConnectorShown(page: Page, connector: Connector): boolean {
  if (!isLayerVisible(page, connector.layer)) return false;
  const from = findShape(page, connector.from.shape);
  const to = findShape(page, connector.to.shape);
  if (!from || !to) return false;
  return isLayerVisible(page, from.layer) && isLayerVisible(page, to.layer);
}

export function shownConnectors(page: Page): Connector[] {
  return page.connectors.filter((c) => isConnectorShown(page, c));
}

/** Reading order: by top edge, then left edge, then id. */
export function readingOrder(shapes: readonly Shape[]): Shape[] {
  return [...shapes].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A shape with an empty label is named `Untitled <kind>`. */
export function shapeLabel(shape: Shape): string {
  return shape.label.length > 0 ? shape.label : `Untitled ${shape.kind}`;
}

export function groupOf(page: Page, groupId: string): Group | undefined {
  return page.groups.find((g) => g.id === groupId);
}
