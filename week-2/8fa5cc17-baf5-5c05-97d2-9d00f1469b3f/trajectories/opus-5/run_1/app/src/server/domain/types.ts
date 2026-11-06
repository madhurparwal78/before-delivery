import { Tx } from '../db/pool';
import { FieldKind, isRealDate } from '../../shared/query';

export type FieldRecord = {
  id: string;
  typeId: string;
  name: string;
  kind: FieldKind;
  required: boolean;
  options: string[] | null;
  targetTypeId: string | null;
  position: number;
};

export type TypeRecord = {
  id: string;
  name: string;
  builtin: boolean;
  libraryRank: number;
  fields: FieldRecord[];
};

export const FIELD_KINDS: FieldKind[] = ['text', 'number', 'date', 'url', 'select', 'relation'];
export const TYPE_NAME_MAX_CHARS = 60;
export const TITLE_MAX_CHARS = 200;
export const TEXT_PROPERTY_MAX_CHARS = 2000;

export const MESSAGES = {
  typeName: 'Give the type a name.',
  typeNameTaken: 'A type with this name already exists.',
  fieldName: 'Give the field a name.',
  fieldNameDuplicate: 'Field names must be different.',
  fieldKind: 'Choose text, number, date, url, select or relation.',
  fieldOptions: 'Add at least one option.',
  fieldTarget: 'Choose the type this field links to.',
  title: 'Give the note a title.',
  dailyType: 'Daily notes are created from Today.',
  shareVisibility: 'Choose follow or never.',
  text: 'Use at most 2,000 characters.',
  number: 'Enter a number.',
  date: 'Use a real date as YYYY-MM-DD.',
  url: 'Use a web address starting with http or https.',
  select: 'Choose one of the options.',
  selfLink: "A note can't link to itself.",
  requiredField: 'This field is required.',
  unknownField: 'That field is not on this type.',
} as const;

export async function loadTypes(tx: Tx): Promise<TypeRecord[]> {
  const typeRows = await tx.query<{
    id: string;
    name: string;
    builtin: boolean;
    library_rank: number;
  }>('select id, name, builtin, library_rank from object_type order by library_rank asc, created_at asc');
  const fieldRows = await tx.query<{
    id: string;
    type_id: string;
    name: string;
    kind: string;
    required: boolean;
    options: string[] | null;
    target_type_id: string | null;
    position: number;
  }>(
    'select id, type_id, name, kind, required, options, target_type_id, position from type_field order by position asc',
  );
  return typeRows.map((row) => ({
    id: row.id,
    name: row.name,
    builtin: row.builtin,
    libraryRank: row.library_rank,
    fields: fieldRows
      .filter((field) => field.type_id === row.id)
      .map((field) => ({
        id: field.id,
        typeId: field.type_id,
        name: field.name,
        kind: field.kind as FieldKind,
        required: field.required,
        options: field.options,
        targetTypeId: field.target_type_id,
        position: field.position,
      })),
  }));
}

export function typeJson(type: TypeRecord): Record<string, unknown> {
  return {
    id: type.id,
    name: type.name,
    builtin: type.builtin,
    fields: type.fields.map((field) => ({
      name: field.name,
      kind: field.kind,
      required: field.required,
      options: field.options,
      target_type_id: field.targetTypeId,
    })),
  };
}

export function relationTargetMessage(targetTypeName: string): string {
  return `Choose a note of type ${targetTypeName}.`;
}

export type PropertyCheck = { ok: true; value: unknown } | { ok: false; message: string };

/** The one home of typed property validation. */
export function checkPropertyValue(
  field: FieldRecord,
  value: unknown,
  context: {
    objectId: string | null;
    targetTypeName: string | null;
    targetExists: (id: string) => boolean;
  },
): PropertyCheck {
  if (value === null || value === undefined) {
    if (field.required) return { ok: false, message: MESSAGES.requiredField };
    return { ok: true, value: null };
  }
  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string' || Array.from(value).length > TEXT_PROPERTY_MAX_CHARS) {
        return { ok: false, message: MESSAGES.text };
      }
      return { ok: true, value };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, message: MESSAGES.number };
      return { ok: true, value };
    }
    case 'date': {
      if (typeof value !== 'string' || !isRealDate(value)) return { ok: false, message: MESSAGES.date };
      return { ok: true, value };
    }
    case 'url': {
      if (typeof value !== 'string') return { ok: false, message: MESSAGES.url };
      if (!/^https?:\/\/[^\s]+$/i.test(value.trim())) return { ok: false, message: MESSAGES.url };
      return { ok: true, value: value.trim() };
    }
    case 'select': {
      if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
        return { ok: false, message: MESSAGES.select };
      }
      return { ok: true, value };
    }
    default: {
      if (typeof value !== 'string') {
        return { ok: false, message: relationTargetMessage(context.targetTypeName ?? '') };
      }
      if (context.objectId !== null && value === context.objectId) {
        return { ok: false, message: MESSAGES.selfLink };
      }
      if (!context.targetExists(value)) {
        return { ok: false, message: relationTargetMessage(context.targetTypeName ?? '') };
      }
      return { ok: true, value };
    }
  }
}
