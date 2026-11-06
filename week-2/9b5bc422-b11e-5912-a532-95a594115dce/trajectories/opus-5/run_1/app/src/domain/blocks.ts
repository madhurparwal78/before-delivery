import { BLOCK_TYPE_LABELS } from './copy.ts';
import { fieldValue, keepOrder } from './materialise.ts';
import type { BlockType, MergeField } from './types.ts';

const LABEL_LENGTH = 40;

export function textOf(field: MergeField<string>): string {
  return fieldValue(field, '');
}

export function blockLabel(options: {
  type: BlockType;
  text: MergeField<string>;
  fileName?: string | null;
  tableName?: string | null;
}): string {
  if (options.type === 'image' || options.type === 'file') return options.fileName ?? '';
  if (options.type === 'table') return options.tableName ?? '';
  const values = keepOrder(options.text.values);
  const text = values.length ? values[0].value : '';
  return text.slice(0, LABEL_LENGTH);
}

/** `<type label>: <label>`, then the notch and the marker. */
export function blockName(options: {
  type: BlockType;
  label: string;
  unsynced: boolean;
  bothKept: boolean;
}): string {
  const typeLabel = BLOCK_TYPE_LABELS[options.type];
  let name = options.label ? `${typeLabel}: ${options.label}` : typeLabel;
  if (options.unsynced) name += ', not yet synced';
  if (options.bothKept) name += ', Both kept';
  return name;
}

const TEXT_BLOCK_TYPES: BlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulleted',
  'numbered',
  'todo',
  'quote',
];

export function isTextBlock(type: BlockType): boolean {
  return TEXT_BLOCK_TYPES.includes(type);
}

export function isListBlock(type: BlockType): boolean {
  return type === 'bulleted' || type === 'numbered' || type === 'todo';
}


export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
