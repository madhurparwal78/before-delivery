import type { BranchColour, Derived, DocTopic, MapDoc, ShapeName, ThemeName } from './model.ts';
import { BRANCH_COLOURS } from './model.ts';
import { childrenIndex, depthFirst, floatingOf, rootOf, type Topics } from './tree.ts';

const COLOUR_HEX: Record<BranchColour | 'accent', string> = {
  indigo: '#2b2fd9',
  azure: '#1496e0',
  teal: '#13a08f',
  green: '#1fa032',
  violet: '#6a2bd9',
  magenta: '#b02ac0',
  orange: '#e2621b',
  ochre: '#c98c0a',
  accent: '#1a40ff',
};

export const INK_HEX = '#1f1e30';

export function colourHex(colour: string): string {
  return colour.startsWith('#') ? colour : COLOUR_HEX[colour as BranchColour | 'accent'] ?? COLOUR_HEX.accent;
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const textOn = (colour: string): 'ink' | 'white' => (luminance(colourHex(colour)) >= 0.2 ? 'ink' : 'white');

const THEME_SHAPE: Record<ThemeName, ShapeName> = { daylight: 'pill', paper: 'underline', dusk: 'filled' };

interface Cascade {
  colour: string;
  shape: ShapeName;
  text: 'ink' | 'white';
}

/** The style cascade: own override, then the nearest ancestor's, then the level 2 ancestor's branch colour. */
export function cascadeStyles(doc: MapDoc, index = childrenIndex(doc.topics)): Map<string, Cascade> {
  const out = new Map<string, Cascade>();
  const root = rootOf(doc.topics);
  const visit = (topic: DocTopic, override: string | null, branch: string, isRoot: boolean): void => {
    const own = topic.colour ?? override;
    const colour = own ?? branch;
    const shape = topic.shape ?? (isRoot ? 'rounded' : THEME_SHAPE[doc.theme]);
    out.set(topic.id, { colour, shape, text: shape === 'filled' || shape === 'rounded' ? textOn(colour) : 'ink' });
    (index.get(topic.id) ?? []).forEach((child, at) => {
      visit(child, own, isRoot ? (BRANCH_COLOURS[at % BRANCH_COLOURS.length] ?? 'indigo') : branch, false);
    });
  };
  if (root) visit(root, null, 'accent', true);
  floatingOf(doc.topics).forEach((f, at) => visit(f, null, BRANCH_COLOURS[at % BRANCH_COLOURS.length] ?? 'indigo', false));
  return out;
}

interface Rollup {
  percent: number | 'dash';
}

/** The rollup formula: the weighted mean of the direct children that carry progress, rounded half up. */
function rollupOf(topics: Topics, index: Map<string, DocTopic[]>, memo: Map<string, Rollup | null>, id: string): Rollup | null {
  if (memo.has(id)) return memo.get(id) ?? null;
  const children = index.get(id) ?? [];
  const carrying = children.filter((c) => c.task !== null || rollupOf(topics, index, memo, c.id) !== null);
  if (carrying.length === 0) {
    memo.set(id, null);
    return null;
  }
  let weights = 0;
  let total = 0;
  for (const child of carrying) {
    if (child.task?.state === 'cancelled') continue;
    const below = rollupOf(topics, index, memo, child.id);
    const weight = child.task ? child.task.weight : 1;
    const percent = below ? below.percent : child.task?.percent ?? 0;
    if (percent === 'dash') continue;
    weights += weight;
    total += weight * percent;
  }
  const result: Rollup = { percent: weights === 0 ? 'dash' : Math.floor((2 * total + weights) / (2 * weights)) };
  memo.set(id, result);
  return result;
}

/** Every derived value of every topic in a document, computed from the document alone. */
export function deriveAll(doc: MapDoc, today: string): Map<string, Derived> {
  const index = childrenIndex(doc.topics);
  const styles = cascadeStyles(doc, index);
  const memo = new Map<string, Rollup | null>();
  const order = depthFirst(doc.topics, index);
  const shown = new Map<string, number | null | 'dash'>();
  for (const topic of order) {
    const rollup = rollupOf(doc.topics, index, memo, topic.id);
    shown.set(topic.id, rollup ? rollup.percent : topic.task ? topic.task.percent : null);
  }

  const earliest = new Map<string, string | null>();
  const subtopics = new Map<string, number>();
  for (const topic of [...order].reverse()) {
    let due: string | null = topic.task && topic.task.state === 'open' && topic.task.percent < 100 ? topic.task.due : null;
    let count = 0;
    for (const child of index.get(topic.id) ?? []) {
      const below = earliest.get(child.id) ?? null;
      if (below !== null && (due === null || below < due)) due = below;
      count += 1 + (subtopics.get(child.id) ?? 0);
    }
    earliest.set(topic.id, due);
    subtopics.set(topic.id, count);
  }

  const blockers = new Map<string, string[]>();
  for (const link of doc.links) {
    if (link.type !== 'depends') continue;
    const target = doc.topics[link.to];
    if (!target || !doc.topics[link.from]) continue;
    const done = shown.get(target.id) === 100 || target.task?.state === 'cancelled';
    const carries = target.task !== null || (shown.get(target.id) ?? null) !== null;
    if (done || !carries) continue;
    const list = blockers.get(link.from) ?? [];
    list.push(target.id);
    blockers.set(link.from, list);
  }
  const position = new Map(order.map((t, at) => [t.id, at]));
  for (const list of blockers.values()) list.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  const blockedBelow = new Map<string, number>();
  for (const topic of [...order].reverse()) {
    let count = 0;
    for (const child of index.get(topic.id) ?? []) {
      count += (blockers.has(child.id) ? 1 : 0) + (blockedBelow.get(child.id) ?? 0);
    }
    blockedBelow.set(topic.id, count);
  }

  const out = new Map<string, Derived>();
  for (const topic of order) {
    const style = styles.get(topic.id) as Cascade;
    const due = earliest.get(topic.id) ?? null;
    out.set(topic.id, {
      colour: style.colour,
      shape: style.shape,
      text: style.text,
      percent: shown.get(topic.id) ?? null,
      earliest_due: due,
      overdue: due !== null && due < today,
      blocked_by: blockers.get(topic.id) ?? [],
      blocked_count: blockedBelow.get(topic.id) ?? 0,
      subtopics: subtopics.get(topic.id) ?? 0,
    });
  }
  return out;
}

/** Would a depends-on link from `from` to `to` close a loop among the existing depends-on links? */
export function dependsLoop(doc: MapDoc, from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const link of doc.links) {
    if (link.type !== 'depends') continue;
    const list = next.get(link.from) ?? [];
    list.push(link.to);
    next.set(link.from, list);
  }
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    if (id === from) return true;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}
