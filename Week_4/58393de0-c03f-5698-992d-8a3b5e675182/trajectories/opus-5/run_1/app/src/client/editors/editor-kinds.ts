import type { CircuitComponent, CircuitWire, SceneObject, Snapshot } from '../../shared/types.js';

export interface EditorHooks {
  onEdit: () => void;
}

export interface EditorBody {
  element: HTMLElement;
  snapshot: () => Snapshot;
  undo: () => void;
  redo: () => void;
  setReadOnly: (readOnly: boolean) => void;
  loadSnapshot: (snapshot: Snapshot) => void;
  exportObjects: () => SceneObject[];
  circuit?: () => { components: CircuitComponent[]; wires: CircuitWire[] };
  focus: () => void;
  stop: () => void;
}
