/**
 * Seed catalogue and reference tables for Lightfall.
 * Money values are integer cents without GST.
 * Candela table: [beam][cct] as flat records; generated variant records carry the final figures.
 */

export interface FinishDef { code: string; name: string }
export interface ProductDef {
  slug: string
  name: string
  code: string
  family: string
  description: string
  watts: number
  cri: number
  ip_rating: string
  default_variant: string
  base_retail: number
  base_trade: number
  finishes: string[]
  beams: number[]
  ccts: number[]
  finish_surcharge_retail: Record<string, number>
  finish_surcharge_trade: Record<string, number>
  beam_surcharge_retail: Record<string, number>
  beam_surcharge_trade: Record<string, number>
  lumens_by_cct: Record<number, number>
  candela_by_beam_cct: Record<string, number>
  extra_variants: VariantSeed[]
}

export interface VariantSeed {
  code: string
  finish: string
  beam: number
  cct: number
  lumens: number
  candela: number
  retail_price_cents: number
  trade_price_cents: number
  clearance: boolean
  clearance_price_cents: number | null
  was_price_cents: number
  stock_on_hand: number
}

export const FINISHES: FinishDef[] = [
  { code: 'WH', name: 'Matte White' },
  { code: 'BK', name: 'Matte Black' },
  { code: 'BR', name: 'Brushed Brass' },
  { code: 'BZ', name: 'Aged Bronze' },
  { code: 'CH', name: 'Charcoal' },
  { code: 'SN', name: 'Satin Nickel' },
]

export function finish_name(code: string): string {
  const f = FINISHES.find((x) => x.code === code)
  return f ? f.name : code
}

export const PRODUCT_DEFS: ProductDef[] = [
  {
    slug: 'kauri-downlight',
    name: 'Kauri Downlight',
    code: 'KDL',
    family: 'downlights',
    description: 'Deep-recessed downlight with a glare-free trim.',
    watts: 10,
    cri: 95,
    ip_rating: 'IP44',
    default_variant: 'KDL-WH-36-3000',
    base_retail: 8900,
    base_trade: 6400,
    finishes: ['WH', 'BK', 'BR'],
    beams: [24, 36, 60],
    ccts: [2700, 3000, 4000],
    finish_surcharge_retail: { BR: 2000 },
    finish_surcharge_trade: { BR: 1400 },
    beam_surcharge_retail: { 24: 600 },
    beam_surcharge_trade: { 24: 400 },
    lumens_by_cct: { 2700: 860, 3000: 900, 4000: 940 },
    candela_by_beam_cct: {
      '24-2700': 6260, '24-3000': 6550, '24-4000': 6840,
      '36-2700': 2800, '36-3000': 2930, '36-4000': 3060,
      '60-2700': 1020, '60-3000': 1070, '60-4000': 1120,
    },
    extra_variants: [],
  },
  {
    slug: 'totara-track-spot',
    name: 'Tōtara Track Spot',
    code: 'TTS',
    family: 'track-spots',
    description: 'Three-circuit track spot with a rotating, tilting head.',
    watts: 13,
    cri: 95,
    ip_rating: 'IP20',
    default_variant: 'TTS-BK-24-3000',
    base_retail: 14900,
    base_trade: 10500,
    finishes: ['BK', 'WH'],
    beams: [15, 24, 36],
    ccts: [2700, 3000, 4000],
    finish_surcharge_retail: {},
    finish_surcharge_trade: {},
    beam_surcharge_retail: { 15: 900, 24: 600 },
    beam_surcharge_trade: { 15: 600, 24: 400 },
    lumens_by_cct: { 2700: 1150, 3000: 1200, 4000: 1260 },
    candela_by_beam_cct: {
      '15-2700': 21370, '15-3000': 22300, '15-4000': 23420,
      '24-2700': 8380, '24-3000': 8740, '24-4000': 9180,
      '36-2700': 3740, '36-3000': 3900, '36-4000': 4100,
    },
    extra_variants: [],
  },
  {
    slug: 'pohutukawa-pendant',
    name: 'Pōhutukawa Pendant',
    code: 'PHP',
    family: 'pendants',
    description: 'Spun pendant with a softly diffused 60° downward beam.',
    watts: 16,
    cri: 90,
    ip_rating: 'IP20',
    default_variant: 'PHP-BR-60-2700',
    base_retail: 32000,
    base_trade: 22400,
    finishes: ['BR', 'BZ'],
    beams: [60],
    ccts: [2700, 3000],
    finish_surcharge_retail: { BZ: 2500 },
    finish_surcharge_trade: { BZ: 1750 },
    beam_surcharge_retail: {},
    beam_surcharge_trade: {},
    lumens_by_cct: { 2700: 1400, 3000: 1450 },
    candela_by_beam_cct: { '60-2700': 1660, '60-3000': 1720 },
    extra_variants: [],
  },
  {
    slug: 'harbour-surface-cylinder',
    name: 'Harbour Surface Cylinder',
    code: 'HSC',
    family: 'surface',
    description: 'Surface-mounted cylinder for concrete and exposed ceilings.',
    watts: 8,
    cri: 90,
    ip_rating: 'IP54',
    default_variant: 'HSC-WH-24-3000',
    base_retail: 12500,
    base_trade: 8750,
    finishes: ['WH', 'BK'],
    beams: [24, 36],
    ccts: [3000, 4000],
    finish_surcharge_retail: {},
    finish_surcharge_trade: {},
    beam_surcharge_retail: { 24: 600 },
    beam_surcharge_trade: { 24: 400 },
    lumens_by_cct: { 3000: 700, 4000: 740 },
    candela_by_beam_cct: {
      '24-3000': 5100, '24-4000': 5390,
      '36-3000': 2280, '36-4000': 2410,
    },
    extra_variants: [
      {
        code: 'HSC-CH-24-3000',
        finish: 'CH',
        beam: 24,
        cct: 3000,
        lumens: 700,
        candela: 5100,
        retail_price_cents: 7900,
        trade_price_cents: 7900,
        clearance: true,
        clearance_price_cents: 7900,
        was_price_cents: 12500,
        stock_on_hand: 1,
      },
    ],
  },
  {
    slug: 'rimu-gimbal-downlight',
    name: 'Rimu Gimbal Downlight',
    code: 'RGD',
    family: 'downlights',
    description: 'Adjustable gimbal downlight, final production run.',
    watts: 8,
    cri: 90,
    ip_rating: 'IP44',
    default_variant: 'RGD-SN-36-3000',
    base_retail: 11900,
    base_trade: 8300,
    finishes: ['SN'],
    beams: [36],
    ccts: [3000],
    finish_surcharge_retail: {},
    finish_surcharge_trade: {},
    beam_surcharge_retail: {},
    beam_surcharge_trade: {},
    lumens_by_cct: { 3000: 650 },
    candela_by_beam_cct: { '36-3000': 2110 },
    extra_variants: [
      {
        code: 'RGD-SN-36-3000',
        finish: 'SN',
        beam: 36,
        cct: 3000,
        lumens: 650,
        candela: 2110,
        retail_price_cents: 5900,
        trade_price_cents: 5900,
        clearance: true,
        clearance_price_cents: 5900,
        was_price_cents: 11900,
        stock_on_hand: 3,
      },
    ],
  },
]

/** Generate every variant of a product from its definition. */
export function product_variants(p: ProductDef): VariantSeed[] {
  const out: VariantSeed[] = []
  const use_clearance_default =
    p.extra_variants.length > 0 && p.extra_variants.every((v) => v.code === p.default_variant)
  for (const finish of p.finishes) {
    for (const beam of p.beams) {
      for (const cct of p.ccts) {
        if (use_clearance_default) continue
        out.push({
          code: `${p.code}-${finish}-${beam}-${cct}`,
          finish,
          beam,
          cct,
          lumens: p.lumens_by_cct[cct]!,
          candela: p.candela_by_beam_cct[`${beam}-${cct}`]!,
          retail_price_cents:
            p.base_retail + (p.finish_surcharge_retail[finish] ?? 0) + (p.beam_surcharge_retail[beam] ?? 0),
          trade_price_cents:
            p.base_trade + (p.finish_surcharge_trade[finish] ?? 0) + (p.beam_surcharge_trade[beam] ?? 0),
          clearance: false,
          clearance_price_cents: null,
          was_price_cents: 0,
          stock_on_hand: 0,
        })
      }
    }
  }
  out.push(...p.extra_variants)
  return out
}

/** The full flat variant list in catalogue order. */
export function all_variants(): VariantSeed[] {
  return PRODUCT_DEFS.flatMap(product_variants)
}
