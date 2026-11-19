import { refuse } from './errors.js';
import { edgesFrom, hasPort, nodeOf, reachable } from './graph.js';
import { isObject, visibleLength, type JsonObject } from './json.js';
import {
  GRID_COLUMNS,
  GRID_ROWS,
  STEP_LABEL,
  TRIGGER_CELL,
  TRIGGER_LABEL,
  defaultFields,
  isStepKind,
  type TriggerKind,
} from './kinds.js';
import { msg } from './messages.js';
import type { Content, Draft, Edge, StepNode } from './model.js';

export const NAME_LIMIT = 60;

export function emptyDraft(kind: TriggerKind): Draft {
  return {
    trigger: { id: 'trigger', kind, name: TRIGGER_LABEL[kind], ...TRIGGER_CELL, fields: defaultFields(kind), sample: {} },
    steps: [],
    edges: [],
    stepSeq: 0,
    edgeSeq: 0,
    kindSeq: {},
    graveyard: {},
  };
}

/** A draft built from complete content: ids and cells as given, counters continuing after them. */
export function draftFromContent(content: Content): Draft {
  const kindSeq: Record<string, number> = {};
  for (const step of content.steps) kindSeq[step.kind] = (kindSeq[step.kind] ?? 0) + 1;
  const numeric = (ids: string[]) => ids.reduce((top, id) => Math.max(top, Number(id.slice(1)) || 0), 0);
  return {
    ...structuredClone(content),
    stepSeq: numeric(content.steps.map((step) => step.id)),
    edgeSeq: content.edges.length,
    kindSeq,
    graveyard: {},
  };
}

export function contentOf(draft: Content): Content {
  return { trigger: draft.trigger, steps: draft.steps, edges: draft.edges };
}

export function checkName(name: string): void {
  if (visibleLength(name) > NAME_LIMIT) throw refuse.invalid(msg.nameTooLong);
}

function inGrid(col: unknown, row: unknown): col is number {
  return (
    typeof col === 'number' && typeof row === 'number' && Number.isInteger(col) && Number.isInteger(row) &&
    col >= 1 && col <= GRID_COLUMNS && row >= 1 && row <= GRID_ROWS
  );
}

function cellTaken(draft: Content, col: number, row: number, except?: string): boolean {
  return [draft.trigger, ...draft.steps].some((node) => node.id !== except && node.col === col && node.row === row);
}

export function addStep(draft: Draft, input: JsonObject): StepNode {
  const { kind, col, row, id } = input;
  if (!inGrid(col, row)) throw refuse.invalid(msg.cellOutside);
  if (cellTaken(draft, col, row as number)) throw refuse.conflict(msg.cellTaken);
  if (!isStepKind(kind)) throw refuse.invalid(msg.unknownKind(String(kind)));
  const restored = typeof id === 'string' ? draft.graveyard[id] : undefined;
  if (restored !== undefined) {
    delete draft.graveyard[restored.id];
    const step: StepNode = { ...restored, col, row: row as number };
    draft.steps.push(step);
    return step;
  }
  draft.stepSeq += 1;
  draft.kindSeq[kind] = (draft.kindSeq[kind] ?? 0) + 1;
  const step: StepNode = {
    id: `s${draft.stepSeq}`,
    kind,
    name: `${STEP_LABEL[kind]} ${draft.kindSeq[kind]}`,
    col,
    row: row as number,
    fields: defaultFields(kind),
  };
  draft.steps.push(step);
  return step;
}

/** True when a save touches what an edit hold protects (a move does not). */
export function touchesContent(input: JsonObject): boolean {
  return 'name' in input || 'fields' in input || 'sample' in input;
}

export function updateStep(draft: Draft, stepId: string, input: JsonObject): void {
  const node = nodeOf(draft, stepId);
  if (node === undefined) throw refuse.notFound();
  const moved = 'col' in input || 'row' in input;
  const col = 'col' in input ? input.col : node.col;
  const row = 'row' in input ? input.row : node.row;
  if (moved && inGrid(col, row) && cellTaken(draft, col, row as number, node.id)) throw refuse.conflict(msg.cellTaken);
  if (moved && !inGrid(col, row)) throw refuse.invalid(msg.cellOutside);
  if ('name' in input) {
    if (typeof input.name !== 'string' || input.name.trim() === '') throw refuse.invalid(msg.nameRequired);
    checkName(input.name);
  }
  if ('sample' in input && node.id === 'trigger' && !isObject(input.sample)) throw refuse.invalid(msg.sampleNotObject);
  if ('fields' in input && !isObject(input.fields)) throw refuse.invalid(msg.fieldsNotObject);
  if (typeof input.name === 'string') node.name = input.name;
  if (isObject(input.fields)) node.fields = { ...node.fields, ...input.fields };
  if (node.id === 'trigger' && isObject(input.sample)) draft.trigger.sample = input.sample;
  if (moved) {
    node.col = col as number;
    node.row = row as number;
  }
}

function renumber(draft: Content, from: string, port: string): void {
  edgesFrom(draft, from, port).forEach((edge, index) => {
    edge.order = index + 1;
  });
}

export function removeStep(draft: Draft, stepId: string): void {
  if (stepId === 'trigger') throw refuse.invalid(msg.triggerNotDeletable);
  const step = draft.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw refuse.notFound();
  const lost = draft.edges.filter((edge) => edge.to === stepId);
  draft.graveyard[stepId] = step;
  draft.steps = draft.steps.filter((candidate) => candidate.id !== stepId);
  draft.edges = draft.edges.filter((edge) => edge.from !== stepId && edge.to !== stepId);
  for (const edge of lost) renumber(draft, edge.from, edge.port);
}

/** The five edge refusals, checked in the order the brief lists them. */
export function addEdge(draft: Draft, input: JsonObject, order?: number): Edge {
  const from = String(input.from);
  const to = String(input.to);
  const port = String(input.port);
  if (nodeOf(draft, from) === undefined) throw refuse.invalid(msg.unknownStep(from));
  if (nodeOf(draft, to) === undefined) throw refuse.invalid(msg.unknownStep(to));
  if (to === 'trigger') throw refuse.invalid(msg.triggerIncoming);
  if (!hasPort(draft, from, port)) throw refuse.invalid(msg.noPort(from, port));
  if (from === to || reachable(draft, [to]).has(from)) throw refuse.invalid(msg.cycle(to));
  if (draft.edges.some((edge) => edge.to === to)) throw refuse.invalid(msg.secondIncoming(to));
  draft.edgeSeq += 1;
  const edge: Edge = {
    id: `e${draft.edgeSeq}`,
    from,
    port,
    to,
    order: order ?? edgesFrom(draft, from, port).reduce((top, other) => Math.max(top, other.order), 0) + 1,
  };
  draft.edges.push(edge);
  return edge;
}

export function removeEdge(draft: Draft, edgeId: string): Edge {
  const edge = draft.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined) throw refuse.notFound();
  draft.edges = draft.edges.filter((candidate) => candidate.id !== edgeId);
  renumber(draft, edge.from, edge.port);
  return edge;
}
