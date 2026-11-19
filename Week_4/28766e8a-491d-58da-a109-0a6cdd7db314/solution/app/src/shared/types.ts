// The document format and the operations, as published in the brief (API, Document format).

export type Point = [number, number];
export type Port = "n" | "e" | "s" | "w";
export type ShapeKind = "rectangle" | "ellipse" | "diamond" | "text";
export type Role = "owner" | "editor" | "viewer";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  id: string;
  name: string;
  order: number;
  visible: boolean;
  locked: boolean;
}

export interface Shape extends Box {
  id: string;
  kind: ShapeKind;
  layer: string;
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

export interface ShapeFields {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string;
  layer?: string;
}

export interface ShapeUpdate {
  shape: string;
  set: ShapeFields;
}

export type Op =
  | { kind: "add_shape"; page: string; layer: string; shape: { kind: ShapeKind; x: number; y: number; w: number; h: number; label: string }; clientRef: string }
  | { kind: "update_shape"; shape: string; set: ShapeFields }
  | { kind: "update_shapes"; shapes: ShapeUpdate[] }
  | { kind: "delete_shape"; shape: string }
  | { kind: "add_connector"; page: string; from: ConnectorEnd; to: ConnectorEnd; label: string; clientRef: string }
  | { kind: "delete_connector"; connector: string }
  | { kind: "add_page"; name: string; clientRef: string }
  | { kind: "update_page"; page: string; name: string }
  | { kind: "move_page"; page: string; index: number }
  | { kind: "delete_page"; page: string }
  | { kind: "add_layer"; page: string; name: string; clientRef: string }
  | { kind: "update_layer"; layer: string; set: { name?: string; visible?: boolean; locked?: boolean } }
  | { kind: "move_layer"; layer: string; index: number }
  | { kind: "group"; shapes: string[]; clientRef: string }
  | { kind: "ungroup"; group: string }
  | { kind: "set_z"; shape: string; direction: "forward" | "backward" }
  | { kind: "batch"; ops: Op[] }
  | { kind: "undo"; seq: number }
  | { kind: "restore"; version: string };


/** One object's state before and after an operation; `null` means absent. */
export interface Change {
  key: string;
  before: FlatRecord | null;
  after: FlatRecord | null;
}

type FlatValue = string | number | boolean | null | string[] | ConnectorEnd;
export type FlatRecord = Record<string, FlatValue>;

export interface OperationResult {
  opId: string;
  seq: number;
  ids: Record<string, string>;
  rerouted: string[];
}

export type InviteStatus = "emailed" | "email_not_sent" | "expired";
export type ExportStatus = "rendering" | "ready" | "storage_unavailable";
export type ExportFormat = "png" | "svg";

export interface UserView {
  id: string;
  email: string;
  name: string;
}

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: "active";
}

export interface InviteView {
  id: string;
  email: string;
  role: "editor" | "viewer";
  status: InviteStatus;
  expiresAt: string;
}

export interface CommentView {
  id: string;
  shape: string;
  page: string;
  author: { id: string; name: string };
  text: string;
  resolved: boolean;
  anchored: boolean;
  parent: string | null;
  createdAt: string;
}

export interface VersionView {
  id: string;
  number: number;
  name: string | null;
  displayName: string;
  author: { id: string; name: string };
  createdAt: string;
  seq: number;
}

export interface ExportView {
  id: string;
  status: ExportStatus;
  format: ExportFormat;
  page: string;
  seq: number;
  requestedBy: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface DiagramSummary {
  id: string;
  title: string;
  role: Role;
  updatedAt: string;
}

export interface PresencePerson {
  userId: string;
  name: string;
  role: Role;
}

/** Messages the server sends over the live socket. */
export type ServerMessage =
  | { type: "hello"; document: DiagramDocument; role: Role; ownerName: string; presence: PresencePerson[] }
  | { type: "ack"; opId: string; seq: number; ids: Record<string, string>; rerouted: string[]; changes: Change[]; routes: Record<string, Point[]>; author: { id: string; name: string }; restored: string | null }
  | { type: "refused"; opId: string; status: number; error: { code: string; message: string; fields?: Record<string, string> } }
  | { type: "op"; opId: string; seq: number; changes: Change[]; routes: Record<string, Point[]>; author: { id: string; name: string }; replaced: string[]; label: string; restored: string | null }
  | { type: "presence"; people: PresencePerson[] }
  | { type: "joined"; name: string }
  | { type: "cursor"; userId: string; name: string; page: string; x: number; y: number }
  | { type: "cursor_gone"; userId: string }
  | { type: "role"; role: Role }
  | { type: "comments" }
  | { type: "versions" }
  | { type: "members" }
  | { type: "export"; export: ExportView };
