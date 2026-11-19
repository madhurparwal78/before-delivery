import { BRANCH_COLOURS, ICONS, type DocTopic, type TaskFields } from './model.ts';
import { COLOUR_PATTERN, LIMITS, USERNAME_PATTERN, validDate } from './rules.ts';
import { childrenIndex, floatingOf, rootOf, type Topics } from './tree.ts';
import { normaliseTitle } from './titleMerge.ts';

export interface OutlineNode {
  title: string;
  task: TaskFields | null;
  colour: string | null;
  icon: string | null;
  at: { x: number; y: number } | null;
  note: string;
  children: OutlineNode[];
}

export interface OutlineParse {
  roots: OutlineNode[];
  count: number;
}

const MAX_ERRORS = 20;
const MAGIC = 'sprig 1';
const NOT_UTF8 = 'The file is not UTF-8 text.';

const FIELD_KEYS = ['done', 'weight', 'state', 'priority', 'due', 'assignee', 'colour', 'icon', 'at', 'note'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** Split a topic line at its unescaped " | " separators, keeping escapes for later. */
function splitLine(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at] as string;
    if (ch === '\\' && at + 1 < text.length) {
      current += ch + text[at + 1];
      at += 1;
    } else if (text.startsWith(' | ', at)) {
      parts.push(current);
      current = '';
      at += 2;
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

const unescape = (text: string): string => text.replace(/\\(\\|\||n)/g, (_all, c: string) => (c === 'n' ? '\n' : c));
const escapeText = (text: string): string => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const escapeNote = (text: string): string => escapeText(text).replace(/\n/g, '\\n');

function fieldValueOk(key: FieldKey, value: string): boolean {
  switch (key) {
    case 'done':
      return /^\d{1,3}$/.test(value) && Number(value) <= 100;
    case 'weight':
      return /^\d{1,2}$/.test(value) && Number(value) <= 10;
    case 'state':
      return value === 'cancelled' || value === 'open';
    case 'priority':
      return value === 'low' || value === 'high' || value === 'normal';
    case 'due':
      return validDate(value);
    case 'assignee':
      return USERNAME_PATTERN.test(value);
    case 'colour':
      return COLOUR_PATTERN.test(value) || (BRANCH_COLOURS as readonly string[]).includes(value);
    case 'icon':
      return (ICONS as readonly string[]).includes(value);
    case 'at':
      return /^-?\d+,-?\d+$/.test(value);
    case 'note':
      return true;
  }
}

/** Parse a Sprig outline file. Returns the topics, or the line errors in file order. */
export function parseOutline(bytes: Uint8Array): OutlineParse | string[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [NOT_UTF8];
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const errors: string[] = [];
  const fail = (line: number, message: string): void => {
    if (errors.length < MAX_ERRORS) errors.push(`Line ${line}: ${message}`);
  };
  if (lines[0] !== MAGIC) fail(1, 'first line must be "sprig 1"');

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  let count = 0;
  let previousLevel = -1;
  for (let at = 1; at < lines.length; at += 1) {
    const raw = lines[at] as string;
    const number = at + 1;
    if (raw.trim() === '') continue;
    const indent = /^[ \t]*/.exec(raw)?.[0] ?? '';
    if (indent.includes('\t') || indent.length % 2 !== 0) {
      fail(number, 'indent must be a multiple of two spaces');
      continue;
    }
    const level = indent.length / 2;
    if (level > previousLevel + 1) {
      fail(number, 'indent jumps more than one level');
      continue;
    }
    const [head = '', ...rest] = splitLine(raw.slice(indent.length));
    const title = normaliseTitle(unescape(head));
    if (title.length === 0) {
      fail(number, 'empty title');
      continue;
    }
    if (Array.from(title).length > LIMITS.title_chars) {
      fail(number, `title is longer than ${LIMITS.title_chars} characters`);
      continue;
    }
    const seen = new Map<FieldKey, string>();
    let problem: string | null = null;
    for (const field of rest) {
      const eq = field.indexOf('=');
      const key = eq === -1 ? field : field.slice(0, eq);
      if (!(FIELD_KEYS as readonly string[]).includes(key)) {
        problem = `unknown field "${key}"`;
        break;
      }
      if (seen.has(key as FieldKey)) {
        problem = `field "${key}" appears twice`;
        break;
      }
      const value = eq === -1 ? '' : field.slice(eq + 1);
      if (eq === -1 || !fieldValueOk(key as FieldKey, unescape(value))) {
        problem = `field "${key}" has an invalid value`;
        break;
      }
      seen.set(key as FieldKey, unescape(value));
    }
    if (problem) {
      fail(number, problem);
      continue;
    }
    const node = nodeFrom(title, seen);
    count += 1;
    previousLevel = level;
    stack.length = level;
    const parent = stack[level - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack[level] = node;
  }
  if (roots.length === 0 && errors.length === 0) fail(2, 'the map needs a central topic');
  return errors.length > 0 ? errors : { roots, count };
}

function nodeFrom(title: string, fields: Map<FieldKey, string>): OutlineNode {
  const hasTask = ['done', 'weight', 'state', 'priority', 'due', 'assignee'].some((k) => fields.has(k as FieldKey));
  const at = fields.get('at')?.split(',').map(Number);
  return {
    title,
    task: hasTask
      ? {
          percent: Number(fields.get('done') ?? 0),
          weight: Number(fields.get('weight') ?? 1),
          state: fields.get('state') === 'cancelled' ? 'cancelled' : 'open',
          priority: (fields.get('priority') as TaskFields['priority'] | undefined) ?? 'normal',
          due: fields.get('due') ?? null,
          assignee: fields.get('assignee') ?? null,
        }
      : null,
    colour: fields.get('colour') ?? null,
    icon: fields.get('icon') ?? null,
    at: at && at.length === 2 ? { x: at[0] as number, y: at[1] as number } : null,
    note: fields.get('note') ?? '',
    children: [],
  };
}

export interface PreviewNode {
  title: string;
  children: PreviewNode[];
}

export const previewOf = (nodes: readonly OutlineNode[]): PreviewNode[] =>
  nodes.map((n) => ({ title: n.title, children: previewOf(n.children) }));

function lineFor(topic: DocTopic, level: number): string {
  const fields: string[] = [];
  const task = topic.task;
  if (task) {
    fields.push(`done=${task.percent}`);
    if (task.weight !== 1) fields.push(`weight=${task.weight}`);
    if (task.state === 'cancelled') fields.push('state=cancelled');
    if (task.priority !== 'normal') fields.push(`priority=${task.priority}`);
    if (task.due) fields.push(`due=${task.due}`);
    if (task.assignee) fields.push(`assignee=${task.assignee}`);
  }
  if (topic.colour) fields.push(`colour=${topic.colour}`);
  if (topic.icon) fields.push(`icon=${topic.icon}`);
  if (topic.floating) fields.push(`at=${topic.x ?? 0},${topic.y ?? 0}`);
  if (topic.note) fields.push(`note=${escapeNote(topic.note)}`);
  return `${'  '.repeat(level)}${[escapeText(topic.title), ...fields].join(' | ')}\n`;
}

/** The canonical outline text of one branch, or of the whole map when no topic is given. */
export function serializeOutline(topics: Topics, topicId: string | null): string {
  const index = childrenIndex(topics);
  let out = `${MAGIC}\n`;
  const walk = (topic: DocTopic, level: number): void => {
    out += lineFor(topic, level);
    for (const child of index.get(topic.id) ?? []) walk(child, level + 1);
  };
  if (topicId !== null) {
    const start = topics[topicId];
    if (start) walk(start, 0);
    return out;
  }
  const root = rootOf(topics);
  if (root) walk(root, 0);
  for (const floating of floatingOf(topics)) walk(floating, 0);
  return out;
}
