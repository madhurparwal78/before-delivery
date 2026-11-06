import type { ChangeMode, ColumnFields, FieldValue, RecordKind, WorldPosition } from "../../shared/sync.ts";

export type BlockType =
  | "paragraph" | "heading1" | "heading2" | "heading3" | "bulleted" | "numbered"
  | "todo" | "quote" | "divider" | "image" | "file" | "table";

export type DocumentFields = {
  title: string;
  folder: string;
  tags: string[];
  starred: boolean;
  trashedAt: number | null;
  updatedAt: number;
  seedOrder: number;
  journalDate: string | null;
  deletedForever: boolean;
};

export type BlockFields = {
  documentId: string;
  type: BlockType;
  text: string;
  indent: number;
  checked: boolean;
  order: string;
  card: WorldPosition | null;
  tableId: string | null;
  attachmentId: string | null;
  fileName: string;
  updatedAt: number;
  deleted: boolean;
};

export type NoteFields = {
  documentId: string;
  text: string;
  card: WorldPosition;
  createdAt: number;
  deleted: boolean;
};

type ConnectorFields = { documentId: string; from: string; to: string; deleted: boolean };

export type CellValue = string | number | boolean | null;

export type TableFields = { name: string; createdAt: number } & { [column: `column:${string}`]: ColumnFields };

export type RowFields = { tableId: string; order: string; deleted: boolean } & { [cell: `cell:${string}`]: CellValue };

type AttachmentState = "waiting" | "stored" | "refused";
type RefusalReason = "large" | "full";

type AttachmentFields = {
  documentId: string;
  name: string;
  size: number;
  contentType: string;
  state: AttachmentState;
  refusal: RefusalReason | null;
};

export type RecordFields = {
  document: DocumentFields;
  block: BlockFields;
  note: NoteFields;
  connector: ConnectorFields;
  table: TableFields;
  row: RowFields;
  attachment: AttachmentFields;
};

/** What this device knows about a record's standing with the account. */
export type SyncMeta = {
  versions: Record<string, number>;
  dirty: Record<string, ChangeMode>;
  bothKept: Record<string, FieldValue[]>;
  uploading: boolean;
};

export type WorkspaceRecord<K extends RecordKind = RecordKind> = {
  [Kind in K]: { kind: Kind; id: string; fields: RecordFields[Kind]; sync: SyncMeta };
}[K];

export type Column = ColumnFields & { id: string };

export const recordKey = (kind: RecordKind, id: string): string => `${kind}/${id}`;
