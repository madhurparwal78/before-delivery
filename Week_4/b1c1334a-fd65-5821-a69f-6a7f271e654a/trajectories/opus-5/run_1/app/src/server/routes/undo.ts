import type { StacksJson } from '../../shared/api.js';
import { runCommit, type Outcome } from '../commit.js';
import { nothingToRedo, nothingToUndo, undoConflict, type ApiError } from '../errors.js';
import { deleteEntry, followOwnRevisions, pushEntry, stackCounts, topEntry } from '../undo.js';
import { applyEntry, entryApplies, type Direction } from '../undoApply.js';
import type { Reply, RouteContext } from './types.js';

async function move(context: RouteContext, direction: Direction): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  return runCommit(context.client, context.request, context.account, documentId, {
    requires: 'editor',
    apply: async (editContext): Promise<Outcome> => {
      const { client, account } = editContext;
      const refuse = async (make: (stacks: StacksJson) => ApiError): Promise<Outcome> => {
        const stacks = await stackCounts(client, documentId, account.id);
        return { kind: 'refused', error: make(stacks) };
      };

      const entry = await topEntry(client, documentId, account.id, direction);
      if (entry === null) {
        return refuse((stacks) =>
          direction === 'undo' ? nothingToUndo(stacks) : nothingToRedo(stacks),
        );
      }
      if (!(await entryApplies(client, entry))) {
        await deleteEntry(client, entry.id);
        return refuse((stacks) => undoConflict(stacks));
      }
      const applied = await applyEntry(editContext, entry, direction);
      if (applied === 'conflict') {
        await deleteEntry(client, entry.id);
        return refuse((stacks) => undoConflict(stacks));
      }
      await deleteEntry(client, entry.id);
      await pushEntry(client, documentId, account.id, direction === 'undo' ? 'redo' : 'undo', {
        payload: applied.payload,
        targets: applied.targets,
      });
      await followOwnRevisions(client, documentId, account.id, applied.produced);
      return {
        kind: 'applied',
        status: 200,
        body:
          direction === 'undo'
            ? { undone: { kind: entry.kind } }
            : { redone: { kind: entry.kind } },
        classes: applied.classes,
        historyKind: direction,
        historyTableId: applied.tableId,
        undo: null,
        keepRedoStack: true,
      };
    },
  });
}

export function undo(context: RouteContext): Promise<Reply> {
  return move(context, 'undo');
}

export function redo(context: RouteContext): Promise<Reply> {
  return move(context, 'redo');
}
