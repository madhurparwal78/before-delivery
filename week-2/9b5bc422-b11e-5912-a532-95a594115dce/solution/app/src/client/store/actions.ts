import type { ChangeMode, ColumnFields, FieldValue, RecordKind, WorldPosition } from "../../shared/sync.ts";
import { ATTACHMENT_LIMIT_BYTES } from "../../shared/limits.ts";
import { isListBlock } from "../domain/blocks.ts";
import { cardSlots } from "../domain/cardSlots.ts";
import { orderAt, orderBetween } from "../domain/order.ts";
import { untitledTableName } from "../domain/records.ts";
import { emptyBlock, emptyDocument, journalNoteId, journalNoteRecords } from "../domain/seed.ts";
import type { Template } from "../domain/templates.ts";
import type { BlockFields, BlockType, CellValue, DocumentFields, RecordFields, RowFields, TableFields, WorkspaceRecord } from "../domain/types.ts";
import { recordKey } from "../domain/types.ts";
import { announce, showConfirmation } from "./announcer.ts";
import { removeFile, saveFile } from "./deviceStore.ts";
import { attachmentsOf, blocksOf, columnsOf, commit, connectorsOf, getRecord, newId, newRecord, notesOf, patched, rowsOf, stamp, tables } from "./workspace.ts";
import { noteContentEdit } from "./saved.ts";

function update<K extends RecordKind>(kind: K, id: string, patch: Partial<RecordFields[K]>, mode: ChangeMode = "edit"): void {
  const record = getRecord(kind, id);
  if (record) commit([patched(record, patch, mode) as WorkspaceRecord]);
}

const editedBlock = (block: WorkspaceRecord<"block">, patch: Partial<BlockFields>): WorkspaceRecord =>
  patched(block, { ...patch, updatedAt: stamp() });

function createDocument(blocks: { type: BlockType; text: string }[], title: string): string {
  const id = newId();
  const now = stamp();
  const document = newRecord("document", id, { ...emptyDocument(now), title });
  commit([
    document,
    ...blocks.map((block, index) => newRecord("block", newId(), { ...emptyBlock(id, block.type, orderAt(index), now), text: block.text })),
  ]);
  noteContentEdit();
  return id;
}

export const newDocument = (): string => createDocument([{ type: "paragraph", text: "" }], "");
export const documentFromTemplate = (template: Template): string => createDocument(template.blocks, template.name);

export function setDocumentTitle(id: string, title: string): void {
  const document = getRecord("document", id);
  if (!document) return;
  commit([patched(document, { title, updatedAt: stamp() })]);
  noteContentEdit();
}

export const setDocumentDetails = (id: string, patch: Partial<Pick<DocumentFields, "folder" | "tags" | "starred">>): void => update("document", id, patch);

export function moveToTrash(id: string, title: string): void {
  update("document", id, { trashedAt: stamp() });
  showConfirmation(`Moved "${title}" to trash.`);
}

export function restoreDocument(id: string, title: string): void {
  update("document", id, { trashedAt: null });
  showConfirmation(`Restored "${title}".`);
}

/** Removes a document's records from the device, with their stored files. */
export function purgeDocument(id: string): string[] {
  const attachments = attachmentsOf(id);
  for (const attachment of attachments) void removeFile(attachment.id);
  return [...blocksOf(id), ...notesOf(id), ...connectorsOf(id), ...attachments].map((record) => recordKey(record.kind, record.id));
}

export function deleteForever(id: string, title: string): void {
  const document = getRecord("document", id);
  if (!document) return;
  const removed = purgeDocument(id);
  const fields: DocumentFields = { ...emptyDocument(0), deletedForever: true };
  commit([{ ...document, fields, sync: { ...document.sync, dirty: { deletedForever: "edit" } } }], removed);
  showConfirmation(`Deleted "${title}" forever.`);
}

export function setBlockText(id: string, text: string): void {
  const block = getRecord("block", id);
  if (!block) return;
  commit([editedBlock(block, { text })]);
  noteContentEdit();
}

export function setNoteText(id: string, text: string): void {
  update("note", id, { text });
  noteContentEdit();
}

export function setBlockChecked(id: string, checked: boolean): void {
  const block = getRecord("block", id);
  if (!block) return;
  commit([editedBlock(block, { checked })]);
  noteContentEdit();
}

export function setBlockIndent(id: string, indent: number): void {
  const block = getRecord("block", id);
  if (block) commit([editedBlock(block, { indent })]);
}

function orderAfter(blocks: readonly WorkspaceRecord<"block">[], position: number): string {
  return orderBetween(blocks[position]?.fields.order ?? "", blocks[position + 1]?.fields.order ?? "");
}

/** Enter: a new block after this one; in a list, a new item of the same type and indent. */
export function insertBlockAfter(block: WorkspaceRecord<"block">): string {
  const siblings = blocksOf(block.fields.documentId);
  const position = siblings.findIndex((sibling) => sibling.id === block.id);
  const list = isListBlock(block.fields.type);
  const id = newId();
  const fields: BlockFields = {
    ...emptyBlock(block.fields.documentId, list ? block.fields.type : "paragraph", orderAfter(siblings, position), stamp()),
    indent: list ? block.fields.indent : 0,
  };
  commit([newRecord("block", id, fields)]);
  noteContentEdit();
  return id;
}

export function deleteBlock(block: WorkspaceRecord<"block">): void {
  commit([editedBlock(block, { deleted: true })]);
  noteContentEdit();
}

/** Moves a block to `target` in page order; its card stays where it is. */
export function moveBlock(block: WorkspaceRecord<"block">, target: number): void {
  const others = blocksOf(block.fields.documentId).filter((sibling) => sibling.id !== block.id);
  const order = orderBetween(others[target - 1]?.fields.order ?? "", others[target]?.fields.order ?? "");
  commit([editedBlock(block, { order })]);
  noteContentEdit();
}

export function turnBlockInto(block: WorkspaceRecord<"block">, type: BlockType): string | null {
  const updated = editedBlock(block, { type, text: "", indent: isListBlock(type) ? block.fields.indent : 0 });
  if (type !== "divider" && type !== "table") {
    commit([updated]);
    noteContentEdit();
    return null;
  }
  const siblings = blocksOf(block.fields.documentId);
  const position = siblings.findIndex((sibling) => sibling.id === block.id);
  const nextId = newId();
  const paragraph = newRecord("block", nextId, emptyBlock(block.fields.documentId, "paragraph", orderAfter(siblings, position), stamp()));
  const made: WorkspaceRecord[] = [paragraph];
  if (type === "table") {
    const tableId = newId();
    made.push(newTableRecord(tableId), patched(updated as WorkspaceRecord<"block">, { tableId }));
  } else made.push(updated);
  commit(made);
  noteContentEdit();
  return nextId;
}

/** Fills empty card positions by the Card slot rule. A slot is not a content change. */
export function assignCardSlots(documentId: string): void {
  const blocks = blocksOf(documentId);
  const empty = blocks.filter((block) => block.fields.card === null);
  if (!empty.length) return;
  const positioned = [...blocks, ...notesOf(documentId)].flatMap((record) => record.fields.card ?? []);
  const slots = cardSlots(positioned, empty.length);
  commit(empty.map((block, index) => patched(block, { card: slots[index] ?? null }, "slot")));
}

export function moveCard(card: WorkspaceRecord<"block"> | WorkspaceRecord<"note">, position: WorldPosition): void {
  update(card.kind, card.id, { card: position });
}

export function newNote(documentId: string, card: WorldPosition): string {
  const id = newId();
  commit([newRecord("note", id, { documentId, text: "", card, createdAt: stamp(), deleted: false })]);
  return id;
}

export const deleteNote = (id: string): void => update("note", id, { deleted: true });

/** Connects two cards, or removes the connector when the pair is already joined. Answers whether it now exists. */
export function toggleConnector(documentId: string, from: string, to: string): boolean {
  const joined = connectorsOf(documentId).find((connector) =>
    (connector.fields.from === from && connector.fields.to === to) || (connector.fields.from === to && connector.fields.to === from));
  if (joined) {
    update("connector", joined.id, { deleted: true });
    return false;
  }
  commit([newRecord("connector", newId(), { documentId, from, to, deleted: false })]);
  return true;
}

export function chooseVersion(kind: RecordKind, id: string, field: string, value: FieldValue): void {
  const record = getRecord(kind, id);
  if (!record) return;
  const bothKept = { ...record.sync.bothKept };
  delete bothKept[field];
  const chosen = patched(record, { [field]: value } as Partial<RecordFields[RecordKind]>, "pick");
  commit([{ ...chosen, sync: { ...chosen.sync, dirty: { ...chosen.sync.dirty, [field]: "pick" }, bothKept } }]);
}

function newTableRecord(id: string): WorkspaceRecord {
  const used = new Set(tables().map((table) => table.fields.name));
  const fields: TableFields = { name: untitledTableName(used), createdAt: stamp() };
  fields[`column:${newId()}`] = { name: "Name", type: "text", options: [], position: 0 };
  fields[`column:${newId()}`] = { name: "Amount", type: "number", options: [], position: 1 };
  return newRecord("table", id, fields);
}

export function newTable(): string {
  const id = newId();
  commit([newTableRecord(id)]);
  return id;
}

export const setTableName = (id: string, name: string): void => update("table", id, { name });

export function addColumn(table: WorkspaceRecord<"table">, column: Omit<ColumnFields, "position">): void {
  const position = columnsOf(table).length;
  update("table", table.id, { [`column:${newId()}`]: { ...column, position } });
}

export function addRow(tableId: string, cells: Record<string, CellValue>): string {
  const id = newId();
  commit([newRowRecord(id, tableId, rowsOf(tableId).at(-1)?.fields.order ?? "", cells)]);
  return id;
}

function newRowRecord(id: string, tableId: string, after: string, cells: Record<string, CellValue>): WorkspaceRecord {
  const fields: RowFields = { tableId, order: orderBetween(after, ""), deleted: false };
  for (const [column, value] of Object.entries(cells)) fields[`cell:${column}`] = value;
  return newRecord("row", id, fields);
}

export function appendRows(tableId: string, rows: readonly Record<string, CellValue>[]): void {
  let after = rowsOf(tableId).at(-1)?.fields.order ?? "";
  commit(rows.map((cells) => {
    const record = newRowRecord(newId(), tableId, after, cells);
    after = (record as WorkspaceRecord<"row">).fields.order;
    return record;
  }));
}

export function setCell(rowId: string, columnId: string, value: CellValue): void {
  update("row", rowId, { [`cell:${columnId}`]: value });
  noteContentEdit();
}

/** Today's or any day's note: created from `Daily note` the first time the day opens. */
export function openJournalNote(date: string): string {
  const id = journalNoteId(date);
  if (!getRecord("document", id)) commit(journalNoteRecords(date, stamp(), "create"));
  return id;
}

/** Attachment state moves: a file enters `waiting`, or `refused` when too large for the device to keep. */
export async function attachFile(block: WorkspaceRecord<"block">, file: File): Promise<void> {
  const id = newId();
  const refused = file.size > ATTACHMENT_LIMIT_BYTES;
  if (!refused) await saveFile(id, file);
  commit([
    newRecord("attachment", id, {
      documentId: block.fields.documentId,
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      state: refused ? "refused" : "waiting",
      refusal: refused ? "large" : null,
    }),
    editedBlock(block, { attachmentId: id, fileName: file.name }),
  ]);
  announce(refused ? `Refused ${file.name}.` : `${file.name} is waiting on this device.`);
}

/** Attachment state moves: the server's answer settles a waiting file; anything else leaves it waiting. */
export function settleAttachment(attachment: WorkspaceRecord<"attachment">, status: number): void {
  if (status === 200 || status === 201) {
    commit([patched(attachment, { state: "stored" })]);
    announce(`Stored ${attachment.fields.name}.`);
  } else if (status === 413 || status === 507) {
    commit([patched(attachment, { state: "refused", refusal: status === 413 ? "large" : "full" })]);
    announce(`Refused ${attachment.fields.name}.`);
  }
}
