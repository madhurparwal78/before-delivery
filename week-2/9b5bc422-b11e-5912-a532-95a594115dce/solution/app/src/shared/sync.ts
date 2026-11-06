export type RecordKind = "document" | "block" | "note" | "connector" | "table" | "row" | "attachment";

export type WorldPosition = { x: number; y: number };

export type FieldValue = string | number | boolean | null | string[] | WorldPosition | ColumnFields;

export type ColumnType = "text" | "number" | "date" | "checkbox" | "select";

export type ColumnFields = {
  name: string;
  type: ColumnType;
  options: string[];
  position: number;
};

/** One field of one record as the account holds it. `bothKept` lists the values waiting for a choice. */
export type FieldState = {
  value: FieldValue;
  version: number;
  device: string;
  bothKept?: FieldValue[];
};

/**
 * How a device offers a field to the account:
 * `edit`, a person changed it; `create`, it only asks to exist (an unedited seed or template record);
 * `slot`, an automatic card position that only fills an empty one; `pick`, a Both kept choice.
 */
export type ChangeMode = "edit" | "create" | "slot" | "pick";

export type FieldChange = { value: FieldValue; base: number; mode: ChangeMode };

export type RecordChange = {
  kind: RecordKind;
  id: string;
  parentId: string | null;
  fields: Record<string, FieldChange>;
};

export type SyncRequest = {
  since: number;
  changes: RecordChange[];
  deletedForever: string[];
};

export type RecordState = {
  kind: RecordKind;
  id: string;
  fields: Record<string, FieldState>;
};

export type SyncResponse = {
  cursor: number;
  records: RecordState[];
  deletedForever: string[];
  more: boolean;
};
