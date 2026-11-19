import type { GroupJson, ListJson } from "../../../server/lists.js";
import type { SummaryJson } from "../../../server/records.js";
import { fieldSpec, TABLE_FIELDS, tableOfNumber, type FieldSpec } from "../../../shared/fields.js";
import { CREATABLE_TABLES } from "../../../shared/record-rules.js";
import { TABLES, type Table } from "../../../shared/types.js";
import type { ReceivedSla } from "../../lib/sla.js";

export type { GroupJson, ListJson };

export interface SavedFilter {
  id: number;
  name: string;
  table: Table;
  filter: string;
  shared: boolean;
}

export const DEFAULT_QUEUE = "Open incidents";

export const TABLE_PLURALS: Record<Table, string> = {
  incident: "Incidents",
  problem: "Problems",
  change: "Changes",
  request_item: "Request items",
  task: "Tasks",
};

/** One grid row: the server summary plus the SLA it shows, stamped with the browser clock at receipt. */
export interface Row {
  summary: SummaryJson;
  sla: ReceivedSla | null;
}

function slaOf(summary: SummaryJson, receivedAt: number): ReceivedSla | null {
  const shown = summary.sla;
  if (!shown) return null;
  return {
    receivedAt,
    sla: { id: 0, definition: "", priority: summary.priority ?? 0, start_at: shown.server_time, target_seconds: 0, elapsed_seconds: 0, paused_seconds: 0, ...shown },
  };
}

export function rowOf(summary: SummaryJson, receivedAt: number): Row {
  return { summary, sla: slaOf(summary, receivedAt) };
}

/** The display name the server wrote into the row label, or the username when the label has none. */
export function assigneeOf(summary: SummaryJson): string | null {
  if (!summary.assigned_to) return null;
  const found = /, assigned to (.*), (?:SLA \d+ percent|no SLA)$/.exec(summary.label);
  return found?.[1] ?? summary.assigned_to;
}

export interface Column {
  key: string;
  label: string;
  /** The record field behind the column; null for the SLA column. */
  field: string | null;
  /** Minimum width in rem. */
  width: number;
  /** Not one of the six standard columns. */
  extra: boolean;
}

const BASE_KEYS = ["number", "short_description", "priority", "state", "assigned_to", "sla"];
const EDITABLE_KEYS = ["short_description", "assigned_to", "impact", "urgency"];

function descriptionField(table: Table): string {
  return table === "change" ? "title" : "short_description";
}

export function columnsFor(table: Table): Column[] {
  const base: Column[] = [
    { key: "number", label: "Number", field: "number", width: 6.2, extra: false },
    { key: "short_description", label: "Short description", field: descriptionField(table), width: 5.5, extra: false },
    { key: "priority", label: "Priority", field: "priority", width: 3.7, extra: false },
    { key: "state", label: "State", field: "state", width: 5.9, extra: false },
    { key: "assigned_to", label: "Assigned to", field: "assigned_to", width: 4.8, extra: false },
    { key: "sla", label: "SLA", field: null, width: 5.6, extra: false },
  ];
  const skipped = new Set([...BASE_KEYS, descriptionField(table)]);
  const extras = TABLE_FIELDS[table]
    .filter((spec) => !skipped.has(spec.name) && spec.kind !== "long" && spec.kind !== "object")
    .map<Column>((spec) => ({ key: spec.name, label: spec.label, field: spec.name, width: spec.kind === "integer" || spec.kind === "boolean" ? 5 : 7, extra: true }));
  return [...base, ...extras];
}

export const DEFAULT_COLUMNS: readonly string[] = BASE_KEYS;

/** The field an F2 edit of this column changes, or null when the column is not editable. */
export function editableField(table: Table, column: Column): FieldSpec | null {
  if (!EDITABLE_KEYS.includes(column.key) || column.field === null) return null;
  const spec = fieldSpec(table, column.field);
  return spec && !spec.readOnly ? spec : null;
}

/** Fields a list can be grouped by. */
export function groupableFields(table: Table): FieldSpec[] {
  return TABLE_FIELDS[table].filter((spec) => spec.name !== "number" && (spec.kind === "integer" || spec.kind === "boolean" || spec.kind === "enum" || spec.kind === "reference"));
}

/** Fields a bulk update can set. */
export function bulkFields(table: Table): FieldSpec[] {
  return TABLE_FIELDS[table].filter((spec) => !spec.readOnly && spec.kind !== "object");
}

export interface View {
  table: Table | null;
  /** A saved queue, or a raw filter written in the address. */
  mode: "queue" | "raw";
  queueId: number | null;
  filter: string;
  group: string;
  page: number;
  record: string | null;
  /** The table of a record that has no number yet; the form for it is open. */
  newTable: Table | null;
  /** The list state comes from the remembered list, not from the address. */
  remembered: boolean;
}

const NEW_PREFIX = "/desk/records/new/";

/** The list that stays behind a new-record form: kept out of the address, so the form reads `/desk/records/new/<table>`. */
export type ListContext = Pick<View, "table" | "mode" | "queueId" | "filter" | "group" | "page">;

export function listContextOf(view: View): ListContext {
  const { table, mode, queueId, filter, group, page } = view;
  return { table, mode, queueId, filter, group, page };
}

/** Reads the workspace state from the address, and from the remembered list when the address names only a record or a new form. */
export function readView(path: string, search: URLSearchParams, behind: ListContext | null): View {
  const creating = path.startsWith(NEW_PREFIX) ? path.slice(NEW_PREFIX.length) : null;
  const newTable = CREATABLE_TABLES.find((t) => t === creating) ?? null;
  const record = creating === null && path.startsWith("/desk/records/") ? path.slice("/desk/records/".length) : null;
  const listed = path.startsWith("/desk/lists/") ? path.slice("/desk/lists/".length) : null;
  const named = listed ?? (creating !== null ? creating : record ? tableOfNumber(record) : "incident");
  const table = TABLES.find((t) => t === named) ?? null;
  const remembered = behind && (newTable !== null || (record !== null && [...search].length === 0 && behind.table === table)) ? behind : null;
  if (remembered) return { ...remembered, record, newTable, remembered: true };
  const queueId = Number(search.get("queue")) || null;
  const raw = listed !== null || search.has("filter") || (table !== "incident" && table !== null);
  return {
    table,
    mode: raw ? "raw" : "queue",
    queueId: raw ? null : queueId,
    filter: search.get("filter") ?? "",
    group: search.get("group") ?? "",
    page: Math.max(1, Math.floor(Number(search.get("page")) || 1)),
    record,
    newTable,
    remembered: false,
  };
}

/** The address of a workspace state. */
export function urlFor(view: View): string {
  if (view.newTable) return `${NEW_PREFIX}${view.newTable}`;
  const params = new URLSearchParams();
  if (view.mode === "queue") {
    if (view.queueId !== null) params.set("queue", String(view.queueId));
  } else params.set("filter", view.filter);
  if (view.group) params.set("group", view.group);
  if (view.page > 1) params.set("page", String(view.page));
  const path = view.record ? `/desk/records/${view.record}` : view.mode === "queue" ? "/desk" : `/desk/lists/${view.table}`;
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
