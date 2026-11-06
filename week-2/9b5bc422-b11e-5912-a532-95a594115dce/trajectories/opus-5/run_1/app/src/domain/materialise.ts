import type {
  BlockRecord,
  BlockType,
  CellValue,
  Column,
  ConnectorRecord,
  DocumentKind,
  DocumentRecord,
  Indent,
  MergeField,
  NoteRecord,
  Op,
  RowRecord,
  TableRecord,
  Workspace,
  WorldPosition,
} from './types.ts';

export const CREATE = 'create';


function opOrder(a: Op, b: Op): number {
  const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
  const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Keep every concurrent value, newest edits replacing the values they were based on. */
function applyMerge<T>(heads: { opId: string; value: T }[], op: Op): { opId: string; value: T }[] {
  const parents = op.parents ?? [];
  const kept = heads.filter((head) => !parents.includes(head.opId));
  const next = [...kept, { opId: op.id, value: op.value as T }];
  const seen = new Set<string>();
  return next.filter((head) => {
    const key = JSON.stringify(head.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `Keep` order: alphabetical ignoring case, then by exact text, so every device matches. */
export function keepOrder<T>(values: { opId: string; value: T }[]): { opId: string; value: T }[] {
  return [...values].sort((a, b) => {
    const ta = cellText(a.value as CellValue);
    const tb = cellText(b.value as CellValue);
    const la = ta.toLowerCase();
    const lb = tb.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.opId < b.opId ? -1 : 1;
  });
}

export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function fieldValue<T>(field: MergeField<T>, fallback: T): T {
  const ordered = keepOrder(field.values);
  return ordered.length ? ordered[0].value : fallback;
}

export function isBothKept<T>(field: MergeField<T> | undefined): boolean {
  return !!field && field.values.length > 1;
}

type FieldBag = Map<string, Op[]>;

type EntityBag = {
  create: Op | null;
  fields: FieldBag;
};

function bag(): EntityBag {
  return { create: null, fields: new Map() };
}

function lwwWinner(ops: Op[]): Op | null {
  let plain: Op | null = null;
  let slot: Op | null = null;
  for (const op of ops) {
    if (op.slot) {
      if (!slot || opOrder(slot, op) < 0) slot = op;
    } else if (!plain || opOrder(plain, op) < 0) plain = op;
  }
  return plain ?? slot;
}

function lwwValue<T>(bagOf: EntityBag, field: string, fallback: T): T {
  const ops = bagOf.fields.get(field);
  if (!ops || !ops.length) return fallback;
  const winner = lwwWinner(ops);
  return winner ? (winner.value as T) : fallback;
}

function mergeValue<T>(bagOf: EntityBag, field: string): MergeField<T> {
  const ops = bagOf.fields.get(field);
  if (!ops || !ops.length) return { values: [] };
  let heads: { opId: string; value: T }[] = [];
  for (const op of [...ops].sort(opOrder)) heads = applyMerge(heads, op);
  return { values: heads };
}

/** A record is gone when its delete saw every value that is still there. */
function isDeleted(bagOf: EntityBag, textField: MergeField<string> | null): boolean {
  const deletes = bagOf.fields.get('deleted');
  if (!deletes || !deletes.length) return false;
  const latest = lwwWinner(deletes);
  if (!latest || latest.value !== true) return false;
  if (!textField) return true;
  const seen = latest.parents ?? [];
  return textField.values.every((head) => seen.includes(head.opId));
}

export function materialise(ops: Op[], deletedForever: Set<string> = new Set()): Workspace {
  const byEntity = new Map<string, EntityBag>();
  for (const op of ops) {
    const key = `${op.entity}:${op.entityId}`;
    let entry = byEntity.get(key);
    if (!entry) {
      entry = bag();
      byEntity.set(key, entry);
    }
    if (op.field === CREATE) {
      if (!entry.create || opOrder(entry.create, op) > 0) entry.create = op;
      continue;
    }
    const list = entry.fields.get(op.field);
    if (list) list.push(op);
    else entry.fields.set(op.field, [op]);
  }

  const workspace: Workspace = {
    documents: new Map(),
    blocks: new Map(),
    notes: new Map(),
    connectors: new Map(),
    tables: new Map(),
    rows: new Map(),
    attachments: new Map(),
    deletedForever: new Set(deletedForever),
  };

  const contentAt = new Map<string, string>();
  const touch = (documentId: string, at: string) => {
    const current = contentAt.get(documentId);
    if (!current || current < at) contentAt.set(documentId, at);
  };

  for (const [key, entry] of byEntity) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const create = entry.create;
    if (!create) continue;
    const made = create.value as Record<string, unknown>;

    if (kind === 'document') {
      if (deletedForever.has(id)) continue;
      const title = mergeValue<string>(entry, 'title');
      const record: DocumentRecord = {
        id,
        kind: (made.kind as DocumentKind) ?? 'document',
        journalDate: (made.journalDate as string) ?? null,
        seedOrder: (made.seedOrder as number) ?? 0,
        title,
        folder: lwwValue<string | null>(entry, 'folder', null),
        tags: lwwValue<string[]>(entry, 'tags', []),
        starred: lwwValue<boolean>(entry, 'starred', false),
        trashed: lwwValue<boolean>(entry, 'trashed', false),
        trashedAt: lwwValue<string | null>(entry, 'trashedAt', null),
        createdAt: create.at,
        updatedAt: create.at,
      };
      workspace.documents.set(id, record);
      touch(id, create.at);
      for (const ops2 of entry.fields.values()) {
        for (const op of ops2) if (op.content) touch(id, op.at);
      }
      continue;
    }

    if (kind === 'block') {
      const documentId = made.documentId as string;
      if (deletedForever.has(documentId)) continue;
      const text = mergeValue<string>(entry, 'text');
      if (isDeleted(entry, text)) continue;
      const record: BlockRecord = {
        id,
        documentId,
        type: lwwValue<BlockType>(entry, 'type', (made.type as BlockType) ?? 'paragraph'),
        text,
        indent: lwwValue<Indent>(entry, 'indent', (made.indent as Indent) ?? 0),
        checked: lwwValue<boolean>(entry, 'checked', (made.checked as boolean) ?? false),
        order: lwwValue<number>(entry, 'order', (made.order as number) ?? 0),
        position: lwwValue<WorldPosition | null>(entry, 'position', (made.position as WorldPosition) ?? null),
        attachmentId: lwwValue<string | null>(entry, 'attachmentId', (made.attachmentId as string) ?? null),
        tableId: lwwValue<string | null>(entry, 'tableId', (made.tableId as string) ?? null),
      };
      workspace.blocks.set(id, record);
      if (create.content) touch(documentId, create.at);
      for (const ops2 of entry.fields.values()) {
        for (const op of ops2) if (op.content) touch(documentId, op.at);
      }
      continue;
    }

    if (kind === 'note') {
      const documentId = made.documentId as string;
      if (deletedForever.has(documentId)) continue;
      const text = mergeValue<string>(entry, 'text');
      if (isDeleted(entry, text)) continue;
      const record: NoteRecord = {
        id,
        documentId,
        text,
        position: lwwValue<WorldPosition>(entry, 'position', (made.position as WorldPosition) ?? { x: 0, y: 0 }),
        createdAt: create.at,
      };
      workspace.notes.set(id, record);
      continue;
    }

    if (kind === 'connector') {
      const documentId = made.documentId as string;
      if (deletedForever.has(documentId)) continue;
      if (isDeleted(entry, null)) continue;
      const record: ConnectorRecord = {
        id,
        documentId,
        from: made.from as string,
        to: made.to as string,
      };
      workspace.connectors.set(id, record);
      continue;
    }

    if (kind === 'table') {
      const record: TableRecord = {
        id,
        name: lwwValue<string>(entry, 'name', (made.name as string) ?? 'Untitled table'),
        columns: lwwValue<Column[]>(entry, 'columns', (made.columns as Column[]) ?? []),
        createdAt: create.at,
      };
      workspace.tables.set(id, record);
      continue;
    }

    if (kind === 'row') {
      if (isDeleted(entry, null)) continue;
      const cells: Record<string, MergeField<CellValue>> = {};
      for (const field of entry.fields.keys()) {
        if (field.startsWith('cell:')) cells[field.slice(5)] = mergeValue<CellValue>(entry, field);
      }
      const record: RowRecord = {
        id,
        tableId: made.tableId as string,
        order: lwwValue<number>(entry, 'order', (made.order as number) ?? 0),
        cells,
      };
      workspace.rows.set(id, record);
      continue;
    }

    if (kind === 'attachment') {
      const documentId = made.documentId as string;
      if (deletedForever.has(documentId)) continue;
      workspace.attachments.set(id, {
        id,
        documentId,
        name: made.name as string,
        size: made.size as number,
        contentType: made.contentType as string,
      });
    }
  }

  for (const document of workspace.documents.values()) {
    document.updatedAt = contentAt.get(document.id) ?? document.createdAt;
  }
  return workspace;
}

export function documentBlocks(workspace: Workspace, documentId: string): BlockRecord[] {
  const blocks = [...workspace.blocks.values()].filter((block) => block.documentId === documentId);
  blocks.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order - b.order));
  return blocks;
}

export function documentNotes(workspace: Workspace, documentId: string): NoteRecord[] {
  const notes = [...workspace.notes.values()].filter((note) => note.documentId === documentId);
  notes.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  return notes;
}

export function documentConnectors(workspace: Workspace, documentId: string): ConnectorRecord[] {
  return [...workspace.connectors.values()].filter((connector) => connector.documentId === documentId);
}

export function tableRows(workspace: Workspace, tableId: string): RowRecord[] {
  const rows = [...workspace.rows.values()].filter((row) => row.tableId === tableId);
  rows.sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order - b.order));
  return rows;
}
