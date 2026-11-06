import { FORMAT_OPTIONS } from './copy.js';

export interface BoardFilters {
  /** '1', '2' or 'all' when the address carries a value we do not publish. */
  readonly day: '1' | '2' | 'all';
  readonly dayKnown: boolean;
  readonly stage: string;
  readonly format: string;
  readonly search: string;
}

export function readFilters(search: string, stageSlugs: readonly string[]): BoardFilters {
  const params = new URLSearchParams(search);
  const rawDay = params.get('day');
  const day = rawDay === null ? '1' : rawDay === '1' || rawDay === '2' ? rawDay : 'all';
  const rawStage = params.get('stage');
  const stage = rawStage !== null && stageSlugs.includes(rawStage) ? rawStage : 'all';
  const rawFormat = params.get('format');
  const format = rawFormat !== null && FORMAT_OPTIONS.some((option) => option.slug === rawFormat) ? rawFormat : 'all';
  return { day, dayKnown: day !== 'all', stage, format, search: params.get('q') ?? '' };
}

/** The address in the published key order: day, stage, format, q. */
export function filtersToQuery(filters: BoardFilters): string {
  const parts: string[] = [];
  if (filters.day !== 'all') parts.push(`day=${filters.day}`);
  if (filters.stage !== 'all') parts.push(`stage=${encodeURIComponent(filters.stage)}`);
  if (filters.format !== 'all') parts.push(`format=${encodeURIComponent(filters.format)}`);
  if (filters.search !== '') parts.push(`q=${encodeURIComponent(filters.search)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export function boardHref(filters: BoardFilters): string {
  return `/agenda${filtersToQuery(filters)}`;
}

export function apiQuery(filters: BoardFilters): string {
  const parts = [`day=${filters.day}`, `stage=${filters.stage}`, `format=${filters.format}`];
  if (filters.search !== '') parts.push(`q=${encodeURIComponent(filters.search)}`);
  return `?${parts.join('&')}`;
}
