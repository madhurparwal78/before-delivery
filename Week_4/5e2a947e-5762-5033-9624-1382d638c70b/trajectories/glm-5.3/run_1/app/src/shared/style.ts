import type { ShapeName, ThemeName, TopicNode } from './types.js';

/**
 * The style cascade: colour, shape and text colour in exactly one place.
 */

export const BRANCH_COLOURS = ['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre'] as const;

export const COLOUR_HEX: Record<string, string> = {
  indigo: '#4f46e5',
  azure: '#0284c7',
  teal: '#0d9488',
  green: '#16a34a',
  violet: '#7c3aed',
  magenta: '#c026d3',
  orange: '#ea580c',
  ochre: '#d9a441',
  accent: '#2b4ef2',
};

export function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = f(r), G = f(g), B = f(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function textColourForFill(fill: string): 'ink' | 'white' {
  const hex = COLOUR_HEX[fill] ?? (fill.startsWith('#') ? fill : COLOUR_HEX.accent);
  return hexLuminance(hex) >= 0.2 ? 'ink' : 'white';
}

export const THEME_SHAPE: Record<ThemeName, ShapeName> = {
  daylight: 'pill',
  paper: 'underline',
  dusk: 'filled',
};

export interface StyleInput {
  topic: TopicNode;
  parentChain: TopicNode[]; // nearest ancestors first, ending at root
  level2Colour: string | null; // the level 2 ancestor's branch colour name
  theme: ThemeName;
}

/** Resolve a topic's colour: own override, else nearest ancestor's, else branch colour. */
export function resolveColour(topic: TopicNode, ancestors: TopicNode[], level2Colour: string | null, floatingIndex: number | null): string {
  if (topic.colour) return topic.colour;
  for (const a of ancestors) if (a.colour) return a.colour;
  if (topic.parent_id === null) {
    if (topic.floating && floatingIndex !== null) return BRANCH_COLOURS[floatingIndex % 8];
    return 'accent';
  }
  return level2Colour ?? 'accent';
}

export function resolveShape(topic: TopicNode, ancestors: TopicNode[], theme: ThemeName): ShapeName {
  if (topic.shape) return topic.shape;
  for (const a of ancestors) if (a.shape) return a.shape;
  if (topic.parent_id === null && !topic.floating) return 'rounded';
  return THEME_SHAPE[theme];
}
