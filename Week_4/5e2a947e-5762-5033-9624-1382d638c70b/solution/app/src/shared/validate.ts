import { BRANCH_COLOURS, ICONS, LAYOUTS, SHAPES, THEMES } from './model.ts';
import { noteLinkProblem } from './notes.ts';
import { COLOUR_PATTERN, LIMITS, isClientId, validDate } from './rules.ts';
import { normaliseTitle } from './titleMerge.ts';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = isClientId;
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const length = (text: string): number => Array.from(text).length;

const SIDES = ['left', 'right'];
const TASK_KEYS = ['percent', 'weight', 'state', 'priority', 'due', 'assignee'];

function validTitle(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const size = length(normaliseTitle(value));
  return size >= 1 && size <= LIMITS.title_chars;
}

function taskProblem(task: unknown): string | null {
  if (task === null) return null;
  if (!isRecord(task)) return 'task must be null or an object';
  for (const [key, value] of Object.entries(task)) {
    if (!TASK_KEYS.includes(key)) return `unknown task field ${key}`;
    const ok =
      (key === 'percent' && isInt(value, 0, 100)) ||
      (key === 'weight' && isInt(value, 0, 10)) ||
      (key === 'state' && (value === 'open' || value === 'cancelled')) ||
      (key === 'priority' && (value === 'low' || value === 'normal' || value === 'high')) ||
      (key === 'due' && (value === null || (typeof value === 'string' && validDate(value)))) ||
      (key === 'assignee' && (value === null || isId(value)));
    if (!ok) return `task ${key} has an invalid value`;
  }
  return null;
}

/** Check the shape and values of one client operation. Returns the problem, or null. */
export function opProblem(op: unknown): string | null {
  if (!isRecord(op)) return 'operation must be an object';
  if (!isId(op.op_id)) return 'op_id must be 1 to 40 letters, digits, _ or -';
  const needs = (...keys: string[]): string | null => {
    const missing = keys.find((k) => !isId(op[k]));
    return missing ? `${missing} must be an id` : null;
  };
  switch (op.kind) {
    case 'add':
      return needs('topic_id', 'parent_id') ?? (op.after !== null && !isId(op.after) ? 'after must be an id or null' : null) ?? (validTitle(op.title) ? null : 'title must be 1 to 200 characters');
    case 'add_floating':
      return needs('topic_id') ?? (typeof op.x === 'number' && typeof op.y === 'number' && Number.isFinite(op.x) && Number.isFinite(op.y) ? null : 'x and y must be numbers') ?? (validTitle(op.title) ? null : 'title must be 1 to 200 characters');
    case 'title':
      return needs('topic_id') ?? (isInt(op.offset, 0) && isInt(op.delete, 0) && typeof op.insert === 'string' ? null : 'offset, delete and insert are required');
    case 'note':
      if (!isId(op.topic_id) || typeof op.text !== 'string') return 'topic_id and text are required';
      if (length(op.text) > LIMITS.note_chars) return 'note is longer than 5000 characters';
      return noteLinkProblem(op.text);
    case 'move':
      return needs('topic_id', 'parent_id') ?? (op.after !== null && !isId(op.after) ? 'after must be an id or null' : null);
    case 'float_move':
      return needs('topic_id') ?? (typeof op.x === 'number' && typeof op.y === 'number' && Number.isFinite(op.x) && Number.isFinite(op.y) ? null : 'x and y must be numbers');
    case 'delete':
    case 'lock':
    case 'unlock':
      return needs('topic_id');
    case 'task':
      return needs('topic_id') ?? taskProblem(op.task);
    case 'style': {
      const bad = needs('topic_id');
      if (bad) return bad;
      if (op.colour !== undefined && op.colour !== null && !(typeof op.colour === 'string' && (COLOUR_PATTERN.test(op.colour) || (BRANCH_COLOURS as readonly string[]).includes(op.colour)))) return 'colour is not a branch colour or #rrggbb';
      if (op.shape !== undefined && op.shape !== null && !(SHAPES as readonly unknown[]).includes(op.shape)) return 'unknown shape';
      if (op.icon !== undefined && op.icon !== null && !(ICONS as readonly unknown[]).includes(op.icon)) return 'unknown icon';
      return null;
    }
    case 'pin':
      return needs('topic_id') ?? (op.side === null || SIDES.includes(op.side as string) ? null : 'side must be left, right or null');
    case 'link_add':
      return needs('link_id', 'from', 'to') ?? (typeof op.label === 'string' && length(op.label) <= LIMITS.label_chars ? null : 'label is longer than 40 characters') ?? (op.type === 'related' || op.type === 'depends' ? null : 'type must be related or depends');
    case 'link_remove':
      return needs('link_id');
    case 'boundary_add':
      return needs('boundary_id', 'topic_id') ?? (typeof op.label === 'string' && length(op.label) <= LIMITS.label_chars ? null : 'label is longer than 40 characters');
    case 'boundary_remove':
      return needs('boundary_id');
    case 'restrict':
      return needs('topic_id') ?? (typeof op.restricted === 'boolean' ? null : 'restricted must be a boolean');
    case 'layout':
      return (LAYOUTS as readonly unknown[]).includes(op.layout) ? null : 'unknown layout';
    case 'theme':
      return (THEMES as readonly unknown[]).includes(op.theme) ? null : 'unknown theme';
    case 'slides':
      return Array.isArray(op.order) && op.order.every(isId) ? null : 'order must be a list of ids';
    case 'custom_colour':
      return typeof op.colour === 'string' && COLOUR_PATTERN.test(op.colour) ? null : 'colour must be #rrggbb in lower case';
    default:
      return 'unknown operation kind';
  }
}
