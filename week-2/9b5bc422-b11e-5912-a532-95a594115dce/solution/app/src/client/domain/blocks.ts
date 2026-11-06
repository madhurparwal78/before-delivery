import type { BlockFields, BlockType, NoteFields } from "./types.ts";

const BLOCK_OPTIONS: { type: BlockType; label: string }[] = [
  { type: "paragraph", label: "Paragraph" },
  { type: "heading1", label: "Heading 1" },
  { type: "heading2", label: "Heading 2" },
  { type: "heading3", label: "Heading 3" },
  { type: "bulleted", label: "Bulleted list" },
  { type: "numbered", label: "Numbered list" },
  { type: "todo", label: "To-do" },
  { type: "quote", label: "Quote" },
  { type: "divider", label: "Divider" },
  { type: "image", label: "Image" },
  { type: "file", label: "File" },
  { type: "table", label: "Record table" },
];

const LABEL_LENGTH = 40;
const DEEPEST_INDENT = 2;

export const typeLabel = (type: BlockType): string => BLOCK_OPTIONS.find((option) => option.type === type)?.label ?? "";

export const isTextBlock = (type: BlockType): boolean => !["divider", "image", "file", "table"].includes(type);
export const isListBlock = (type: BlockType): boolean => ["bulleted", "numbered", "todo"].includes(type);

export function matchingOptions(query: string): typeof BLOCK_OPTIONS {
  const wanted = query.toLowerCase();
  return BLOCK_OPTIONS.filter((option) => option.label.toLowerCase().split(/\s+/).some((word) => word.startsWith(wanted)));
}

export const shortLabel = (text: string): string => text.slice(0, LABEL_LENGTH);

/** `<type label>: <label>`, with the published tails for the notch and the Both kept marker. */
export function blockName(typeName: string, label: string, flags: { notched: boolean; bothKept: boolean }): string {
  const head = label ? `${typeName}: ${shortLabel(label)}` : typeName;
  return `${head}${flags.notched ? ", not yet synced" : ""}${flags.bothKept ? ", Both kept" : ""}`;
}

export function blockLabel(block: BlockFields, tableName: string | undefined): string {
  if (block.type === "table") return tableName ?? "";
  if (block.type === "image" || block.type === "file") return block.fileName;
  return block.text;
}

export const noteLabel = (note: NoteFields): string => note.text;

/** Next indent for Tab: one level under the item above, to the deepest published level. */
export function indented(current: number, above: BlockFields | undefined): number {
  if (!above || !isListBlock(above.type)) return current;
  return Math.min(current + 1, above.indent + 1, DEEPEST_INDENT);
}

/** The number shown beside each numbered item, restarting per run and per level. */
export function listNumbers(blocks: readonly { id: string; fields: BlockFields }[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const counters = [0, 0, 0];
  for (const { id, fields } of blocks) {
    if (fields.type !== "numbered") {
      if (!isListBlock(fields.type)) counters.fill(0);
      continue;
    }
    const level = fields.indent;
    counters[level] = (counters[level] ?? 0) + 1;
    counters.fill(0, level + 1);
    numbers.set(id, counters[level] ?? 1);
  }
  return numbers;
}
