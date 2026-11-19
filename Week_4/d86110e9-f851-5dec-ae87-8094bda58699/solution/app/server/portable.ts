import { addEdge, checkName, draftFromContent, NAME_LIMIT } from './draft.js';
import { ApiError, refuse } from './errors.js';
import { depthOf, isObject, visibleLength, type Json, type JsonObject } from './json.js';
import { GRID_COLUMNS, GRID_ROWS, TRIGGER_LABEL, isStepKind, isTriggerKind } from './kinds.js';
import { msg } from './messages.js';
import type { Content, Draft, StepNode } from './model.js';

const FORMAT = 'switchyard-automation';

/** The export file: the version's content under the published keys, with no timestamps, so repeated exports are identical. */
export function exportBytes(name: string, content: Content): Buffer {
  const { trigger, steps, edges } = content;
  const file = {
    format: FORMAT,
    format_version: 1,
    name,
    trigger: { kind: trigger.kind, col: trigger.col, row: trigger.row, fields: trigger.fields, sample: trigger.sample },
    steps: steps.map((step) => ({ id: step.id, kind: step.kind, name: step.name, col: step.col, row: step.row, fields: step.fields })),
    edges: edges.map((edge) => ({ from: edge.from, port: edge.port, to: edge.to, order: edge.order })),
  };
  return Buffer.from(JSON.stringify(file), 'utf8');
}

const notAutomation = (): ApiError => refuse.invalid(msg.importNotAutomation);

function structured(value: Json): { name: string; trigger: JsonObject; steps: JsonObject[]; edges: JsonObject[] } {
  if (!isObject(value) || value.format !== FORMAT || value.format_version !== 1) throw notAutomation();
  const { name, trigger, steps, edges } = value;
  if (typeof name !== 'string' || !isObject(trigger) || !Array.isArray(steps) || !Array.isArray(edges)) throw notAutomation();
  if (!steps.every(isObject) || !edges.every(isObject) || !isObject(trigger.fields) || !isObject(trigger.sample)) throw notAutomation();
  if (visibleLength(name) > NAME_LIMIT || name.trim() === '') throw notAutomation();
  return { name, trigger, steps: steps as JsonObject[], edges: edges as JsonObject[] };
}

const cellOk = (col: unknown, row: unknown): boolean =>
  Number.isInteger(col) && Number.isInteger(row) && (col as number) >= 1 && (col as number) <= GRID_COLUMNS && (row as number) >= 1 && (row as number) <= GRID_ROWS;

/** Reads an uploaded file into a draft, refusing it in the brief's order: JSON, format, node kinds, cells, edges. */
export function importDraft(raw: Buffer): { name: string; draft: Draft } {
  let parsed: Json;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as Json;
  } catch {
    throw refuse.invalid(msg.importNotJson);
  }
  if (depthOf(parsed) > 20) throw refuse.invalid(msg.tooDeep);
  const { name, trigger, steps, edges } = structured(parsed);
  if (!isTriggerKind(trigger.kind)) throw refuse.invalid(msg.unknownKind(String(trigger.kind)));
  const unknown = steps.find((step) => !isStepKind(step.kind));
  if (unknown !== undefined) throw refuse.invalid(msg.unknownKind(String(unknown.kind)));
  const nodes = [trigger, ...steps];
  const cells = new Set(nodes.map((node) => `${String(node.col)},${String(node.row)}`));
  const ids = new Set(steps.map((step) => step.id));
  const wellFormed =
    nodes.every((node) => cellOk(node.col, node.row)) && cells.size === nodes.length && ids.size === steps.length &&
    steps.every((step) => typeof step.id === 'string' && /^s\d+$/.test(step.id) && typeof step.name === 'string' && isObject(step.fields)) &&
    edges.every((edge) => typeof edge.order === 'number');
  if (!wellFormed) throw notAutomation();
  steps.forEach((step) => checkName(step.name as string));
  const draft = draftFromContent({
    trigger: { id: 'trigger', kind: trigger.kind, name: TRIGGER_LABEL[trigger.kind], col: trigger.col as number, row: trigger.row as number, fields: trigger.fields as JsonObject, sample: trigger.sample as JsonObject },
    steps: steps as unknown as StepNode[],
    edges: [],
  });
  for (const edge of edges) addEdge(draft, edge, edge.order as number);
  return { name, draft };
}
