// Each author's undo and redo lists, rebuilt from their own batches in log order. The server decides
// undo and redo with these lists; the editor reads them to name what a refused undo was about.

export interface BatchMark { batchId: string; undoOf: string | null; redoOf: string | null }

export function undoStacks(batches: readonly BatchMark[]): { undo: string[]; redo: string[] } {
  const undo: string[] = [];
  let redo: string[] = [];
  for (const batch of batches) {
    if (batch.undoOf) { undo.pop(); redo.push(batch.undoOf); }
    else if (batch.redoOf) { redo.pop(); undo.push(batch.batchId); }
    else { undo.push(batch.batchId); redo = []; }
  }
  return { undo, redo };
}
