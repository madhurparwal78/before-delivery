// Domain types shared by the client and the server.

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
  | 'table';

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulleted: 'Bulleted list',
  numbered: 'Numbered list',
  todo: 'To-do',
  quote: 'Quote',
  divider: 'Divider',
  image: 'Image',
  file: 'File',
  table: 'Record table',
};

export const SLASH_OPTIONS: BlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulleted',
  'numbered',
  'todo',
  'quote',
  'divider',
  'image',
  'file',
  'table',
];

export interface WorldPosition {
  x: number;
  y: number;
}

export interface Block {
  id: string;
  documentId: string;
  type: BlockType;
  text: string;
  indent: 0 | 1 | 2;
  checked: boolean;
  order: number;
  card?: WorldPosition | null;
  tableId?: string | null;
  attachmentId?: string | null;
}

export interface Note {
  id: string;
  documentId: string;
  text: string;
  card: WorldPosition;
  order: number;
  createdAt?: number;
}

export interface Connector {
  id: string;
  documentId: string;
  fromId: string;
  toId: string;
}

export interface DocumentMeta {
  id: string;
  title: string;
  folder: string | null;
  tags: string[];
  starred: boolean;
  trashed: boolean;
  updatedAt: number;
  createdAt: number;
  journal?: boolean;
}

export type ColumnType = 'text' | 'number' | 'date' | 'checkbox' | 'select';

export interface Column {
  id: string;
  tableId: string;
  name: string;
  type: ColumnType;
  options: string[];
  order: number;
}

export interface Row {
  id: string;
  tableId: string;
  values: Record<string, string | number | boolean | null>;
  createdAt?: number;
}

export interface TableMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  state: 'waiting' | 'stored' | 'refused';
}

export const FILE_SIZE_LIMIT = 5_000_000;
export const CSV_SIZE_LIMIT = 1_000_000;

// A single change, as sent to the account. One record per change.
export type ChangeKind =
  | 'document'
  | 'block'
  | 'note'
  | 'connector'
  | 'table'
  | 'column'
  | 'row'
  | 'attachment';

export interface Change {
  id: string;
  kind: ChangeKind;
  recordId: string;
  documentId?: string | null;
  deleted?: boolean;
  payload: unknown;
  baseVersion?: number | null;
  deviceId?: string;
  clientSeq?: number;
  createOnly?: boolean;
}

export interface AppliedChange {
  id: string;
  kind: ChangeKind;
  recordId: string;
  version: number;
  conflict: boolean;
  payload: unknown;
  deleted?: boolean;
  deviceId?: string;
}

export interface User {
  id: string;
  email: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  current?: boolean;
  lastSeenAt: string;
}

export interface ShareInfo {
  token: string;
  url: string;
  expiresAt: string;
}
