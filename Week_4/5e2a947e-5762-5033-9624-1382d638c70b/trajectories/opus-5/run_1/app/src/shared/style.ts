import { ancestors, branchRoot } from './tree.js';
import { BRANCH_COLOURS, type MapDoc, type ShapeName, type ThemeName } from './types.js';

export const ACCENT = 'accent';

export const COLOUR_HEX: Record<string, string> = {
  indigo: '#3b32a8',
  azure: '#4bb4e6',
  teal: '#2bb3a3',
  green: '#43b75d',
  violet: '#7b3fd4',
  magenta: '#b8257f',
  orange: '#e58a1a',
  ochre: '#c9a227',
  accent: '#1f49e0',
};

export const THEME_SHAPE: Record<ThemeName, ShapeName> = {
  daylight: 'pill',
  paper: 'underline',
  dusk: 'filled',
};

export function isCustomColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` fill. */
export function relativeLuminance(hex: string): number {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function colourHex(colour: string): string {
  return isCustomColour(colour) ? colour : (COLOUR_HEX[colour] ?? COLOUR_HEX.accent);
}

export function branchColourAt(index: number): string {
  return BRANCH_COLOURS[((index % BRANCH_COLOURS.length) + BRANCH_COLOURS.length) % BRANCH_COLOURS.length];
}

/** The colour a topic inherits when it has no override of its own. */
function inheritedColour(doc: MapDoc, id: string): string {
  const t = doc.topics[id];
  if (!t) return ACCENT;
  if (t.floating) {
    const index = doc.floating.indexOf(id);
    return branchColourAt(index < 0 ? 0 : index);
  }
  if (t.parent_id === null) return ACCENT;
  const floatingAncestor = ancestors(doc, id).find((a) => doc.topics[a]?.floating);
  if (floatingAncestor !== undefined) {
    const index = doc.floating.indexOf(floatingAncestor);
    return branchColourAt(index < 0 ? 0 : index);
  }
  const level2 = branchRoot(doc, id);
  if (level2 === null) return ACCENT;
  const position = doc.topics[doc.root]?.children.indexOf(level2) ?? 0;
  return branchColourAt(position < 0 ? 0 : position);
}

export function derivedColour(doc: MapDoc, id: string): string {
  const t = doc.topics[id];
  if (!t) return ACCENT;
  if (t.colour) return t.colour;
  for (const a of ancestors(doc, id)) {
    const override = doc.topics[a]?.colour;
    if (override) return override;
  }
  return inheritedColour(doc, id);
}

export function derivedShape(doc: MapDoc, id: string, theme: ThemeName): ShapeName {
  const t = doc.topics[id];
  if (t?.shape) return t.shape;
  if (id === doc.root) return 'rounded';
  return THEME_SHAPE[theme];
}

export function derivedTextColour(colour: string, shape: ShapeName): 'ink' | 'white' {
  if (shape !== 'filled' && shape !== 'rounded') return 'ink';
  return relativeLuminance(colourHex(colour)) >= 0.2 ? 'ink' : 'white';
}
