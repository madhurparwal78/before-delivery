import type { TopicNode } from './types.js';

/**
 * The Sprig outline format: the single published implementation of
 * parsing, error reporting and canonical serialisation.
 */

export interface OutlineTask {
  percent: number;
  weight: number;
  state: 'open' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  due: string | null;
  assignee: string | null;
}

export interface OutlineTopic {
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  floating: boolean;
  at: { x: number; y: number } | null;
  task: OutlineTask | null;
  children: OutlineTopic[];
}

export interface OutlineError {
  line: number | null;
  message: string;
}

const FIELD_ORDER = ['done', 'weight', 'state', 'priority', 'due', 'assignee', 'colour', 'icon', 'at', 'note'] as const;
type FieldName = (typeof FIELD_ORDER)[number];

const HEX6 = /^#[0-9a-f]{6}$/;

export function unescapeValue(v: string, isNote: boolean): string {
  let out = '';
  for (let i = 0; i < v.length; i += 1) {
    if (v[i] === '\\' && i + 1 < v.length) {
      const next = v[i + 1];
      if (next === '\\' || next === '|') { out += next; i += 1; continue; }
      if (isNote && next === 'n') { out += '\n'; i += 1; continue; }
    }
    out += v[i];
  }
  return out;
}

export function escapeValue(v: string, isNote: boolean): string {
  let out = '';
  for (const ch of v) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '|') out += '\\|';
    else if (isNote && ch === '\n') out += '\\n';
    else out += ch;
  }
  return out;
}

/** Collapse runs of whitespace to one space and trim, as field limits state. */
export function normaliseTitle(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

interface RawField {
  key: string;
  value: string;
}

function splitTitle(raw: string): { title: string; fields: RawField[] } {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && i + 1 < raw.length && (raw[i + 1] === '|' || raw[i + 1] === '\\')) {
      cur += raw[i + 1];
      i += 1;
      continue;
    }
    if (raw[i] === '|') { parts.push(cur); cur = ''; continue; }
    cur += raw[i];
  }
  parts.push(cur);
  const title = parts[0].trim();
  const fields: RawField[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq === -1) { fields.push({ key: p, value: '' }); continue; }
    fields.push({ key: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim() });
  }
  return { title, fields };
}

function isValidValue(key: FieldName, value: string): boolean {
  switch (key) {
    case 'done': return /^(0|[1-9][0-9]{0,2}|100)$/.test(value) && Number(value) >= 0 && Number(value) <= 100;
    case 'weight': return /^([0-9]|10)$/.test(value);
    case 'state': return value === 'cancelled';
    case 'priority': return value === 'low' || value === 'high';
    case 'due': return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
    case 'assignee': return value.length > 0;
    case 'colour': return HEX6.test(value) || NAMED_COLOURS.has(value);
    case 'icon': return ICON_NAMES.has(value);
    case 'at': return /^-?[0-9]+,-?[0-9]+$/.test(value);
    case 'note': return true;
    default: return false;
  }
}

export const NAMED_COLOURS = new Set(['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre', 'accent']);
export const ICON_NAMES = new Set([
  'star', 'flag', 'bulb', 'check', 'cross', 'question', 'clock', 'calendar',
  'pin', 'home', 'book', 'pencil', 'music', 'coin', 'cart', 'truck',
  'people', 'heart', 'warning', 'leaf', 'camera', 'phone', 'key', 'gift',
]);

export interface ParseResult {
  ok: boolean;
  errors: OutlineError[];
  topics: OutlineTopic[];
}

const isUtf8Text = (b: Buffer): boolean => {
  const s = b.toString('utf8');
  // A UTF-8 decode with replacement means the bytes were not valid UTF-8.
  return Buffer.compare(Buffer.from(s, 'utf8'), b) === 0 || !s.includes('\uFFFD');
};

export function parseOutline(bytes: Buffer): ParseResult {
  if (!isUtf8Text(bytes)) {
    return { ok: false, errors: [{ line: null, message: 'The file is not UTF-8 text.' }], topics: [] };
  }
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  // Drop a single trailing newline's empty last element.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const errors: OutlineError[] = [];
  if (lines.length === 0 || lines[0] !== 'sprig 1') {
    return { ok: false, errors: [{ line: 1, message: 'Line 1: first line must be "sprig 1"' }], topics: [] };
  }
  const stack: OutlineTopic[] = [];
  const roots: OutlineTopic[] = [];
  let lastIndent = 0;
  let sawTopic = false;
  for (let li = 1; li < lines.length && errors.length < 20; li += 1) {
    const line = lines[li];
    if (line.trim() === '') continue;
    const indentMatch = line.match(/^[ \t]*/);
    const indentRaw = indentMatch ? indentMatch[0] : '';
    const lineNo = li + 1;
    if (indentRaw.includes('\t')) {
      errors.push({ line: lineNo, message: `Line ${lineNo}: indent must be a multiple of two spaces` });
      continue;
    }
    const indent = indentRaw.length;
    if (indent % 2 !== 0) {
      errors.push({ line: lineNo, message: `Line ${lineNo}: indent must be a multiple of two spaces` });
      continue;
    }
    const level = indent / 2;
    if (level > lastIndent + 1) {
      errors.push({ line: lineNo, message: `Line ${lineNo}: indent jumps more than one level` });
      continue;
    }
    lastIndent = level;
    const raw = line.slice(indent);
    const { title, fields } = splitTitle(raw);
    const norm = normaliseTitle(unescapeValue(title, false));
    if (norm === '') {
      errors.push({ line: lineNo, message: `Line ${lineNo}: empty title` });
      continue;
    }
    if ([...norm].length > 200) {
      errors.push({ line: lineNo, message: `Line ${lineNo}: title is longer than 200 characters` });
      continue;
    }
    let bad: string | null = null;
    const seen = new Set<string>();
    const values = new Map<string, string>();
    for (const f of fields) {
      if (!(FIELD_ORDER as readonly string[]).includes(f.key)) {
        bad = `Line ${lineNo}: unknown field "${f.key}"`; break;
      }
      const key = f.key as FieldName;
      if (seen.has(key)) {
        bad = `Line ${lineNo}: field "${key}" appears twice`; break;
      }
      seen.add(key);
      if (!isValidValue(key, f.value)) {
        bad = `Line ${lineNo}: field "${key}" has an invalid value`; break;
      }
      values.set(key, f.value);
    }
    if (bad) { errors.push({ line: lineNo, message: bad }); continue; }
    const topic: OutlineTopic = {
      title: norm,
      note: values.has('note') ? unescapeValue(values.get('note')!, true) : '',
      icon: values.get('icon') ?? null,
      colour: values.get('colour') ?? null,
      floating: false,
      at: null,
      task: null,
      children: [],
    };
    if (values.has('at')) {
      const [x, y] = values.get('at')!.split(',').map(Number);
      topic.at = { x, y };
      if (level === 0) topic.floating = true;
    }
    if (values.has('done')) {
      topic.task = {
        percent: Number(values.get('done')),
        weight: values.has('weight') ? Number(values.get('weight')) : 1,
        state: values.has('state') ? 'cancelled' : 'open',
        priority: values.has('priority') ? (values.get('priority') as 'low' | 'high') : 'normal',
        due: values.get('due') ?? null,
        assignee: values.get('assignee') ?? null,
      };
    }
    sawTopic = true;
    if (level === 0) {
      roots.push(topic);
      stack.length = 0;
      stack.push(topic);
    } else {
      const parent = stack[level - 1];
      if (!parent) {
        errors.push({ line: lineNo, message: `Line ${lineNo}: indent jumps more than one level` });
        continue;
      }
      while (stack.length > level) stack.pop();
      parent.children.push(topic);
      stack.push(topic);
    }
  }
  if (errors.length > 0) return { ok: false, errors, topics: [] };
  if (!sawTopic) {
    return { ok: false, errors: [{ line: 2, message: 'Line 2: the map needs a central topic' }], topics: [] };
  }
  if (roots.length > 0 && roots[0].floating) {
    return { ok: false, errors: [{ line: 2, message: 'Line 2: the map needs a central topic' }], topics: [] };
  }
  return { ok: true, errors: [], topics: roots };
}

export interface SerialiseOptions {
  includeFloating?: boolean;
}

/** Serialise a branch (or the whole map) to canonical Sprig bytes. */
export function serialiseOutline(roots: OutlineTopic[], wholeMap: boolean): Buffer {
  const out: string[] = ['sprig 1'];
  const write = (t: OutlineTopic, level: number) => {
    let line = '  '.repeat(level) + escapeValue(normaliseTitle(t.title), false);
    if (t.task) {
      line += ` | done=${t.task.percent}`;
      if (t.task.weight !== 1) line += ` | weight=${t.task.weight}`;
      if (t.task.state === 'cancelled') line += ` | state=cancelled`;
      if (t.task.priority !== 'normal') line += ` | priority=${t.task.priority}`;
      if (t.task.due) line += ` | due=${t.task.due}`;
      if (t.task.assignee) line += ` | assignee=${t.task.assignee}`;
    }
    if (t.colour) line += ` | colour=${t.colour.toLowerCase()}`;
    if (t.icon) line += ` | icon=${t.icon}`;
    if (t.floating && t.at) line += ` | at=${t.at.x},${t.at.y}`;
    if (t.note) line += ` | note=${escapeValue(t.note, true)}`;
    out.push(line);
  };
  const main = roots.filter((r) => !r.floating);
  const floaters = roots.filter((r) => r.floating);
  const writeTree = (t: OutlineTopic, level: number) => {
    write(t, level);
    for (const c of t.children) writeTree(c, level + 1);
  };
  if (main.length > 0) writeTree(main[0], 0);
  if (wholeMap) {
    for (const r of main.slice(1)) writeTree(r, 0);
    for (const f of floaters) writeTree(f, 0);
  }
  return Buffer.from(out.join('\n') + '\n', 'utf8');
}

/** Convert stored topic nodes (already filtered to what the viewer may see) to outline topics. */
export function topicsToOutline(topics: TopicNode[], rootId: string | null): OutlineTopic[] {
  const byParent = new Map<string, TopicNode[]>();
  const byId = new Map<string, TopicNode>();
  for (const t of topics) {
    byId.set(t.id, t);
    const arr = byParent.get(t.parent_id ?? '') ?? [];
    arr.push(t);
    byParent.set(t.parent_id ?? '', arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
  const convert = (t: TopicNode, floating: boolean): OutlineTopic => ({
    title: t.title,
    note: t.note,
    icon: t.icon,
    colour: t.colour,
    floating,
    at: t.floating && t.x !== null && t.y !== null ? { x: t.x, y: t.y } : null,
    task: t.task ? {
      percent: t.task.percent, weight: t.task.weight, state: t.task.state,
      priority: t.task.priority, due: t.task.due, assignee: t.task.assignee,
    } : null,
    children: (byParent.get(t.id) ?? []).map((c) => convert(c, false)),
  });
  if (rootId) {
    const root = byId.get(rootId);
    if (!root) return [];
    return [convert(root, false)];
  }
  const mainRoot = topics.find((t) => t.parent_id === null && !t.floating);
  const out: OutlineTopic[] = [];
  if (mainRoot) out.push(convert(mainRoot, false));
  for (const t of topics.filter((x) => x.floating)) out.push(convert(t, true));
  return out;
}
