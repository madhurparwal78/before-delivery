import { ApiError, refuse } from './errors.js';
import { config, ownAddresses } from './config.js';
import { loopBodyIds, nodes, numericId, reachable } from './graph.js';
import { isEmpty, isObject } from './json.js';
import { msg } from './messages.js';
import type { AnyNode, Content } from './model.js';
import { parseSchedule } from './schedule.js';

/** The control name each required field carries in the step settings, in the order they are checked. */
function required(node: AnyNode): Array<[label: string, present: boolean]> {
  const f = node.fields;
  const filled = (key: string) => !isEmpty(f[key]);
  switch (node.kind) {
    case 'form':
      return [['Form path', filled('path')], ['Form fields', filled('form_fields')]];
    case 'schedule':
      return [['Schedule', filled('schedule')]];
    case 'webhook':
      return [['Hook path', filled('path')]];
    case 'row_added':
      return [['Table', filled('table')]];
    case 'manual':
      return [];
    case 'set':
      return [['Values', isObject(f.values) && Object.keys(f.values).some((name) => name.trim() !== '')]];
    case 'filter':
    case 'branch':
      return [['Left', filled('left')], ['Right', filled('right') || f.operator === 'is empty' || f.operator === 'is not empty']];
    case 'loop':
      return f.source === 'table' ? [['Table', filled('table')]] : [['List', filled('list')]];
    case 'wait':
      return [['Seconds', filled('seconds')]];
    case 'send_email':
      return [['To', filled('to')], ['Subject', filled('subject')], ['Body', filled('body')]];
    case 'add_row':
      return [['Table', filled('table')]];
    case 'update_row':
      return [['Table', filled('table')], ['Row id', filled('row_id')]];
    case 'call_webhook':
      return [['URL', filled('url')]];
  }
}

export function ownAddress(url: string): boolean {
  if (url.startsWith('/hooks/')) return true;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && ownAddresses.has(`${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`);
  } catch {
    return false;
  }
}

/** A wait step's seconds as a number within 1 and WAIT_MAX_SECONDS, or null when the value is not one. */
export function waitSeconds(value: unknown): number | null {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 1 && seconds <= config.waitMaxSeconds ? seconds : null;
}

const PATH_FORMAT = /^[a-z0-9-]+$/;

/** The first publish refusal over trigger, s1, s2, ..., each step checked in the brief's order; null when the draft may go live. */
export async function firstRefusal(content: Content, pathTaken: (kind: 'form' | 'webhook', path: string) => Promise<boolean>): Promise<ApiError | null> {
  const connected = reachable(content, ['trigger']);
  const inLoop = loopBodyIds(content);
  const ordered = nodes(content).sort((a, b) => numericId(a.id) - numericId(b.id));
  for (const node of ordered) {
    const refusal = (message: string) => refuse.invalid(message, { step_id: node.id });
    if (!connected.has(node.id)) return refusal(msg.notConnected(node.id));
    const missing = required(node).find(([, present]) => !present);
    if (missing) return refusal(msg.needsValue(node.id, missing[0]));
    if (node.kind === 'schedule' && parseSchedule(String(node.fields.schedule)) === null) return refusal(msg.badSchedule);
    if (node.kind === 'form' || node.kind === 'webhook') {
      const path = String(node.fields.path);
      if (!PATH_FORMAT.test(path) || (await pathTaken(node.kind, path))) return refusal(msg.pathTaken);
    }
    if (node.kind === 'wait') {
      if (waitSeconds(node.fields.seconds) === null) return refusal(msg.waitRange(node.id, config.waitMaxSeconds));
    }
    if (node.kind === 'call_webhook' && !ownAddress(String(node.fields.url))) return refusal(msg.foreignUrl(node.id));
    if (node.kind === 'loop' && inLoop.has(node.id)) return refusal(msg.nestedLoop(node.id));
  }
  return null;
}

