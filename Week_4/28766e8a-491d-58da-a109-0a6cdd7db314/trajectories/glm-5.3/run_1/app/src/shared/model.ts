export type Role = 'owner' | 'editor' | 'viewer';
export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'text';
export type PortName = 'n' | 'e' | 's' | 'w';

export interface Box { x: number; y: number; w: number; h: number }

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

export interface EndBinding { shape: string; port: PortName }

export interface Connector {
  id: string;
  layer: string;
  from: EndBinding;
  to: EndBinding;
  label: string;
  route: [number, number][];
}

export interface Group { id: string; members: string[] }

export interface Page {
  id: string;
  name: string;
  order: number;
  layers: Layer[];
  shapes: Shape[];
  connectors: Connector[];
  groups: Group[];
}

export interface Document {
  id: string;
  title: string;
  seq: number;
  pages: Page[];
}

export type SetKey = 'x' | 'y' | 'w' | 'h' | 'label' | 'layer';

export interface AddShapeOp {
  kind: 'add_shape';
  page: string;
  layer: string;
  shape: { kind: ShapeKind; x: number; y: number; w: number; h: number; label: string };
  clientRef: string;
}
export interface UpdateShapeOp {
  kind: 'update_shape';
  shape: string;
  set: Partial<Record<SetKey, unknown>>;
}
export interface UpdateShapesOp {
  kind: 'update_shapes';
  shapes: { shape: string; set: Partial<Record<SetKey, unknown>> }[];
}
export interface DeleteShapeOp { kind: 'delete_shape'; shape: string }
export interface AddConnectorOp {
  kind: 'add_connector';
  page: string;
  from: { shape: string; port: PortName };
  to: { shape: string; port: PortName };
  label: string;
  clientRef: string;
}
export interface DeleteConnectorOp { kind: 'delete_connector'; connector: string }

export type DocumentOp =
  | AddShapeOp | UpdateShapeOp | UpdateShapesOp | DeleteShapeOp
  | AddConnectorOp | DeleteConnectorOp;

/** Socket-only operations; they never travel over HTTP. */
export type SocketOpKind =
  | 'add_page' | 'rename_page' | 'reorder_pages' | 'delete_page'
  | 'add_layer' | 'rename_layer' | 'reorder_layers' | 'set_layer_visible' | 'set_layer_locked'
  | 'group_shapes' | 'ungroup'
  | 'z_order' | 'duplicate' | 'undo' | 'redo' | 'restore';

export interface OperationRequest {
  opId: string;
  baseSeq: number;
  op: DocumentOp | SocketOperation;
}

export type SocketOperation = { kind: SocketOpKind; [k: string]: unknown };

export interface OpAcknowledgement {
  opId: string;
  seq: number;
  ids: Record<string, string>;
  rerouted: string[];
}

export interface CommentAuthor { id: string; name: string }

export interface CommentRecord {
  id: string;
  shape: string;
  page: string;
  author: CommentAuthor;
  text: string;
  resolved: boolean;
  anchored: boolean;
  parent: string | null;
  createdAt: string;
}

export interface InviteRecord {
  id: string;
  email: string;
  role: Role;
  status: 'emailed' | 'email_not_sent' | 'expired' | 'accepted' | 'revoked';
  expiresAt: string;
}

export interface MemberRecord {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active';
}

export interface VersionRecord {
  id: string;
  number: number;
  name: string | null;
  displayName: string;
  author: CommentAuthor;
  createdAt: string;
  seq: number;
}

export interface ExportRecord {
  id: string;
  status: 'rendering' | 'ready' | 'storage_unavailable';
  format: 'png' | 'svg';
  page: string;
  seq: number;
  requestedBy: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface UserRecord { id: string; email: string; name: string }

export const LIMITS = {
  coordinate: 20000,
  minSize: 24,
  maxSize: 2000,
  labelLength: 200,
  nameLength: 60,
  titleLength: 120,
  displayNameLength: 80,
  commentLength: 2000,
  versionNameLength: 80,
  shapesPerPage: 500,
  connectorsPerPage: 500,
  pagesPerDiagram: 20,
  layersPerPage: 10,
  updateShapesEntries: 500,
  gridSize: 8,
  arrowNudge: 8,
  clearance: 12,
  separation: 8,
  portStem: 12,
  insertWidth: 160,
  insertHeight: 80,
  insertShift: 208,
} as const;
