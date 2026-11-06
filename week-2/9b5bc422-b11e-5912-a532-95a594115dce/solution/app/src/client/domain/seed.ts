import type { ChangeMode, RecordKind } from "../../shared/sync.ts";
import { orderAt } from "./order.ts";
import { DAILY_NOTE } from "./templates.ts";
import type { BlockFields, BlockType, DocumentFields, RecordFields, RowFields, SyncMeta, TableFields, WorkspaceRecord } from "./types.ts";

type SeedDocument = { id: string; title: string; folder?: string; tag: string; starred?: boolean };

const DOCUMENTS: SeedDocument[] = [
  { id: "seed-welcome", title: "Welcome to Oddment", tag: "guide", starred: true },
  { id: "seed-lisbon", title: "Trip to Lisbon", folder: "Plans", tag: "travel", starred: true },
  { id: "seed-shelf", title: "Kitchen shelf ideas", folder: "Plans", tag: "home" },
  { id: "seed-overview", title: "Household overview", tag: "home" },
  { id: "seed-note-05", title: "Library books to return", tag: "reading" },
  { id: "seed-note-06", title: "Birthday list", tag: "family" },
  { id: "seed-note-07", title: "Garden jobs", tag: "home" },
  { id: "seed-note-08", title: "Recipes to try", tag: "home" },
  { id: "seed-note-09", title: "Car notes", tag: "home" },
  { id: "seed-note-10", title: "Books I lent", tag: "reading" },
  { id: "seed-note-11", title: "Packing list", folder: "Plans", tag: "travel" },
  { id: "seed-note-12", title: "Questions for the dentist", tag: "family" },
];

type SeedBlock = { type: BlockType; text?: string; card?: [number, number]; indent?: number; checked?: boolean; tableId?: string };

const BLOCKS: Record<string, SeedBlock[]> = {
  "seed-welcome": [
    { type: "heading1", text: "Everything here lives on this device", card: [0, 0] },
    { type: "paragraph", text: "Write first and worry later. Each change is saved here before anything else happens.", card: [0, 140] },
    { type: "heading2", text: "Try these", card: [320, 0] },
    { type: "todo", text: "Switch this page to the canvas", card: [320, 140] },
    { type: "todo", text: "Open this document", card: [320, 280], checked: true },
    { type: "quote", text: "The table stays put. The blocks move.", card: [640, 0] },
    { type: "divider", card: [640, 180] },
    { type: "paragraph", text: "Sign in only if you want a second device.", card: [640, 320] },
  ],
  "seed-lisbon": [
    { type: "heading1", text: "Three days in Lisbon" },
    { type: "bulleted", text: "Tram 28 before nine" },
    { type: "bulleted", text: "Walk down through Alfama" },
    { type: "bulleted", text: "Stop at the viewpoint", indent: 1 },
    { type: "heading2", text: "Still to book" },
    { type: "todo", text: "Ferry to Cacilhas" },
    { type: "todo", text: "Room near the river", checked: true },
    { type: "quote", text: "Bring shoes with grip." },
  ],
  "seed-shelf": [
    { type: "paragraph", text: "Measure the alcove twice.", card: [0, 0] },
    { type: "heading2", text: "Options", card: [300, 100] },
    { type: "numbered", text: "Oak board on brackets" },
    { type: "numbered", text: "Steel rail with hooks" },
  ],
  "seed-overview": [
    { type: "paragraph", text: "Bills for the month, pulled from the table." },
    { type: "table", tableId: "seed-bills" },
  ],
  "seed-note-05": [{ type: "paragraph", text: "Two books are due back on Saturday." }],
  "seed-note-06": [{ type: "paragraph", text: "Ask what size the new gloves should be." }],
  "seed-note-07": [{ type: "paragraph", text: "Cut back the lavender before the first frost." }],
  "seed-note-08": [{ type: "paragraph", text: "Lentil soup with lemon, and the plum cake." }],
  "seed-note-09": [{ type: "paragraph", text: "Tyres were last rotated in the spring." }],
  "seed-note-10": [{ type: "paragraph", text: "The atlas is with the neighbours at number 12." }],
  "seed-note-11": [{ type: "paragraph", text: "Adapters, rain jacket, and the blue notebook." }],
  "seed-note-12": [{ type: "paragraph", text: "Ask about the crown on the upper left." }],
};

const BILLS: [string, number, string, boolean, string][] = [
  ["Electricity", 6420, "2026-11-03", false, "Home"],
  ["Water", 3175, "2026-11-05", true, "Home"],
  ["Broadband", 3900, "2026-11-07", false, "Home"],
  ["Library fine", 240, "2026-11-09", true, "Leisure"],
  ["Train pass", 8800, "2026-11-12", false, "Travel"],
  ["Gym", 2750, "2026-11-15", false, "Leisure"],
  ["Ferry tickets", 4610, "2026-11-21", false, "Travel"],
  ["Boiler service", 9500, "2026-11-28", false, "Home"],
];

/** Seed and template records start at version 1: the starting value both devices share. */
function atStartingVersion<K extends RecordKind>(fields: RecordFields[K], dirty: ChangeMode | null): SyncMeta {
  const names = Object.keys(fields);
  return {
    versions: Object.fromEntries(names.map((name) => [name, 1])),
    dirty: dirty ? Object.fromEntries(names.map((name) => [name, dirty])) : {},
    bothKept: {},
    uploading: false,
  };
}

const seedRecord = <K extends RecordKind>(kind: K, id: string, fields: RecordFields[K], dirty: ChangeMode | null): WorkspaceRecord =>
  ({ kind, id, fields, sync: atStartingVersion<K>(fields, dirty) }) as WorkspaceRecord;

export const emptyBlock = (documentId: string, type: BlockType, order: string, updatedAt: number): BlockFields => ({
  documentId,
  type,
  text: "",
  indent: 0,
  checked: false,
  order,
  card: null,
  tableId: null,
  attachmentId: null,
  fileName: "",
  updatedAt,
  deleted: false,
});

export const emptyDocument = (updatedAt: number): DocumentFields => ({
  title: "",
  folder: "",
  tags: [],
  starred: false,
  trashedAt: null,
  updatedAt,
  seedOrder: Number.MAX_SAFE_INTEGER,
  journalDate: null,
  deletedForever: false,
});

export const journalNoteId = (date: string): string => `journal-${date}`;

/** A note from `Daily note` with ids from its date, so two devices make the same records. */
export function journalNoteRecords(date: string, now: number, dirty: ChangeMode | null): WorkspaceRecord[] {
  const id = journalNoteId(date);
  const fields: DocumentFields = { ...emptyDocument(now), journalDate: date };
  return [
    seedRecord("document", id, fields, dirty),
    ...DAILY_NOTE.blocks.map((block, index) =>
      seedRecord("block", `${id}-${index + 1}`, { ...emptyBlock(id, block.type, orderAt(index), now), text: block.text }, dirty),
    ),
  ];
}

export function seedRecords(now: number, date: string): WorkspaceRecord[] {
  const records: WorkspaceRecord[] = [];
  DOCUMENTS.forEach((seed, seedOrder) => {
    const fields: DocumentFields = {
      ...emptyDocument(now),
      title: seed.title,
      folder: seed.folder ?? "",
      tags: [seed.tag],
      starred: seed.starred ?? false,
      seedOrder,
    };
    records.push(seedRecord("document", seed.id, fields, null));
    (BLOCKS[seed.id] ?? []).forEach((block, index) => {
      const fields: BlockFields = {
        ...emptyBlock(seed.id, block.type, orderAt(index), now),
        text: block.text ?? "",
        indent: block.indent ?? 0,
        checked: block.checked ?? false,
        card: block.card ? { x: block.card[0], y: block.card[1] } : null,
        tableId: block.tableId ?? null,
      };
      records.push(seedRecord("block", `${seed.id}-${index + 1}`, fields, null));
    });
  });
  records.push(
    seedRecord("note", "seed-welcome-note", { documentId: "seed-welcome", text: "This note is only on the canvas.", card: { x: 0, y: 320 }, createdAt: now, deleted: false }, null),
    seedRecord("connector", "seed-welcome-link", { documentId: "seed-welcome", from: "seed-welcome-2", to: "seed-welcome-4", deleted: false }, null),
  );
  const table: TableFields = {
    name: "Household bills",
    createdAt: now,
    "column:name": { name: "Name", type: "text", options: [], position: 0 },
    "column:amount": { name: "Amount", type: "number", options: [], position: 1 },
    "column:due": { name: "Due", type: "date", options: [], position: 2 },
    "column:paid": { name: "Paid", type: "checkbox", options: [], position: 3 },
    "column:category": { name: "Category", type: "select", options: ["Home", "Travel", "Leisure"], position: 4 },
  };
  records.push(seedRecord("table", "seed-bills", table, null));
  BILLS.forEach(([name, amount, due, paid, category], index) => {
    const fields: RowFields = {
      tableId: "seed-bills",
      order: orderAt(index),
      deleted: false,
      "cell:name": name,
      "cell:amount": amount,
      "cell:due": due,
      "cell:paid": paid,
      "cell:category": category,
    };
    records.push(seedRecord("row", `seed-bills-${index + 1}`, fields, null));
  });
  records.push(...journalNoteRecords(date, now, null));
  return records;
}
