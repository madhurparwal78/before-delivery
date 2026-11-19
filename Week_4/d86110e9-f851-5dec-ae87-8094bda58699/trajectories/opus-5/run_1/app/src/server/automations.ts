import { config } from './config';
import { one, query } from './db';
import { ApiError, badRequest, messages } from './errors';
import { parseSchedule } from './schedule';
import { isOperator, needsRight } from './engine/conditions';
import { isObject, isPath, parseDecimal } from './util';
import {
  GRID_COLS,
  GRID_ROWS,
  KIND_LABELS,
  PORTS,
  STEP_KINDS,
  TRIGGER_KINDS,
  TRIGGER_LABELS,
  type AutomationContent,
  type AutomationDetail,
  type Edge,
  type JsonObject,
  type JsonValue,
  type NodeKind,
  type StepKind,
  type StepNode,
  type TriggerKind,
} from '../shared/types';

export interface AutomationRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_kind: TriggerKind;
  revision: number;
  live_version: number | null;
  draft: AutomationContent;
  step_seq: number;
  edge_seq: number;
  kind_counts: Record<string, number>;
  run_seq: number;
}

export function isTriggerKind(kind: string): kind is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(kind);
}

export function isStepKind(kind: string): kind is StepKind {
  return (STEP_KINDS as readonly string[]).includes(kind);
}

export function defaultContent(triggerKind: TriggerKind): AutomationContent {
  return {
    trigger: {
      id: 'trigger',
      kind: triggerKind,
      name: TRIGGER_LABELS[triggerKind],
      col: 1,
      row: 2,
      fields: defaultTriggerFields(triggerKind),
      sample: {},
    },
    steps: [],
    edges: [],
  };
}

function defaultTriggerFields(triggerKind: TriggerKind): JsonObject {
  switch (triggerKind) {
    case 'form':
      return { path: '', form_fields: [] };
    case 'schedule':
      return { schedule: '' };
    case 'webhook':
      return { path: '' };
    case 'row_added':
      return { table: '' };
    case 'manual':
      return {};
  }
}

export function defaultStepFields(kind: StepKind): JsonObject {
  switch (kind) {
    case 'set':
      return { values: {} };
    case 'filter':
    case 'branch':
      return { left: '', operator: 'equals', right: '' };
    case 'loop':
      return { source: 'list', list: '', table: '' };
    case 'wait':
      return { seconds: 60 };
    case 'send_email':
      return { to: '', subject: '', body: '' };
    case 'add_row':
      return { table: '', values: {} };
    case 'update_row':
      return { table: '', row_id: '', values: {} };
    case 'call_webhook':
      return { url: '', body: {} };
  }
}

export function nodesOf(content: AutomationContent): (StepNode | AutomationContent['trigger'])[] {
  return [content.trigger, ...content.steps];
}

export function findNode(
  content: AutomationContent,
  id: string,
): StepNode | AutomationContent['trigger'] | undefined {
  if (id === 'trigger') return content.trigger;
  return content.steps.find((step) => step.id === id);
}

export function edgesOf(content: AutomationContent, from: string, port: string): Edge[] {
  return content.edges
    .filter((edge) => edge.from === from && edge.port === port)
    .sort((a, b) => a.order - b.order);
}

function hasPort(kind: NodeKind, port: string): boolean {
  return PORTS[kind].includes(port);
}

export function stepNumber(id: string): number {
  const match = /^s(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

export async function loadAutomation(workspaceId: string, automationId: string): Promise<AutomationRow | null> {
  return one<AutomationRow>('select * from automations where id = $1 and workspace_id = $2', [
    automationId,
    workspaceId,
  ]);
}

export async function drainCount(automationId: string): Promise<number> {
  const row = await one<{ count: string }>(
    `select count(*)::int as count from runs r
      join automations a on a.id = r.automation_id
      where r.automation_id = $1 and r.test = false and r.version is not null
        and a.live_version is not null and r.version < a.live_version
        and r.status in ('queued','running','waiting')`,
    [automationId],
  );
  return row ? Number(row.count) : 0;
}

export async function nextRunAt(automationId: string): Promise<string | null> {
  const row = await one<{ next_at: Date }>('select next_at from schedule_claims where automation_id = $1', [
    automationId,
  ]);
  return row ? row.next_at.toISOString() : null;
}

export async function automationDetail(automation: AutomationRow): Promise<AutomationDetail> {
  return {
    id: automation.id,
    name: automation.name,
    trigger_kind: automation.trigger_kind,
    revision: automation.revision,
    live_version: automation.live_version,
    drain_count: await drainCount(automation.id),
    next_run_at: await nextRunAt(automation.id),
    trigger: automation.draft.trigger,
    steps: automation.draft.steps,
    edges: automation.draft.edges,
  };
}

export function nextStepName(automation: AutomationRow, kind: StepKind): string {
  const count = (automation.kind_counts[kind] ?? 0) + 1;
  return `${KIND_LABELS[kind]} ${count}`;
}

export function cellTaken(content: AutomationContent, col: number, row: number, exceptId?: string): boolean {
  return nodesOf(content).some((node) => node.col === col && node.row === row && node.id !== exceptId);
}

export function cellInsideGrid(col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 1 && col <= GRID_COLS && row >= 1 && row <= GRID_ROWS;
}

export async function saveDraft(automation: AutomationRow): Promise<number> {
  const revision = automation.revision + 1;
  await query(
    'update automations set draft = $2, revision = $3, step_seq = $4, edge_seq = $5, kind_counts = $6 where id = $1',
    [
      automation.id,
      JSON.stringify(automation.draft),
      revision,
      automation.step_seq,
      automation.edge_seq,
      JSON.stringify(automation.kind_counts),
    ],
  );
  automation.revision = revision;
  return revision;
}

/** Edge refusals, checked in the published order. */
export function checkEdge(content: AutomationContent, from: string, port: string, to: string): void {
  const source = findNode(content, from);
  const target = findNode(content, to);
  if (source === undefined) throw badRequest(messages.unknownStep(from));
  if (target === undefined) throw badRequest(messages.unknownStep(to));
  if (to === 'trigger') throw badRequest(messages.triggerIncoming);
  if (!hasPort(source.kind, port)) throw badRequest(messages.noPort(from, port));
  if (reaches(content, to, from)) throw badRequest(messages.cycle(to));
  if (content.edges.some((edge) => edge.to === to)) throw badRequest(messages.alreadyIncoming(to));
}

function reaches(content: AutomationContent, from: string, target: string): boolean {
  if (from === target) return true;
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of content.edges.filter((item) => item.from === current)) {
      if (edge.to === target) return true;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
}

function connectedToTrigger(content: AutomationContent): Set<string> {
  const reachable = new Set<string>(['trigger']);
  const queue = ['trigger'];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of content.edges.filter((item) => item.from === current)) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return reachable;
}

function insideLoopBody(content: AutomationContent, stepId: string): boolean {
  for (const loop of content.steps.filter((step) => step.kind === 'loop')) {
    for (const edge of edgesOf(content, loop.id, 'each')) {
      if (reaches(content, edge.to, stepId)) return true;
    }
  }
  return false;
}

export function stepsInsideLoops(content: AutomationContent): Set<string> {
  const inside = new Set<string>();
  for (const step of content.steps) {
    if (insideLoopBody(content, step.id)) inside.add(step.id);
  }
  return inside;
}

function emptyText(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function requiredFieldFailure(node: StepNode | AutomationContent['trigger']): string | null {
  const fields = node.fields;
  switch (node.kind) {
    case 'form': {
      if (emptyText(fields.path)) return 'Form path';
      const formFields = fields.form_fields;
      if (!Array.isArray(formFields) || formFields.length === 0) return 'Form fields';
      return null;
    }
    case 'schedule':
      return emptyText(fields.schedule) ? 'Schedule' : null;
    case 'webhook':
      return emptyText(fields.path) ? 'Hook path' : null;
    case 'row_added':
      return emptyText(fields.table) ? 'Table' : null;
    case 'manual':
      return null;
    case 'set': {
      const values = fields.values;
      if (!isObject(values) || Object.keys(values).filter((name) => name.trim() !== '').length === 0) return 'Values';
      return null;
    }
    case 'filter':
    case 'branch': {
      if (emptyText(fields.left)) return 'Left';
      const operator = typeof fields.operator === 'string' ? fields.operator : '';
      if (needsRight(operator) && emptyText(fields.right)) return 'Right';
      return null;
    }
    case 'loop':
      return fields.source === 'table'
        ? emptyText(fields.table)
          ? 'Table'
          : null
        : emptyText(fields.list)
          ? 'List'
          : null;
    case 'wait':
      return emptyText(fields.seconds) ? 'Seconds' : null;
    case 'send_email': {
      if (emptyText(fields.to)) return 'To';
      if (emptyText(fields.subject)) return 'Subject';
      if (emptyText(fields.body)) return 'Body';
      return null;
    }
    case 'add_row':
      return emptyText(fields.table) ? 'Table' : null;
    case 'update_row': {
      if (emptyText(fields.table)) return 'Table';
      if (emptyText(fields.row_id)) return 'Row id';
      return null;
    }
    case 'call_webhook':
      return emptyText(fields.url) ? 'URL' : null;
    default:
      return null;
  }
}

function ownAddress(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith('/hooks/')) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const own = new URL(config.publicUrl);
  const ownPort = own.port === '' ? '80' : own.port;
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port;
  if (parsed.hostname === own.hostname && port === ownPort) return true;
  return (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && port === String(config.port);
}

interface LivePath {
  automation_id: string;
  kind: string;
  path: string;
}

async function livePaths(workspaceId: string, exceptAutomationId: string): Promise<LivePath[]> {
  const rows = await query<{ id: string; content: AutomationContent }>(
    `select a.id, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version
       where a.workspace_id = $1 and a.id <> $2`,
    [workspaceId, exceptAutomationId],
  );
  return rows
    .map((row) => ({
      automation_id: row.id,
      kind: row.content.trigger.kind,
      path: typeof row.content.trigger.fields.path === 'string' ? row.content.trigger.fields.path : '',
    }))
    .filter((item) => item.kind === 'form' || item.kind === 'webhook');
}

/** Publish refusals, in the published order over the trigger then s1, s2, ... */
export async function validateForPublish(
  content: AutomationContent,
  workspaceId: string,
  automationId: string,
): Promise<void> {
  const connected = connectedToTrigger(content);
  const ordered = [content.trigger, ...[...content.steps].sort((a, b) => stepNumber(a.id) - stepNumber(b.id))];
  const paths = await livePaths(workspaceId, automationId);
  for (const node of ordered) {
    const fail = (message: string): never => {
      throw new ApiError(422, message, { step_id: node.id });
    };
    if (!connected.has(node.id)) fail(messages.notConnected(node.id));
    const missing = requiredFieldFailure(node);
    if (missing !== null) fail(messages.needsValue(node.id, missing));
    if (node.id === 'trigger') {
      if (node.kind === 'schedule' && parseSchedule(node.fields.schedule) === null) fail(messages.badSchedule);
      if (node.kind === 'form' || node.kind === 'webhook') {
        const path = typeof node.fields.path === 'string' ? node.fields.path.trim() : '';
        const clash = paths.some((item) => item.kind === node.kind && item.path === path);
        if (!isPath(path) || clash) fail(messages.pathTaken);
      }
    }
    if (node.kind === 'wait') {
      const seconds =
        typeof node.fields.seconds === 'number'
          ? node.fields.seconds
          : parseDecimal(String(node.fields.seconds ?? ''));
      if (seconds === null || !Number.isInteger(seconds) || seconds < 1 || seconds > config.waitMaxSeconds) {
        fail(messages.waitRange(node.id));
      }
    }
    if (node.kind === 'call_webhook') {
      const url = typeof node.fields.url === 'string' ? node.fields.url : '';
      if (!ownAddress(url)) fail(messages.ownAddressOnly(node.id));
    }
    if (node.kind === 'loop' && insideLoopBody(content, node.id)) fail(messages.nestedLoop(node.id));
    if ((node.kind === 'filter' || node.kind === 'branch') && typeof node.fields.operator === 'string') {
      if (!isOperator(node.fields.operator)) fail(messages.needsValue(node.id, 'Operator'));
    }
  }
}

export function contentForImport(file: JsonObject): AutomationContent {
  const trigger = file.trigger;
  if (!isObject(trigger) || typeof trigger.kind !== 'string') throw badRequest(messages.importNotSwitchyard);
  if (!isTriggerKind(trigger.kind)) throw badRequest(messages.unknownNodeKind(trigger.kind));
  const rawSteps = Array.isArray(file.steps) ? file.steps : [];
  const steps: StepNode[] = [];
  for (const raw of rawSteps) {
    if (!isObject(raw) || typeof raw.kind !== 'string' || typeof raw.id !== 'string') {
      throw badRequest(messages.importNotSwitchyard);
    }
    if (!isStepKind(raw.kind)) throw badRequest(messages.unknownNodeKind(raw.kind));
    steps.push({
      id: raw.id,
      kind: raw.kind,
      name: typeof raw.name === 'string' ? raw.name : KIND_LABELS[raw.kind],
      col: typeof raw.col === 'number' ? raw.col : 1,
      row: typeof raw.row === 'number' ? raw.row : 1,
      fields: isObject(raw.fields) ? raw.fields : defaultStepFields(raw.kind),
    });
  }
  const content: AutomationContent = {
    trigger: {
      id: 'trigger',
      kind: trigger.kind,
      name: typeof trigger.name === 'string' ? trigger.name : TRIGGER_LABELS[trigger.kind],
      col: typeof trigger.col === 'number' ? trigger.col : 1,
      row: typeof trigger.row === 'number' ? trigger.row : 2,
      fields: isObject(trigger.fields) ? trigger.fields : defaultTriggerFields(trigger.kind),
      sample: isObject(trigger.sample) ? trigger.sample : {},
    },
    steps,
    edges: [],
  };
  const rawEdges = Array.isArray(file.edges) ? file.edges : [];
  let edgeSeq = 0;
  for (const raw of rawEdges) {
    if (!isObject(raw) || typeof raw.from !== 'string' || typeof raw.to !== 'string' || typeof raw.port !== 'string') {
      throw badRequest(messages.importNotSwitchyard);
    }
    checkEdge(content, raw.from, raw.port, raw.to);
    edgeSeq += 1;
    content.edges.push({
      id: `e${edgeSeq}`,
      from: raw.from,
      port: raw.port,
      to: raw.to,
      order: typeof raw.order === 'number' ? raw.order : edgesOf(content, raw.from, raw.port).length + 1,
    });
  }
  return content;
}

export function exportFile(name: string, content: AutomationContent): string {
  return JSON.stringify(
    {
      format: 'switchyard-automation',
      format_version: 1,
      name,
      trigger: {
        kind: content.trigger.kind,
        col: content.trigger.col,
        row: content.trigger.row,
        fields: content.trigger.fields,
        sample: content.trigger.sample,
      },
      steps: content.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        name: step.name,
        col: step.col,
        row: step.row,
        fields: step.fields,
      })),
      edges: content.edges.map((edge) => ({ from: edge.from, port: edge.port, to: edge.to, order: edge.order })),
    },
    null,
    2,
  );
}
