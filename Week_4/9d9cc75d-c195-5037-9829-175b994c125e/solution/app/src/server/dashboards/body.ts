// Narrowing of a dashboard body. The rules that need the workbook (sheet count, nesting, actions) are in rules.ts.
import type {
  ActionType,
  DashboardAction,
  DashboardBody,
  FloatingObject,
  LayoutContainer,
  LayoutSheet,
} from '../../shared/model.ts';
import { isObject, isStringArray, nonBlank } from '../http/validate.ts';
import type { JsonObject } from '../http/validate.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { Malformed, oneOf } from '../sheets/shape.ts';

const ACTION_TYPES: readonly ActionType[] = ['filter', 'highlight', 'set_parameter', 'change_set'];
const LAYOUT_TEXT = 'Layout must be a horizontal or vertical container of sheets.';
const FLOATING_TEXT = 'Floating objects need a sheet and a whole-pixel x, y, w and h.';
const ACTIONS_TEXT = 'Each action needs a name, a type, a source sheet, target sheets and a field.';

function whole(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function child(value: unknown): LayoutSheet | LayoutContainer {
  if (isObject(value) && 'children' in value) return container(value);
  if (!isObject(value)) throw new Malformed('layout', LAYOUT_TEXT);
  const sheet = nonBlank(value.sheet);
  const fixed = value.fixed ?? null;
  if (sheet === null || (fixed !== null && !whole(fixed, 0))) throw new Malformed('layout', LAYOUT_TEXT);
  return { sheet, fixed };
}

function container(value: unknown): LayoutContainer {
  if (!isObject(value) || !Array.isArray(value.children)) throw new Malformed('layout', LAYOUT_TEXT);
  const type = value.type === 'horizontal' || value.type === 'vertical' ? value.type : null;
  if (type === null) throw new Malformed('layout', LAYOUT_TEXT);
  return { type, children: value.children.map(child) };
}

function floating(value: unknown): FloatingObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Malformed('floating', FLOATING_TEXT);
  return value.map((f) => {
    if (!isObject(f)) throw new Malformed('floating', FLOATING_TEXT);
    const sheet = nonBlank(f.sheet);
    const { x, y, w, h } = f;
    if (sheet === null || !whole(x, 0) || !whole(y, 0) || !whole(w, 1) || !whole(h, 1)) {
      throw new Malformed('floating', FLOATING_TEXT);
    }
    return { sheet, x, y, w, h };
  });
}

function phoneHeights(value: unknown): Record<string, number> {
  const text = 'Phone heights must map sheets to whole pixels.';
  if (value === undefined) return {};
  if (!isObject(value)) throw new Malformed('phone_heights', text);
  const out: Record<string, number> = {};
  for (const [sheet, height] of Object.entries(value)) {
    if (!whole(height, 1)) throw new Malformed('phone_heights', text);
    out[sheet] = height;
  }
  return out;
}

function optionalName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const name = nonBlank(value);
  if (name === null) throw new Malformed('actions', ACTIONS_TEXT);
  return name;
}

function actions(value: unknown): DashboardAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Malformed('actions', ACTIONS_TEXT);
  return value.map((a) => {
    if (!isObject(a)) throw new Malformed('actions', ACTIONS_TEXT);
    const name = nonBlank(a.name);
    const type = oneOf(ACTION_TYPES, a.type);
    const source = nonBlank(a.source);
    const field = nonBlank(a.field);
    if (name === null || type === null || source === null || field === null || !isStringArray(a.targets)) {
      throw new Malformed('actions', ACTIONS_TEXT);
    }
    return { name: name.trim(), type, source, targets: a.targets, field, parameter: optionalName(a.parameter), set: optionalName(a.set) };
  });
}

/** The dashboard body with sheets by id. */
export function dashboardBody(body: JsonObject): DashboardBody {
  const name = nonBlank(body.name);
  if (name === null) throw new Malformed('name', NAME_REQUIRED);
  const phoneOrder = body.phone_order ?? [];
  if (!isStringArray(phoneOrder)) throw new Malformed('phone_order', 'Phone order must be a list of sheets.');
  return {
    name: name.trim(),
    layout: container(body.layout),
    floating: floating(body.floating),
    phone_order: phoneOrder,
    phone_heights: phoneHeights(body.phone_heights),
    actions: actions(body.actions),
  };
}

/** Every sheet the body names, wherever it names one. */
export function namedSheets(body: DashboardBody): Set<string> {
  const out = new Set<string>();
  const walk = (c: LayoutContainer): void => {
    for (const ch of c.children) {
      if ('children' in ch) walk(ch);
      else out.add(ch.sheet);
    }
  };
  walk(body.layout);
  for (const f of body.floating) out.add(f.sheet);
  for (const s of body.phone_order) out.add(s);
  for (const s of Object.keys(body.phone_heights)) out.add(s);
  for (const a of body.actions) {
    out.add(a.source);
    for (const t of a.targets) out.add(t);
  }
  return out;
}

/** The body with every sheet reference passed through `sheet` (the seed names sheets; the API uses ids). */
export function mapSheets(body: DashboardBody, sheet: (ref: string) => string): DashboardBody {
  const layout = (c: LayoutContainer): LayoutContainer => ({
    ...c,
    children: c.children.map((ch) => ('children' in ch ? layout(ch) : { ...ch, sheet: sheet(ch.sheet) })),
  });
  return {
    ...body,
    layout: layout(body.layout),
    floating: body.floating.map((f) => ({ ...f, sheet: sheet(f.sheet) })),
    phone_order: body.phone_order.map(sheet),
    phone_heights: Object.fromEntries(Object.entries(body.phone_heights).map(([s, h]) => [sheet(s), h])),
    actions: body.actions.map((a) => ({ ...a, source: sheet(a.source), targets: a.targets.map(sheet) })),
  };
}
