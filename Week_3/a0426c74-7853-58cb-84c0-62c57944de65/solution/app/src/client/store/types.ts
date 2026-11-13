// The plain-object snapshots the stores publish. A snapshot is replaced as a whole on every change, but a slice keeps its
// identity until its own value changes, so a panel selecting one slice re-renders only when that slice does.
import type { DraftingAids, Grip, Scene, SceneEntity, Size, SnapCandidate, View, WindowMode } from '../../shared/geometry/index.ts';
import type {
  DistributiveOmit, DrawingListing, DrawingState, EntityDraft, ExportJob, Op, ParameterView, PresenceMember, Role, Sheet,
} from '../../shared/types.ts';

/** An operation before the store numbers it: the store gives every op of a group its `op_id`. */
export type OpInput = DistributiveOmit<Op, 'op_id'>;

export type LoadStatus = 'loading' | 'ready' | 'not-found' | 'unauthenticated' | 'revoked' | 'failed';

/** Where keyboard focus must go; the owner of the element acts on a request once (`seq` tells repeats apart). */
export type FocusTarget = 'command' | 'drawing' | 'layer-list' | 'parameter-list' | 'find';
interface FocusRequest { target: FocusTarget; seq: number }

/** ZOOMALL: the pane animates the view group from `from` to the current view once per `token`. */
interface ZoomAllMotion { token: number; from: View }

/** The candidate that wins at the pointer (the drawing root's `data-snap-*`), null when none. */
interface HoverSlice { snap: SnapCandidate | null }

/** The selection window while it is dragged, in pane px. */
interface WindowSlice { x: number; y: number; width: number; height: number; mode: WindowMode }

/** A grip of a selected entity, in world units (a dragged grip is shown where it is dragged). */
export interface GripView { entity: string; grip: Grip }

interface FindState {
  open: boolean;
  query: string;
  /** ids in entity list order */
  matches: readonly string[];
  /** the match `Next match` last selected, -1 before the first press */
  index: number;
}

export interface Connection {
  phase: 'live' | 'reconnecting' | 'offline' | 'back-online';
  /** the exact text of `status "Connection"` */
  text: string;
  /** the state of `switch "Work offline"` */
  offline: boolean;
}

export interface RemoteCursor {
  username: string;
  /** presence colour index 1..8 */
  colour: number;
  /** world units; null while the pointer is outside their pane */
  x: number | null;
  y: number | null;
  /** their selection, drawn as rings in their colour */
  selection: readonly string[];
}

interface CommandSlice {
  /** a command is running (its prompt shows a stage) */
  active: boolean;
  /** what the current stage waits for: `command` is the Ready prompt */
  expects: 'command' | 'point' | 'pick' | 'number' | 'word' | 'text';
}

/** `username` is the signed-in person (own name in People here, the asker of an RFI). */
export interface DocumentInfo { id: string; name: string; folderId: string; role: Role; username: string }

/** Everything the canvas and the shared panels (Entities, Properties, Find) read from any scene store. */
export interface SceneSnapshot {
  status: LoadStatus;
  /** mutated in place by incremental updates: read `scene.version` (or use `useScene`) to notice changes */
  scene: Scene;
  /** the entities that get a DOM element: nearest to the view centre up to the ceiling, plus every selected one */
  dom: readonly SceneEntity[];
  /** the last server revision seen (`data-revision`) */
  revision: number;
  /** the camera of the layout shown (`data-zoom`, `data-pan-x`, `data-pan-y`) */
  view: View;
  pane: Size;
  zoomAll: ZoomAllMotion | null;
  /** the sheet layout shown instead of the model; null for the model */
  sheet: Sheet | null;
  selection: ReadonlySet<string>;
  grips: readonly GripView[];
  hover: HoverSlice;
  window: WindowSlice | null;
  aids: DraftingAids;
  /** the text of `status "Command prompt"` */
  prompt: string;
  /** a two-point distance started from a phone long press waits for its second point */
  measuring: boolean;
  find: FindState;
  focus: FocusRequest | null;
}

/** What `DrawingStore` adds: the live, editable drawing. */
export interface DrawingSnapshot extends SceneSnapshot {
  info: DocumentInfo | null;
  /** the model as this page shows it: confirmed state plus unconfirmed groups */
  state: DrawingState;
  parameters: readonly ParameterView[];
  sheets: readonly Sheet[];
  /** can this person edit (role edit or manage)? */
  canEdit: boolean;
  currentLayer: string;
  connection: Connection;
  /** operations sent or queued but not yet confirmed (`data-pending-ops`) */
  pendingOps: number;
  members: readonly PresenceMember[];
  cursors: readonly RemoteCursor[];
  followed: string | null;
  command: CommandSlice;
  /** rubber-band ghosts for the pointer at the current stage */
  preview: readonly EntityDraft[];
  /** names of xrefs whose source published a version that is not loaded yet */
  xrefNotices: readonly string[];
  /** the text of `status "Storage notice"` */
  storageNotice: string | null;
  exportJob: ExportJob | null;
  /** the folder's drawings (names and xref sources) for XATTACH */
  folderDrawings: readonly Pick<DrawingListing, 'id' | 'name' | 'xref_sources'>[];
}
