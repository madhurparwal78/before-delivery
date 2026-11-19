import type { Step } from '../../shared/types';

export type UndoEntry =
  | { kind: 'field'; path: string; before: unknown; after: unknown; label: string }
  | { kind: 'move'; stepId: string; from: number; to: number; label: string }
  | { kind: 'add'; stepId: string; step: Step | null; position: number; label: string }
  | { kind: 'delete'; step: Step; position: number; fitted: string[]; label: string };

/** The signed-in person's own edits in this open page: undo and redo stacks; a new edit empties the redo stack. */
export class UndoStack {
  private undos: UndoEntry[] = [];
  private redos: UndoEntry[] = [];

  record(entry: UndoEntry): void {
    this.undos.push(entry);
    this.redos = [];
  }

  popUndo(): UndoEntry | undefined {
    return this.undos.pop();
  }

  popRedo(): UndoEntry | undefined {
    return this.redos.pop();
  }

  pushUndo(entry: UndoEntry): void {
    this.undos.push(entry);
  }

  pushRedo(entry: UndoEntry): void {
    this.redos.push(entry);
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }
}
