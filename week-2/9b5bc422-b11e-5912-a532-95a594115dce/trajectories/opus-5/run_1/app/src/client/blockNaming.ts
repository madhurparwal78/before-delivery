import { blockLabel, blockName } from '../domain/blocks.ts';
import { isBothKept } from '../domain/materialise.ts';
import type { BlockRecord, NoteRecord } from '../domain/types.ts';
import { syncing, type State } from './store/store.ts';

export function nameOfBlock(state: State, block: BlockRecord): string {
  const file = block.attachmentId ? state.files.get(block.attachmentId) : undefined;
  const attachment = block.attachmentId ? state.workspace.attachments.get(block.attachmentId) : undefined;
  const table = block.tableId ? state.workspace.tables.get(block.tableId) : undefined;
  return blockName({
    type: block.type,
    label: blockLabel({
      type: block.type,
      text: block.text,
      fileName: file?.name ?? attachment?.name ?? null,
      tableName: table?.name ?? null,
    }),
    unsynced: hasNotch(state, `block:${block.id}`),
    bothKept: isBothKept(block.text),
  });
}

export function nameOfNote(state: State, note: NoteRecord): string {
  return blockName({
    type: 'note',
    label: blockLabel({ type: 'note', text: note.text }),
    unsynced: hasNotch(state, `note:${note.id}`),
    bothKept: isBothKept(note.text),
  });
}

/** The notch shows on a syncing device from the first saved change until the account confirms it. */
function hasNotch(state: State, entityKey: string): boolean {
  return syncing() && state.pending.entities.has(entityKey);
}
