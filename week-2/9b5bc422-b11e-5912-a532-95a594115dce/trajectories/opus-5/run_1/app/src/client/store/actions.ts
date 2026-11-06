import { orderBetween } from '../../domain/blocks.ts';
import { cardSlots } from '../../domain/canvas.ts';
import { documentBlocks, documentConnectors, documentNotes, keepOrder, tableRows } from '../../domain/materialise.ts';
import { uuid } from '../../domain/ops.ts';
import { nextTableName } from '../../domain/records.ts';
import { journalDocumentId, journalNoteOps, templateOps } from '../../domain/seed.ts';
import { TEMPLATES } from '../../domain/templates.ts';
import type {
  BlockType,
  CellValue,
  Column,
  ColumnType,
  Indent,
  MergeField,
  WorldPosition,
} from '../../domain/types.ts';
import { apply, applyField, snapshot } from './store.ts';
import { attachments } from './sync.ts';

function heads<T>(field: MergeField<T> | undefined): string[] {
  return field ? field.values.map((head) => head.opId) : [];
}

export const documents = {
  async create(): Promise<{ documentId: string; blockId: string }> {
    const documentId = uuid();
    const blockId = uuid();
    await apply([
      {
        entity: 'document',
        entityId: documentId,
        field: 'create',
        value: { kind: 'document', journalDate: null, seedOrder: 0 },
        content: true,
      },
      { entity: 'document', entityId: documentId, field: 'title', value: '', content: true },
      {
        entity: 'block',
        entityId: blockId,
        field: 'create',
        value: { documentId, type: 'paragraph', order: 1, indent: 0, checked: false },
        content: true,
      },
      { entity: 'block', entityId: blockId, field: 'text', value: '', content: true },
    ]);
    return { documentId, blockId };
  },

  async setTitle(documentId: string, title: string): Promise<void> {
    const document = snapshot().workspace.documents.get(documentId);
    await applyField({
      entity: 'document',
      entityId: documentId,
      field: 'title',
      value: title,
      parents: heads(document?.title),
      content: true,
    });
  },

  async setFolder(documentId: string, folder: string | null): Promise<void> {
    await applyField({ entity: 'document', entityId: documentId, field: 'folder', value: folder });
  },

  async setTags(documentId: string, tags: string[]): Promise<void> {
    await applyField({ entity: 'document', entityId: documentId, field: 'tags', value: tags });
  },

  async setStarred(documentId: string, starred: boolean): Promise<void> {
    await applyField({ entity: 'document', entityId: documentId, field: 'starred', value: starred });
  },

  async setTrashed(documentId: string, trashed: boolean): Promise<void> {
    await apply([
      { entity: 'document', entityId: documentId, field: 'trashed', value: trashed },
      {
        entity: 'document',
        entityId: documentId,
        field: 'trashedAt',
        value: trashed ? new Date().toISOString() : null,
      },
    ]);
  },
};

export const blocks = {
  async insertAfter(
    documentId: string,
    afterBlockId: string | null,
    type: BlockType,
    options: { indent?: Indent; text?: string; tableId?: string | null } = {},
  ): Promise<string> {
    const ordered = documentBlocks(snapshot().workspace, documentId);
    const index = afterBlockId ? ordered.findIndex((block) => block.id === afterBlockId) : ordered.length - 1;
    const before = index >= 0 ? ordered[index]?.order ?? null : null;
    const after = index >= 0 && index + 1 < ordered.length ? ordered[index + 1].order : null;
    const blockId = uuid();
    await apply([
      {
        entity: 'block',
        entityId: blockId,
        field: 'create',
        value: {
          documentId,
          type,
          order: orderBetween(before, after),
          indent: options.indent ?? 0,
          checked: false,
          tableId: options.tableId ?? null,
        },
        content: true,
      },
      { entity: 'block', entityId: blockId, field: 'text', value: options.text ?? '', content: true },
    ]);
    return blockId;
  },

  async setText(blockId: string, text: string): Promise<void> {
    const block = snapshot().workspace.blocks.get(blockId);
    await applyField({
      entity: 'block',
      entityId: blockId,
      field: 'text',
      value: text,
      parents: heads(block?.text),
      content: true,
    });
  },

  async setType(blockId: string, type: BlockType): Promise<void> {
    await applyField({ entity: 'block', entityId: blockId, field: 'type', value: type, content: true });
  },

  async setIndent(blockId: string, indent: Indent): Promise<void> {
    await applyField({ entity: 'block', entityId: blockId, field: 'indent', value: indent, content: true });
  },

  async setChecked(blockId: string, checked: boolean): Promise<void> {
    await applyField({ entity: 'block', entityId: blockId, field: 'checked', value: checked, content: true });
  },

  async remove(blockId: string): Promise<void> {
    const block = snapshot().workspace.blocks.get(blockId);
    await apply([
      {
        entity: 'block',
        entityId: blockId,
        field: 'deleted',
        value: true,
        parents: heads(block?.text),
        content: true,
      },
    ]);
  },

  async move(blockId: string, direction: -1 | 1): Promise<number> {
    const block = snapshot().workspace.blocks.get(blockId);
    if (!block) return 0;
    const ordered = documentBlocks(snapshot().workspace, block.documentId);
    const index = ordered.findIndex((item) => item.id === blockId);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return index + 1;
    const neighbour = ordered[target];
    const beyond = ordered[target + direction];
    const order = orderBetween(
      direction === 1 ? neighbour.order : beyond?.order ?? null,
      direction === 1 ? beyond?.order ?? null : neighbour.order,
    );
    await applyField({ entity: 'block', entityId: blockId, field: 'order', value: order, content: true });
    return target + 1;
  },

  async reorder(blockId: string, beforeOrder: number | null, afterOrder: number | null): Promise<void> {
    await applyField({
      entity: 'block',
      entityId: blockId,
      field: 'order',
      value: orderBetween(beforeOrder, afterOrder),
      content: true,
    });
  },

  async setPosition(blockId: string, position: WorldPosition): Promise<void> {
    await applyField({ entity: 'block', entityId: blockId, field: 'position', value: position });
  },

  /** A record table block is bound to its table for good. */
  async bindTable(blockId: string, tableId: string): Promise<void> {
    await applyField({ entity: 'block', entityId: blockId, field: 'tableId', value: tableId, content: true });
  },

  async attach(blockId: string, documentId: string, file: File): Promise<void> {
    const attachmentId = uuid();
    await apply([
      {
        entity: 'attachment',
        entityId: attachmentId,
        field: 'create',
        value: { documentId, name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' },
      },
      { entity: 'block', entityId: blockId, field: 'attachmentId', value: attachmentId },
    ]);
    await attachments.queue(file, documentId, attachmentId);
  },

  /** The card slot rule, run whenever the canvas shows a block with no stored position. */
  async giveSlots(documentId: string): Promise<void> {
    const workspace = snapshot().workspace;
    const ordered = documentBlocks(workspace, documentId);
    const notes = documentNotes(workspace, documentId);
    const placed = [
      ...ordered.filter((block) => block.position).map((block) => (block.position as WorldPosition).x),
      ...notes.map((note) => note.position.x),
    ];
    const waiting = ordered.filter((block) => !block.position);
    if (!waiting.length) return;
    const slots = cardSlots(waiting.length, placed);
    await apply(
      waiting.map((block, index) => ({
        entity: 'block' as const,
        entityId: block.id,
        field: 'position',
        value: slots[index],
        slot: true,
      })),
    );
  },
};

export const notes = {
  async create(documentId: string, position: WorldPosition): Promise<string> {
    const noteId = uuid();
    await apply([
      { entity: 'note', entityId: noteId, field: 'create', value: { documentId, position } },
      { entity: 'note', entityId: noteId, field: 'text', value: '' },
    ]);
    return noteId;
  },

  async setText(noteId: string, text: string): Promise<void> {
    const note = snapshot().workspace.notes.get(noteId);
    await applyField({
      entity: 'note',
      entityId: noteId,
      field: 'text',
      value: text,
      parents: heads(note?.text),
    });
  },

  async setPosition(noteId: string, position: WorldPosition): Promise<void> {
    await applyField({ entity: 'note', entityId: noteId, field: 'position', value: position });
  },

  async remove(noteId: string): Promise<void> {
    const note = snapshot().workspace.notes.get(noteId);
    await apply([
      { entity: 'note', entityId: noteId, field: 'deleted', value: true, parents: heads(note?.text) },
    ]);
  },
};

export const connectors = {
  /** Connecting a joined pair removes the connector. */
  async toggle(documentId: string, from: string, to: string): Promise<'added' | 'removed'> {
    const existing = documentConnectors(snapshot().workspace, documentId).find(
      (connector) =>
        (connector.from === from && connector.to === to) || (connector.from === to && connector.to === from),
    );
    if (existing) {
      await apply([{ entity: 'connector', entityId: existing.id, field: 'deleted', value: true }]);
      return 'removed';
    }
    await apply([
      { entity: 'connector', entityId: uuid(), field: 'create', value: { documentId, from, to } },
    ]);
    return 'added';
  },
};

export const tables = {
  async create(): Promise<string> {
    const tableId = uuid();
    const names = [...snapshot().workspace.tables.values()].map((table) => table.name);
    const columns: Column[] = [
      { id: uuid(), name: 'Name', type: 'text' },
      { id: uuid(), name: 'Amount', type: 'number' },
    ];
    await apply([
      {
        entity: 'table',
        entityId: tableId,
        field: 'create',
        value: { name: nextTableName(names), columns },
      },
    ]);
    return tableId;
  },

  async setName(tableId: string, name: string): Promise<void> {
    await applyField({ entity: 'table', entityId: tableId, field: 'name', value: name });
  },

  async addColumn(tableId: string, name: string, type: ColumnType, options: string[]): Promise<void> {
    const table = snapshot().workspace.tables.get(tableId);
    if (!table) return;
    const column: Column = { id: uuid(), name, type };
    if (type === 'select') column.options = options;
    await applyField({
      entity: 'table',
      entityId: tableId,
      field: 'columns',
      value: [...table.columns, column],
    });
  },

  async addRow(tableId: string): Promise<string> {
    const rows = tableRows(snapshot().workspace, tableId);
    const rowId = uuid();
    await apply([
      {
        entity: 'row',
        entityId: rowId,
        field: 'create',
        value: { tableId, order: (rows[rows.length - 1]?.order ?? 0) + 1 },
        content: true,
      },
    ]);
    return rowId;
  },

  async setCell(rowId: string, columnId: string, value: CellValue): Promise<void> {
    const row = snapshot().workspace.rows.get(rowId);
    await applyField({
      entity: 'row',
      entityId: rowId,
      field: `cell:${columnId}`,
      value,
      parents: heads(row?.cells[columnId]),
      content: true,
    });
  },

  async appendRows(tableId: string, incoming: Record<string, CellValue>[]): Promise<void> {
    const rows = tableRows(snapshot().workspace, tableId);
    let order = (rows[rows.length - 1]?.order ?? 0) + 1;
    const drafts = [];
    for (const cells of incoming) {
      const rowId = uuid();
      drafts.push({
        entity: 'row' as const,
        entityId: rowId,
        field: 'create',
        value: { tableId, order },
        content: true,
      });
      for (const [columnId, value] of Object.entries(cells)) {
        drafts.push({
          entity: 'row' as const,
          entityId: rowId,
          field: `cell:${columnId}`,
          value,
          content: true,
        });
      }
      order += 1;
    }
    await apply(drafts);
  },
};

export const journal = {
  /** Opening a day with no note creates it from the `Daily note` template. */
  async open(date: string): Promise<string> {
    const documentId = journalDocumentId(date);
    if (snapshot().workspace.documents.has(documentId)) return documentId;
    const state = snapshot();
    const ops = journalNoteOps(date, new Date().toISOString(), state.deviceId, false);
    await apply(
      ops.map((op) => ({
        id: op.id,
        entity: op.entity,
        entityId: op.entityId,
        field: op.field,
        value: op.value,
        content: op.content,
      })),
    );
    return documentId;
  },
};

export const templates = {
  async use(templateId: string): Promise<{ documentId: string; blockId: string }> {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    const documentId = uuid();
    const blockIds = template.blocks.map(() => uuid());
    const ops = templateOps(documentId, (index) => blockIds[index], template.blocks, {
      at: new Date().toISOString(),
    });
    await apply([
      {
        entity: 'document',
        entityId: documentId,
        field: 'create',
        value: { kind: 'document', journalDate: null, seedOrder: 0 },
        content: true,
      },
      { entity: 'document', entityId: documentId, field: 'title', value: template.name, content: true },
      ...ops.map((op) => ({
        entity: op.entity,
        entityId: op.entityId,
        field: op.field,
        value: op.value,
        content: op.content,
      })),
    ]);
    return { documentId, blockId: blockIds[0] };
  },
};

export const bothKept = {
  /** Picking a value collapses every kept value into the one chosen. */
  async keep(
    entity: 'block' | 'document' | 'row' | 'note',
    entityId: string,
    field: string,
    value: CellValue,
    kept: string[],
  ): Promise<void> {
    await apply([{ entity, entityId, field, value, parents: kept, content: true }]);
  },
};

export function keepButtons<T>(field: MergeField<T>): { opId: string; value: T }[] {
  return keepOrder(field.values);
}
