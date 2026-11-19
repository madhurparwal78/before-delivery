import type { CategoryId, Content, Motif, Project, Statistic } from '../shared/types.js';

const CATEGORIES: readonly CategoryId[] = [
  'brand-identity',
  'website-design',
  'digital-product-design',
];
const MOTIFS: readonly Motif[] = ['arcs', 'grid', 'stack'];
const SLUG = /^[a-z][a-z0-9-]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEXT_MAX = 1200;

class ShapeError extends Error {}

const fail = (): never => {
  throw new ShapeError();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function keys(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return fail();
  const actual = Object.keys(value);
  if (actual.length !== expected.length) return fail();
  for (const key of expected) {
    if (!actual.includes(key)) return fail();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const length = [...value].length;
  if (length < 1 || length > TEXT_MAX) return fail();
  return value;
}

function wholeNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail();
  }
  return value;
}

function list<T>(value: unknown, min: number, max: number, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail();
  return value.map(item);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return fail();
  return value as T;
}

const PROJECT_KEYS = [
  'slug',
  'title',
  'client',
  'category',
  'year',
  'hue',
  'motif',
  'role',
  'duration',
  'standfirst',
  'overview',
  'objectives',
  'palette',
  'screens',
  'process',
  'results',
];

const STATISTIC_KEYS = ['id', 'value', 'label', 'note', 'parts'];

function project(entry: unknown): Project {
  const raw = keys(entry, PROJECT_KEYS);
  const slug = text(raw['slug']);
  if (!SLUG.test(slug) || slug.length < 2 || slug.length > 40) fail();
  return {
    slug,
    title: text(raw['title']),
    client: text(raw['client']),
    category: oneOf(raw['category'], CATEGORIES),
    year: wholeNumber(raw['year'], 2000, 2026),
    hue: wholeNumber(raw['hue'], 0, 359),
    motif: oneOf(raw['motif'], MOTIFS),
    role: text(raw['role']),
    duration: text(raw['duration']),
    standfirst: text(raw['standfirst']),
    overview: text(raw['overview']),
    objectives: list(raw['objectives'], 1, 5, text),
    palette: list(raw['palette'], 1, 5, (colour) => {
      const fields = keys(colour, ['name', 'hex']);
      const hex = fields['hex'];
      if (typeof hex !== 'string' || !HEX.test(hex)) fail();
      return { name: text(fields['name']), hex: hex as string };
    }),
    screens: list(raw['screens'], 1, 6, (screen) => ({
      caption: text(keys(screen, ['caption'])['caption']),
    })),
    process: list(raw['process'], 4, 4, (weeks) => wholeNumber(weeks, 1, 12)),
    results: list(raw['results'], 1, 4, (result) => {
      const fields = keys(result, ['value', 'label']);
      return { value: text(fields['value']), label: text(fields['label']) };
    }),
  };
}

function statistic(entry: unknown): Statistic {
  const raw = keys(entry, STATISTIC_KEYS);
  const value = wholeNumber(raw['value'], 1, 99_999);
  const parts = list(raw['parts'], 2, 4, (part) => {
    const fields = keys(part, ['label', 'value']);
    return { label: text(fields['label']), value: wholeNumber(fields['value'], 0, 99_999) };
  });
  if (parts.reduce((total, part) => total + part.value, 0) !== value) fail();
  return {
    id: text(raw['id']),
    value,
    label: text(raw['label']),
    note: text(raw['note']),
    parts,
  };
}

const unique = (values: string[]): boolean => new Set(values).size === values.length;

export function readContent(body: unknown): Content | null {
  try {
    const raw = keys(body, ['projects', 'stats']);
    const projects = list(raw['projects'], 1, 24, project);
    const stats = list(raw['stats'], 1, 4, statistic);
    if (!unique(projects.map((entry) => entry.slug))) fail();
    if (!unique(stats.map((entry) => entry.id))) fail();
    return { projects, stats };
  } catch (error) {
    if (error instanceof ShapeError) return null;
    throw error;
  }
}
