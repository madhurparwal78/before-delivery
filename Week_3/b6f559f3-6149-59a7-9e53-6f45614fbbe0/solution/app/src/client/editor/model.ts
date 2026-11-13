/**
 * The editor's shared state and actions: the contract between the editor shell (provider, owns the
 * state and the server sync), the Inspector and Readouts, the stage and the timeline.
 * `EditorProvider` (editor/EditorProvider.tsx) implements it; everything else only reads `useEditor()`.
 */
import { createContext, useContext } from 'react';
import type { Person, SessionUser } from '../../shared/protocol';
import type {
  AssetInfo,
  Breakpoint,
  Change,
  Easing,
  JsonObject,
  LockInfo,
  ProjectSummary,
  Role,
  Scene,
  SceneDocument,
  VariableValue,
} from '../../shared/types';

/** The id the fixed `Camera, Camera` row uses as a selection. It is not a layer of the document. */
export const CAMERA_ID = 'camera';

export type NoticePanel = 'inspector' | 'layers' | 'timeline' | 'variables' | 'stage';

export interface EditorState {
  projectId: string;
  project: ProjectSummary;
  me: SessionUser;
  role: Role;
  /** Owners and editors; viewers can only inspect. */
  canEdit: boolean;
  document: SceneDocument;
  scene: Scene;
  assets: ReadonlyMap<string, AssetInfo>;
  breakpoint: Breakpoint;
  /** Timeline playhead, whole frames at 60 per second. */
  frame: number;
  playing: boolean;
  preview: boolean;
  reduceMotion: boolean;
  /** Scroll progress 0..100. */
  scroll: number;
  /** Selected layer ids, or [CAMERA_ID]. `primary` is the one the Inspector shows. */
  selection: readonly string[];
  primary: string | null;
  /** The inspector field that most recently had focus (a property path), the target of K. */
  focusedProperty: string | null;
  /** The keyframe the timeline last focused, for the Easing and Spring fields: `<layerId>|<property>|<frame>`. */
  focusedKeyframe: { layerId: string; property: string; frame: number } | null;
  locks: ReadonlyMap<string, LockInfo>;
  /** Everyone with the project open, the signed-in person included. */
  people: readonly Person[];
  /** `Held by <name>` for a layer another person holds, else null. */
  heldByOther: (layerId: string) => Person | null;
  /** Amber notice rows keyed by the panel where the action started. */
  notices: Readonly<Partial<Record<NoticePanel, string>>>;
  /** The scene being edited. `scene` is this scene of `document`. */
  sceneId: string;
  saveStatus: 'saved' | 'saving' | 'failed';
  /** Text of `Editor status`: the last success or progress message, or the connection loss. */
  statusText: string;
  connection: 'up' | 'down';
  undoDepth: number;
  redoDepth: number;
  /** Counters that tick when the live channel reports a new version or a membership change. */
  versionTick: number;
  membersTick: number;
}

export interface EditorActions {
  /**
   * Applies changes locally at once and queues them for the server (one `ops` request, sent AUTOSAVE_MS after the
   * last change). Applies with the same `mergeKey` less than AUTOSAVE_MS apart merge into one undo step.
   * Refusals come back as `notices`.
   */
  apply: (changes: Change[], mergeKey?: string, panel?: NoticePanel) => void;
  /** `updateLayer` for the current breakpoint. `set` takes property paths (`position.x`). */
  editLayer: (layerId: string, set: JsonObject, mergeKey?: string) => void;
  /** `clearOverride` at the current breakpoint. */
  resetOverride: (layerId: string, path: string) => void;
  editScene: (set: JsonObject, mergeKey?: string) => void;
  setKeyframe: (layerId: string, property: string, frame: number, value: number, easing: Easing) => void;
  setVariable: (name: string, value: VariableValue) => void;
  select: (ids: readonly string[], primary?: string | null) => void;
  setBreakpoint: (breakpoint: Breakpoint) => void;
  setFrame: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  setPreview: (preview: boolean) => void;
  setReduceMotion: (on: boolean) => void;
  setScroll: (progress: number) => void;
  setFocusedProperty: (path: string | null) => void;
  setFocusedKeyframe: (keyframe: EditorState['focusedKeyframe']) => void;
  /** Success and progress text for `status` `Editor status`. */
  announce: (message: string) => void;
  setNotice: (panel: NoticePanel, message: string | null) => void;
  undo: () => void;
  redo: () => void;
  /** Releases the layer lock the person holds, as when the Inspector loses focus. */
  releaseLock: () => void;
  uploadAsset: (kind: AssetInfo['kind'], file: File) => Promise<AssetInfo | null>;
  /** Like `apply` for changes that create layers (`addLayer`, `duplicateLayer`, `group`): resolves with the server's ids. */
  applyWithIds: (changes: Change[], panel?: NoticePanel) => Promise<Record<string, string> | null>;
  /** K: a keyframe for the focused property at the playhead. */
  addKeyframeAtPlayhead: () => void;
  selectScene: (sceneId: string) => void;
  /** Re-reads the project (assets, summary, locks) from the server. */
  refresh: () => Promise<void>;
}

export type Editor = EditorState & EditorActions;

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const value = useContext(EditorContext);
  if (!value) throw new Error('useEditor needs an EditorProvider');
  return value;
}

;
