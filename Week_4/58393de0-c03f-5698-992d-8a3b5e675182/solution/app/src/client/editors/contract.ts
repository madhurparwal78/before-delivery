import type { MutableRefObject } from "react";
import type { DesignObject, Snapshot, SnapshotCircuit } from "../../shared/types";

/** What an editor hands the shell so the Export dialog can describe and build the file. */
export type ExportSource =
  | { kind: "design"; objects: DesignObject[] }
  | { kind: "circuit"; snapshot: SnapshotCircuit };

/**
 * The shell (top toolbar, autosave, Ctrl+S, Export) talks to the open editor only through this object.
 * The editor owns the document, its undo history and the shortcuts that edit it.
 */
export interface EditorController {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Called whenever canUndo/canRedo change so the toolbar buttons stay current. */
  subscribe: (listener: () => void) => () => void;
  /**
   * Shortcut handler for a keydown anywhere inside the editor region (not in a text box, and
   * not for Ctrl+S, which the shell owns). Returns true when the key was an editor shortcut,
   * so the shell can prevent the browser default.
   */
  handleKey: (event: KeyboardEvent) => boolean;
  exportSource: () => ExportSource;
}

export interface EditorProps {
  /** The document to show. When `documentKey` changes the editor discards its state and starts over from this. */
  snapshot: Snapshot;
  documentKey: number;
  readOnly: boolean;
  /** Called with the full new snapshot after every edit the user makes. */
  onChange: (snapshot: Snapshot) => void;
  controllerRef: MutableRefObject<EditorController | null>;
}
