export type Breakpoint = "desktop" | "tablet" | "phone";
export const BREAKPOINTS: readonly Breakpoint[] = ["desktop", "tablet", "phone"];
export const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };
export const FRAME_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 768, phone: 375 };

export type NodeType = "page" | "section" | "stack" | "heading" | "text" | "image" | "button" | "nav" | "collection_list";
export const NODE_TYPES: readonly NodeType[] = ["page", "section", "stack", "heading", "text", "image", "button", "nav", "collection_list"];

export const STYLE_KEYS = ["color", "background-color", "font-size", "padding", "gap", "width", "text-align", "display", "flex-direction"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

interface TokenRef {
  token: string;
}
export type StyleValue = string | TokenRef;
type StyleMap = Partial<Record<StyleKey, StyleValue>>;
export type Styles = Record<Breakpoint, StyleMap>;

export interface NodeProps {
  text?: string;
  level?: number;
  href?: string;
  imageId?: string;
  alt?: string;
  focalX?: number;
  focalY?: number;
}
export type PropKey = keyof NodeProps;
export type BindableProp = "text" | "imageId";

export interface DocNode {
  id: string;
  type: NodeType;
  name: string;
  props: NodeProps;
  styles: Styles;
  children: DocNode[];
  shared?: { componentId: string };
  bind?: Partial<Record<BindableProp, string>>;
}

export type Token =
  | { name: string; kind: "color"; value: string }
  | { name: string; kind: "size"; value: number; unit: "px" | "rem" };
export type TokenKind = Token["kind"];

export interface Page {
  id: string;
  name: string;
  slug: string;
  order: number;
  root: DocNode;
}

export interface Component {
  id: string;
  name: string;
  root: DocNode;
}

export type FieldKind = "text" | "rich_text" | "image";
export interface Field {
  name: string;
  kind: FieldKind;
}
export interface Entry {
  id: string;
  order: number;
  values: Record<string, string>;
}
export interface Collection {
  name: string;
  fields: Field[];
  entries: Entry[];
}

export interface WorkspaceDoc {
  id: string;
  name: string;
  slug: string;
  seq: number;
  tokens: Token[];
  pages: Page[];
  components: Component[];
  collection: Collection;
}

/** The document without `seq`: what a version holds and what a restore puts back. */
export type DocBody = Omit<WorkspaceDoc, "seq">;

/** The operation kinds a client may send, with their own fields (Business rules). */
export type OpFields =
  | { kind: "insert_node"; pageId: string; parentId: string; index: number; type: NodeType; props?: NodeProps; name?: string }
  | { kind: "insert_instance"; pageId: string; parentId: string; index: number; componentId: string }
  | { kind: "move_node"; nodeId: string; parentId: string; index: number }
  | { kind: "delete_node"; nodeId: string }
  | { kind: "duplicate_node"; nodeId: string }
  | { kind: "rename_node"; nodeId: string; name: string }
  | { kind: "set_prop"; nodeId: string; prop: PropKey; value: string | number }
  | { kind: "set_style"; nodeId: string; breakpoint: Breakpoint; property: StyleKey; value: StyleValue }
  | { kind: "clear_style"; nodeId: string; breakpoint: Breakpoint; property: StyleKey }
  | { kind: "set_token"; name: string; value: string | number; unit?: "px" | "rem" }
  | { kind: "rename_token"; name: string; newName: string }
  | { kind: "delete_token"; name: string }
  | { kind: "create_component"; nodeId: string; name: string }
  | { kind: "detach_instance"; nodeId: string }
  | { kind: "delete_component"; componentId: string }
  | { kind: "set_fields"; fields: Field[] }
  | { kind: "put_entry"; entryId?: string; values: Record<string, string> }
  | { kind: "move_entry"; entryId: string; index: number }
  | { kind: "delete_entry"; entryId: string }
  | { kind: "bind_prop"; nodeId: string; prop: BindableProp; field: string | null }
  | { kind: "add_page"; name: string }
  | { kind: "rename_page"; pageId: string; name: string }
  | { kind: "undo" }
  | { kind: "redo" };

export type OpKind = OpFields["kind"];
export type EditOp = Exclude<OpFields, { kind: "undo" } | { kind: "redo" }>;

/** One primitive change to the document. Every operation becomes a list of these; each has an exact inverse. */
export type Change =
  | { c: "prop"; node: string; prop: PropKey; value?: string | number }
  | { c: "style"; node: string; bp: Breakpoint; key: StyleKey; value?: StyleValue }
  | { c: "name"; node: string; name: string }
  | { c: "bind"; node: string; prop: BindableProp; field?: string }
  | { c: "shared"; node: string; componentId?: string }
  | { c: "insert"; parent: string; index: number; node: DocNode }
  | { c: "remove"; node: string }
  | { c: "move"; node: string; parent: string; index: number }
  | { c: "token"; name: string; index: number; token?: Token }
  | { c: "tokenRename"; from: string; to: string }
  | { c: "component"; id: string; index: number; component?: Component }
  | { c: "fields"; fields: Field[] }
  | { c: "entry"; id: string; index: number; values?: Record<string, string> }
  | { c: "page"; id: string; index: number; page?: Page }
  | { c: "pageName"; id: string; name: string }
  | { c: "doc"; doc: DocBody };

export type Role = "owner" | "editor" | "viewer";

export interface Person {
  id: string;
  name: string;
}

export interface Created {
  nodeId?: string;
  componentId?: string;
  entryId?: string;
  pageId?: string;
}

export interface CommentThread {
  id: string;
  pageId: string;
  nodeId: string;
  nodeName: string;
  author: Person;
  body: string;
  createdAt: string;
  status: "open" | "resolved";
  replies: { id: string; author: Person; body: string; createdAt: string }[];
}

export interface ImageRecord {
  id: string;
  status: "confirmed";
  fileName: string;
  width: number;
  height: number;
}

export interface VersionSummary {
  id: string;
  name: string;
  author: Person;
  createdAt: string;
  seq: number;
}

export type PublishState = "not_published" | "live" | "live_changed" | "unpublished";
export interface PublishStatus {
  state: PublishState;
  publishId: string | null;
  publishedSeq: number | null;
  url: string | null;
}

export interface Member {
  userId?: string;
  inviteId?: string;
  email: string;
  name?: string;
  role: Role;
  status: "active" | "invited";
}

/** Messages from the server on the live connection. */
export type ServerMessage =
  | { type: "hello"; seq: number; you: Person & { role: Role } }
  | { type: "ack"; opId: string; seq: number; created?: Created }
  | { type: "reject"; opId: string; error: { code: string; message: string } }
  | { type: "op"; seq: number; author: Person; op: Record<string, unknown> & { kind: string; opId: string | null }; changes: Change[]; created?: Created }
  | { type: "conflict"; opId: string; property: StyleKey; value: string; winner: Person }
  | { type: "presence"; people: (Person & { role: Role })[] }
  | { type: "cursor"; userId: string; name: string; pageId: string; x: number | null; y: number | null }
  | { type: "selection"; userId: string; nodeId: string | null }
  | { type: "role"; role: Role }
  | { type: "comment"; thread: CommentThread }
  | { type: "restored"; by: Person; versionName: string; seq: number };

/** Messages from the client on the live connection. */
export type ClientMessage =
  | { type: "op"; op: Record<string, unknown> }
  | { type: "cursor"; pageId: string; x: number | null; y: number | null }
  | { type: "select"; nodeId: string | null };
