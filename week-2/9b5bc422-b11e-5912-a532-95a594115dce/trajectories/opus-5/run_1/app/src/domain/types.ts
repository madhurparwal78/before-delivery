export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'divider'
  | 'image'
  | 'file'
  | 'table'
  | 'note';

export type Indent = 0 | 1 | 2;

export type ColumnType = 'text' | 'number' | 'date' | 'checkbox' | 'select';

export type Column = {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[];
};

export type CellValue = string | number | boolean | null;

export type EntityKind = 'document' | 'block' | 'note' | 'connector' | 'table' | 'row' | 'attachment';

export type DocumentKind = 'document' | 'journal';

/** One change to one field of one record. */
export type Op = {
  id: string;
  deviceId: string;
  entity: EntityKind;
  entityId: string;
  field: string;
  value: unknown;
  /** The document this record belongs to, when it belongs to one. */
  documentId?: string;
  /** Heads this edit was based on, for merge fields only. */
  parents?: string[];
  at: string;
  /** A seeded or template record, which never overwrites what the account holds. */
  seed?: boolean;
  /** An automatic card slot, which only fills an empty position. */
  slot?: boolean;
  /** A change to what the document says, which moves it up the list. */
  content?: boolean;
  /** Set by the account when it takes the change. */
  seq?: number;
};

export type OpStatus = 'local' | 'sent' | 'confirmed';

export type StoredOp = Op & { status: OpStatus };

/** A field that can hold two values at once, until a person picks one. */
export type MergeField<T> = { values: { opId: string; value: T }[] };

export type WorldPosition = { x: number; y: number };

export type DocumentRecord = {
  id: string;
  kind: DocumentKind;
  journalDate: string | null;
  seedOrder: number;
  title: MergeField<string>;
  folder: string | null;
  tags: string[];
  starred: boolean;
  trashed: boolean;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BlockRecord = {
  id: string;
  documentId: string;
  type: BlockType;
  text: MergeField<string>;
  indent: Indent;
  checked: boolean;
  order: number;
  position: WorldPosition | null;
  attachmentId: string | null;
  tableId: string | null;
};

export type NoteRecord = {
  id: string;
  documentId: string;
  text: MergeField<string>;
  position: WorldPosition;
  createdAt: string;
};

export type ConnectorRecord = {
  id: string;
  documentId: string;
  from: string;
  to: string;
};

export type TableRecord = {
  id: string;
  name: string;
  columns: Column[];
  createdAt: string;
};

export type RowRecord = {
  id: string;
  tableId: string;
  order: number;
  cells: Record<string, MergeField<CellValue>>;
};

export type AttachmentState = 'waiting' | 'stored' | 'refused';

export type AttachmentRecord = {
  id: string;
  documentId: string;
  name: string;
  size: number;
  contentType: string;
};

export type Workspace = {
  documents: Map<string, DocumentRecord>;
  blocks: Map<string, BlockRecord>;
  notes: Map<string, NoteRecord>;
  connectors: Map<string, ConnectorRecord>;
  tables: Map<string, TableRecord>;
  rows: Map<string, RowRecord>;
  attachments: Map<string, AttachmentRecord>;
  deletedForever: Set<string>;
};
