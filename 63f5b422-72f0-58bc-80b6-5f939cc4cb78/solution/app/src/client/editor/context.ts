import { createContext, useContext } from "react";
import type { KeyMove } from "../../shared/tree.js";
import type {
  BindableProp,
  Breakpoint,
  CommentThread,
  Field,
  ImageRecord,
  Member,
  NodeType,
  Page,
  PropKey,
  PublishStatus,
  Role,
  StyleKey,
  StyleValue,
  VersionSummary,
  WorkspaceDoc,
} from "../../shared/types.js";
import type { MotionState } from "../ui/motion.js";
import type { Sync } from "./sync.js";

export type Panel = "tokens" | "collection" | "images" | "history" | "comments" | "publish";
export type Layout = "desktop" | "tablet" | "phone";
export type PhoneSheet = "comments" | "pages" | "publish" | null;

export type DialogState =
  | { kind: "delete"; nodeId: string; name: string }
  | { kind: "component"; nodeId: string; name: string }
  | { kind: "saveVersion" }
  | { kind: "restore" }
  | { kind: "publish" }
  | { kind: "share" }
  | { kind: "placeImage"; parentId: string; index: number }
  | { kind: "addPage" }
  | null;

export interface Slot {
  parentId: string;
  index: number;
}

export type Dragged = { kind: "type"; type: NodeType } | { kind: "component"; componentId: string } | { kind: "node"; nodeId: string };

export interface DragState {
  dragged: Dragged;
  slot: Slot | null;
  box: { left: number; top: number; width: number } | null;
}

export interface EditorState {
  workspaceId: string;
  doc: WorkspaceDoc;
  page: Page;
  bp: Breakpoint;
  layout: Layout;
  role: Role;
  meId: string;
  ownerName: string;
  readOnly: boolean;
  preview: { id: string; name: string } | null;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  focusRowId: string | null;
  renamingId: string | null;
  panel: Panel | null;
  menuOpen: boolean;
  dialog: DialogState;
  drawerOpen: boolean;
  stylePanelOpen: boolean;
  fan: MotionState;
  updatedTags: ReadonlySet<Breakpoint>;
  storageDown: boolean;
  busy: { publish: boolean; upload: boolean; restore: boolean };
  publishFailed: boolean;
  publishStatus: PublishStatus | null;
  threads: CommentThread[];
  images: ImageRecord[];
  versions: VersionSummary[] | null;
  members: Member[];
  phoneSheet: PhoneSheet;
  drag: DragState | null;
  composerFor: number;
}

export interface EditorActions {
  select(id: string | null, options?: { fromCanvas?: boolean }): void;
  setPage(id: string): void;
  setBp(bp: Breakpoint, options?: { focusFrame?: boolean }): void;
  openPanel(panel: Panel, options?: { focusComposer?: boolean }): void;
  closePanel(): void;
  openMenu(): void;
  closeMenu(): void;
  insert(dragged: Exclude<Dragged, { kind: "node" }>, slot?: Slot | null): void;
  drop(dragged: Dragged, slot: Slot): void;
  keyMove(nodeId: string, move: KeyMove): void;
  startRename(id: string): void;
  commitRename(id: string, name: string): void;
  cancelRename(id: string): void;
  requestDelete(id: string): void;
  confirmDelete(id: string): void;
  duplicate(id: string): void;
  setStyle(nodeId: string, key: StyleKey, value: StyleValue): void;
  clearStyle(nodeId: string, key: StyleKey): void;
  setProp(nodeId: string, prop: PropKey, value: string | number): void;
  bind(nodeId: string, prop: BindableProp, field: string | null): void;
  createComponent(nodeId: string, name: string): void;
  detach(nodeId: string): void;
  placeImage(parentId: string, index: number, imageId: string, alt: string): void;
  toggleFan(): void;
  toggleStylePanel(): void;
  toggleDrawer(open?: boolean): void;
  setCollapsed(id: string, collapsed: boolean): void;
  setFocusRow(id: string): void;
  focusRow(id: string | null): void;
  openDialog(dialog: Exclude<DialogState, null>): void;
  closeDialog(): void;
  undo(): void;
  redo(): void;
  publish(): void;
  unpublish(): void;
  upload(files: File[]): void;
  saveVersion(name: string): void;
  restore(): void;
  leavePreview(): void;
  openVersion(id: string): void;
  loadImages(): void;
  loadVersions(): void;
  loadMembers(): void;
  sendToken(op: { kind: "set_token"; name: string; value: string | number; unit?: "px" | "rem" } | { kind: "rename_token"; name: string; newName: string } | { kind: "delete_token"; name: string }): void;
  setFields(fields: Field[]): void;
  putEntry(entryId: string | undefined, values: Record<string, string>): void;
  moveEntry(entryId: string, index: number): void;
  deleteEntry(entryId: string): void;
  addPage(name: string): void;
  postComment(body: string): Promise<boolean>;
  postReply(threadId: string, body: string): Promise<boolean>;
  setThreadStatus(threadId: string, status: "open" | "resolved"): void;
  setDrag(drag: DragState | null): void;
  setPhoneSheet(sheet: PhoneSheet): void;
  pointer(x: number | null, y: number | null): void;
}

export interface EditorValue {
  state: EditorState;
  act: EditorActions;
  sync: Sync;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  layoutFrames: () => void;
}

export const EditorContext = createContext<EditorValue | null>(null);

export function useEditor(): EditorValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor outside the editor");
  return value;
}
