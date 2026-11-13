import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { EngravedSystem, PartLayout } from '../../shared/types.js';
import { loadScore, loadVoices } from '../store/score.js';
import { Engraving } from './engrave.js';

const here = dirname(fileURLToPath(import.meta.url));
const fontDirectory = join(here, '..', 'assets', 'fonts');

const FACES: { family: string; file: string; style: string; weight: string }[] = [
  { family: 'Bravura', file: 'bravura-subset.woff2', style: 'normal', weight: '400' },
  { family: 'Fraunces', file: 'fraunces-600.woff2', style: 'normal', weight: '600' },
  { family: 'IBM Plex Sans', file: 'plex-sans-400.woff2', style: 'normal', weight: '400' },
  { family: 'IBM Plex Sans', file: 'plex-sans-400-italic.woff2', style: 'italic', weight: '400' },
  { family: 'IBM Plex Sans', file: 'plex-sans-600.woff2', style: 'normal', weight: '600' },
  { family: 'IBM Plex Mono', file: 'plex-mono-400.woff2', style: 'normal', weight: '400' },
];

let faces: string | null = null;

/** The fonts embedded in stored part pages, so a page renders the same everywhere. */
export async function embeddedFontFaces(): Promise<string> {
  if (faces !== null) return faces;
  const blocks = await Promise.all(
    FACES.map(async (face) => {
      const bytes = await readFile(join(fontDirectory, face.file));
      return `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');}`;
    }),
  );
  faces = blocks.join('');
  return faces;
}

interface CacheEntry {
  key: string;
  engraving: Engraving;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(
  scoreId: string,
  view: 'score' | 'part',
  partId: string | null,
  lamport: number,
  measureCount: number,
  layout: PartLayout,
): string {
  return `${scoreId}|${view}|${partId ?? ''}|${lamport}|${measureCount}|${JSON.stringify(layout)}`;
}

export interface EngraveRequest {
  scoreId: string;
  view: 'score' | 'part';
  partId: string | null;
}

export interface EngraveResult {
  engraving: Engraving;
  lamport: number;
  partName: string | null;
}

export async function engrave(request: EngraveRequest): Promise<EngraveResult> {
  const state = await loadScore(request.scoreId);
  const part = request.partId
    ? state.parts.find((candidate) => candidate.id === request.partId) ?? null
    : null;
  const staves =
    request.view === 'part' && part
      ? state.staves.filter((staff) => part.staffIds.includes(staff.id))
      : state.staves;
  const layout: PartLayout =
    request.view === 'part' && part ? part.layout : { systemBreaks: [], pageBreaks: [] };
  const key = cacheKey(
    request.scoreId,
    request.view,
    request.partId,
    state.head.lamport,
    state.head.measureCount,
    layout,
  );
  const held = cache.get(key);
  if (held) {
    return { engraving: held.engraving, lamport: state.head.lamport, partName: part?.name ?? null };
  }
  const voices = await loadVoices(
    request.scoreId,
    staves.map((staff) => staff.id),
  );
  const engraving = new Engraving({
    title: state.head.title,
    view: request.view,
    partName: part?.name ?? null,
    staves,
    voices,
    meter: state.meter,
    measureCount: state.head.measureCount,
    layout,
  });
  cache.set(key, { key, engraving });
  if (cache.size > 24) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return { engraving, lamport: state.head.lamport, partName: part?.name ?? null };
}

export function systemsPage(
  result: EngraveResult,
  cursor: number,
  limit: number,
): { systems: EngravedSystem[]; nextCursor: string | null } {
  const slice = result.engraving.systems.slice(cursor, cursor + limit);
  const systems: EngravedSystem[] = slice.map((system) => ({
    index: system.index,
    page: system.page,
    firstMeasure: system.firstMeasure,
    lastMeasure: system.lastMeasure,
    svg: result.engraving.systemSvg(system),
  }));
  const next = cursor + slice.length;
  return {
    systems,
    nextCursor: next < result.engraving.systems.length ? encodeCursor(next) : null,
  };
}

export function encodeCursor(index: number): string {
  return Buffer.from(`s${index}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): number | null {
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    if (!text.startsWith('s')) return null;
    const value = Number(text.slice(1));
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
