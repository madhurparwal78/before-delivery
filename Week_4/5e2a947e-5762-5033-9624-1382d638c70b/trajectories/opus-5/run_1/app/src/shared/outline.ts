import { permittedChildren, type MapView } from './tree.js';
import { ICON_NAMES, type Priority, type Task, type TaskState } from './types.js';
import { isCustomColour } from './style.js';
import { BRANCH_COLOURS } from './types.js';

export const OUTLINE_HEADER = 'sprig 1';
export const MAX_OUTLINE_ERRORS = 20;

export interface OutlineNode {
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  task: Task | null;
  at: { x: number; y: number } | null;
  children: OutlineNode[];
}

export interface OutlineParse {
  nodes: OutlineNode[];
  errors: string[];
}

const FIELD_ORDER = [
  'done',
  'weight',
  'state',
  'priority',
  'due',
  'assignee',
  'colour',
  'icon',
  'at',
  'note',
] as const;

type FieldKey = (typeof FIELD_ORDER)[number];

function escapeValue(value: string, isNote: boolean): string {
  let out = value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  if (isNote) out = out.replace(/\n/g, '\\n');
  return out;
}

function unescapeValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === '\\') {
        out += '\\';
        i += 1;
        continue;
      }
      if (next === '|') {
        out += '|';
        i += 1;
        continue;
      }
      if (next === 'n') {
        out += '\n';
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Splits a topic line into its title and its raw ` | key=value` fields. */
function splitFields(line: string): { title: string; fields: string[] } {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      current += ch + line[i + 1];
      i += 1;
      continue;
    }
    if (ch === '|') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const [head, ...rest] = parts;
  return { title: head.replace(/\s+$/, ''), fields: rest.map((field) => field.trim()) };
}

function isUsername(value: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(value);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const made = new Date(Date.UTC(y, m - 1, d));
  return made.getUTCFullYear() === y && made.getUTCMonth() === m - 1 && made.getUTCDate() === d;
}

function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

function emptyTask(): Task {
  return { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null };
}

export function parseOutline(bytes: Uint8Array): OutlineParse {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { nodes: [], errors: ['The file is not UTF-8 text.'] };
  }
  return parseOutlineText(text);
}

export function parseOutlineText(text: string): OutlineParse {
  const errors: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== OUTLINE_HEADER) {
    errors.push(`Line 1: first line must be "${OUTLINE_HEADER}"`);
    return { nodes: [], errors };
  }
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  let sawTopic = false;
  const push = (message: string): void => {
    if (errors.length < MAX_OUTLINE_ERRORS) errors.push(message);
  };

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (raw.trim() === '') continue;
    const indentMatch = /^[ \t]*/.exec(raw) as RegExpExecArray;
    const indentText = indentMatch[0];
    if (indentText.includes('\t') || indentText.length % 2 !== 0) {
      push(`Line ${lineNumber}: indent must be a multiple of two spaces`);
      continue;
    }
    const level = indentText.length / 2;
    const parentLevel = sawTopic ? stack.length : 0;
    if (level > parentLevel) {
      push(`Line ${lineNumber}: indent jumps more than one level`);
      continue;
    }
    const body = raw.slice(indentText.length);
    const { title, fields } = splitFields(body);
    const cleanTitle = unescapeValue(title).trim();
    if (cleanTitle === '') {
      push(`Line ${lineNumber}: empty title`);
      continue;
    }
    if ([...cleanTitle].length > 200) {
      push(`Line ${lineNumber}: title is longer than 200 characters`);
      continue;
    }
    const node: OutlineNode = {
      title: cleanTitle,
      note: '',
      icon: null,
      colour: null,
      task: null,
      at: null,
      children: [],
    };
    const seen = new Set<string>();
    let lineFailed = false;
    for (const field of fields) {
      if (lineFailed) break;
      const eq = field.indexOf('=');
      const key = eq < 0 ? field : field.slice(0, eq);
      const value = eq < 0 ? '' : unescapeValue(field.slice(eq + 1));
      if (!(FIELD_ORDER as readonly string[]).includes(key)) {
        push(`Line ${lineNumber}: unknown field "${key}"`);
        lineFailed = true;
        break;
      }
      if (seen.has(key)) {
        push(`Line ${lineNumber}: field "${key}" appears twice`);
        lineFailed = true;
        break;
      }
      seen.add(key);
      const bad = (): void => {
        push(`Line ${lineNumber}: field "${key}" has an invalid value`);
        lineFailed = true;
      };
      switch (key as FieldKey) {
        case 'done': {
          const n = wholeNumber(value, 0, 100);
          if (n === null) bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.percent = n;
          }
          break;
        }
        case 'weight': {
          const n = wholeNumber(value, 0, 10);
          if (n === null) bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.weight = n;
          }
          break;
        }
        case 'state': {
          if (value !== 'cancelled') bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.state = 'cancelled' as TaskState;
          }
          break;
        }
        case 'priority': {
          if (value !== 'low' && value !== 'high') bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.priority = value as Priority;
          }
          break;
        }
        case 'due': {
          if (!isDate(value)) bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.due = value;
          }
          break;
        }
        case 'assignee': {
          if (!isUsername(value)) bad();
          else {
            node.task = node.task ?? emptyTask();
            node.task.assignee = value;
          }
          break;
        }
        case 'colour': {
          const lower = value.toLowerCase();
          if (!isCustomColour(lower) && !(BRANCH_COLOURS as readonly string[]).includes(lower)) {
            bad();
          } else {
            node.colour = lower;
          }
          break;
        }
        case 'icon': {
          if (!(ICON_NAMES as readonly string[]).includes(value)) bad();
          else node.icon = value;
          break;
        }
        case 'at': {
          const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
          if (!match) bad();
          else node.at = { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) };
          break;
        }
        case 'note': {
          node.note = value;
          break;
        }
        default:
          break;
      }
    }
    if (lineFailed) continue;
    sawTopic = true;
    if (level === 0) {
      roots.push(node);
      stack.length = 0;
      stack.push({ level: 0, node });
    } else {
      while (stack.length > level) stack.pop();
      const parent = stack[stack.length - 1];
      parent.node.children.push(node);
      stack.push({ level, node });
    }
  }

  if (!sawTopic && errors.length === 0) {
    errors.push('Line 2: the map needs a central topic');
  }
  return { nodes: roots, errors };
}

function fieldsFor(node: OutlineNode, includeAt: boolean): string {
  const out: string[] = [];
  if (node.task) {
    out.push(`done=${node.task.percent}`);
    if (node.task.weight !== 1) out.push(`weight=${node.task.weight}`);
    if (node.task.state === 'cancelled') out.push('state=cancelled');
    if (node.task.priority !== 'normal') out.push(`priority=${node.task.priority}`);
    if (node.task.due !== null) out.push(`due=${node.task.due}`);
    if (node.task.assignee !== null) out.push(`assignee=${node.task.assignee}`);
  }
  if (node.colour !== null) out.push(`colour=${node.colour.toLowerCase()}`);
  if (node.icon !== null) out.push(`icon=${node.icon}`);
  if (includeAt && node.at !== null) out.push(`at=${node.at.x},${node.at.y}`);
  if (node.note !== '') out.push(`note=${escapeValue(node.note, true)}`);
  return out.map((field) => ` | ${field}`).join('');
}

export function serializeOutline(nodes: OutlineNode[]): string {
  const lines: string[] = [OUTLINE_HEADER];
  const walk = (node: OutlineNode, level: number): void => {
    const indent = '  '.repeat(level);
    lines.push(`${indent}${escapeValue(node.title, false)}${fieldsFor(node, level === 0)}`);
    for (const child of node.children) walk(child, level + 1);
  };
  for (const node of nodes) walk(node, 0);
  return `${lines.join('\n')}\n`;
}

/** Builds outline nodes from the part of a map a viewer may see. */
export function outlineFromMap(view: MapView, topicId: string | null): OutlineNode[] {
  const doc = view.doc;
  const build = (id: string, isTop: boolean): OutlineNode => {
    const t = doc.topics[id];
    return {
      title: t.title,
      note: t.note,
      icon: t.icon,
      colour: t.colour,
      task: t.task ? { ...t.task } : null,
      at: isTop && t.floating ? { x: t.x ?? 0, y: t.y ?? 0 } : null,
      children: permittedChildren(view, id).map((child) => build(child, false)),
    };
  };
  if (topicId !== null) return doc.topics[topicId] ? [build(topicId, false)] : [];
  const out: OutlineNode[] = [];
  if (!view.hidden.has(doc.root)) out.push(build(doc.root, false));
  for (const id of doc.floating) {
    if (!view.hidden.has(id) && doc.topics[id]) out.push(build(id, true));
  }
  return out;
}

export function countOutlineNodes(nodes: OutlineNode[]): number {
  let total = 0;
  const walk = (node: OutlineNode): void => {
    total += 1;
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return total;
}

export function previewTree(nodes: OutlineNode[]): { title: string; children: unknown[] }[] {
  return nodes.map((node) => ({ title: node.title, children: previewTree(node.children) }));
}
