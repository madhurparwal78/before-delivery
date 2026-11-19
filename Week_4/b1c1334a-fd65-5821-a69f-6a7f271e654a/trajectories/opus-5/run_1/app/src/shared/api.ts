export type ColumnType = 'text' | 'decimal' | 'date' | 'bool' | 'reference' | 'formula';
export type CellKind = 'decimal' | 'text' | 'date' | 'bool' | 'reference' | 'error' | 'blank';
export type Role = 'owner' | 'editor' | 'viewer';
export type RowScope = 'all' | 'own';
export type TableKind = 'table' | 'summary';

export type CellJson = {
  value: string | number | boolean | null;
  display: string;
  kind: CellKind;
  revision: number | null;
};

export type RowJson = {
  id: string;
  revision: number | null;
  cells: Record<string, CellJson>;
};

export type ColumnJson = {
  id: string;
  name: string;
  type: ColumnType;
  formula: string | null;
  target_table_id: string | null;
  position: number;
  revision: number;
};

export type TableJson = {
  id: string;
  name: string;
  kind: TableKind;
  revision: number;
  owner_column_id: string | null;
  columns: ColumnJson[];
  rows: RowJson[];
};

export type TableSummaryJson = {
  id: string;
  name: string;
  kind: TableKind;
  revision: number;
  row_count: number;
  column_count: number;
  source_table_id: string | null;
};

export type AccessJson = { role: Role; row_scope: RowScope };
export type StacksJson = { undo_count: number; redo_count: number };

export type RecalcCellJson = {
  table_id: string;
  row_id: string;
  column_id: string;
  old_display: string | null;
  new_display: string | null;
  new_kind: CellKind | null;
  depth: number;
};

export type RecalcJson = {
  cells: RecalcCellJson[];
  count: number;
  tables: number;
  sentence: string;
  row_counts: Record<string, number>;
  column_counts: Record<string, number>;
  stacks: StacksJson;
  access: AccessJson;
  document_revision: number;
};

export type DocumentListEntry = { id: string; name: string; role: Role };

export type DocumentJson = {
  id: string;
  name: string;
  role: Role;
  row_scope: RowScope;
  revision: number;
  undo_count: number;
  redo_count: number;
};

export type UserJson = { id: string; email: string; display_name: string };

export type ShareJson = {
  id: string;
  email: string;
  role: 'editor' | 'viewer';
  row_scope: RowScope;
  invite_status: 'sent' | 'not_sent';
};

export type ExportJson = {
  id: string;
  table_id: string;
  file_name: string;
  status: 'writing' | 'ready' | 'failed';
  byte_size: number | null;
  sha256: string | null;
  download_url: string | null;
  created_by: string;
  document_revision: number;
  created_at: string;
};

export type HistoryEntryJson = {
  revision: number;
  kind: string;
  actor_id: string;
  table_id: string | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current?: {
      value?: CellJson['value'];
      display?: string;
      revision?: number | null;
      row?: RowJson;
      column?: ColumnJson;
      table?: { id: string; name: string; revision: number };
    };
    conflicts?: Array<{
      row_id: string;
      column_id: string;
      current: { value: CellJson['value']; display: string; revision: number | null };
    }>;
    stacks?: StacksJson;
  };
};

export type TableReadJson = {
  table: TableJson;
  access: AccessJson;
  stacks: StacksJson;
  document_revision: number;
};

export type DocumentReadJson = {
  document: DocumentJson;
  tables: TableSummaryJson[];
};

export type PreviewJson = {
  display: string | null;
  kind: CellKind | null;
  diagnosis: string | null;
};

export type UndoneKind =
  | 'cell_write'
  | 'cell_batch'
  | 'row_add'
  | 'row_delete'
  | 'column_add'
  | 'column_update'
  | 'column_delete'
  | 'table_rename';
