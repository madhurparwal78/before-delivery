import type { Currency, Lang } from './i18n'

export const SEARCH_KEYS = ['dest', 'in', 'out', 'adults', 'ages', 'lang', 'cur', 'display', 'tax', 'stars', 'amen', 'free', 'min', 'max', 'sort', 'cursor', 'zoom', 'cx', 'cy', 'sel'] as const
type SearchKey = (typeof SEARCH_KEYS)[number]

export const SORTS = ['rank', 'price_asc', 'price_desc', 'score_desc', 'distance_asc'] as const
export type Sort = (typeof SORTS)[number]
export const AMENITIES = ['pool', 'parking', 'wifi', 'spa', 'pets'] as const

export interface SearchParams {
  dest: string; in: string; out: string; adults: number; ages: number[]; lang: Lang; cur: Currency; display: 'total' | 'night'; tax: boolean
  stars: number[]; amen: string[]; free: boolean; min: number | null; max: number | null; sort: Sort; cursor: string | null
  view: { zoom: number; cx: number; cy: number } | null; sel: string | null
}

export const encode = (value: string): string => encodeURIComponent(value).replace(/%2C/g, ',').replace(/%7E/g, '~')

/** The query string in the published order, with every default left out; dest, in, out, lang and cur are always present. */
export function buildQuery(p: SearchParams): string {
  const pairs: [SearchKey, string][] = [['dest', p.dest], ['in', p.in], ['out', p.out]]
  if (p.adults !== 2) pairs.push(['adults', String(p.adults)])
  if (p.ages.length) pairs.push(['ages', [...p.ages].sort((a, b) => a - b).join(',')])
  pairs.push(['lang', p.lang], ['cur', p.cur])
  if (p.display !== 'total') pairs.push(['display', p.display])
  if (!p.tax) pairs.push(['tax', '0'])
  if (p.stars.length) pairs.push(['stars', [...p.stars].sort((a, b) => a - b).join(',')])
  if (p.amen.length) pairs.push(['amen', [...p.amen].sort().join(',')])
  if (p.free) pairs.push(['free', '1'])
  if (p.min !== null) pairs.push(['min', String(p.min)])
  if (p.max !== null) pairs.push(['max', String(p.max)])
  if (p.sort !== 'rank') pairs.push(['sort', p.sort])
  if (p.cursor) pairs.push(['cursor', p.cursor])
  if (p.view) pairs.push(['zoom', String(p.view.zoom)], ['cx', p.view.cx.toFixed(1)], ['cy', p.view.cy.toFixed(1)])
  if (p.sel) pairs.push(['sel', p.sel])
  return pairs.map(([key, value]) => `${key}=${encode(value)}`).join('&')
}

/** Reads an already canonical query (as returned by the server) back into parameters. */
export function parseCanonical(query: string): Partial<SearchParams> & { raw: Record<string, string> } {
  const raw: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(query)) raw[key] = value
  const list = (value: string | undefined): number[] => (value ? value.split(',').map(Number).filter(Number.isFinite) : [])
  const result: Partial<SearchParams> & { raw: Record<string, string> } = { raw }
  if (raw.dest) result.dest = raw.dest
  if (raw.in) result.in = raw.in
  if (raw.out) result.out = raw.out
  result.adults = raw.adults ? Number(raw.adults) : 2
  result.ages = list(raw.ages)
  result.lang = (raw.lang as Lang) || 'en'
  result.cur = (raw.cur as Currency) || 'EUR'
  result.display = raw.display === 'night' ? 'night' : 'total'
  result.tax = raw.tax !== '0'
  result.stars = list(raw.stars)
  result.amen = raw.amen ? raw.amen.split(',') : []
  result.free = raw.free === '1'
  result.min = raw.min ? Number(raw.min) : null
  result.max = raw.max ? Number(raw.max) : null
  result.sort = (SORTS as readonly string[]).includes(raw.sort) ? (raw.sort as Sort) : 'rank'
  result.cursor = raw.cursor || null
  result.view = raw.zoom && raw.cx && raw.cy ? { zoom: Number(raw.zoom), cx: Number(raw.cx), cy: Number(raw.cy) } : null
  result.sel = raw.sel || null
  return result
}
