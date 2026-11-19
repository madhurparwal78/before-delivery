/**
 * Rows become the published API bodies here. Every key is camelCase and every
 * instant is whole-second UTC with a Z.
 */
import { F } from '../shared/feedback.ts';
import type { Language } from '../shared/language.ts';
import { parseDec, toFixed } from './domain/decimal.ts';
import {
  formatMinor,
  minorToDec,
  splitMilestones,
  type Currency,
  MILESTONE_PERCENTS,
} from './domain/money.ts';
import { boxOf, type PieceName, type Placement } from './domain/layout.ts';
import {
  englishDate,
  englishDateAt,
  englishDateTimeAt,
  instantText,
  localTime,
  parseDate,
  TOWN_ZONE,
  type Town,
} from './domain/time.ts';

export type Row = Record<string, unknown>;

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const instant = (value: unknown): string | null =>
  value === null || value === undefined ? null : instantText(new Date(value as string).getTime());

// ---------------------------------------------------------------------- client

export const CLIENT_STATES = ['active', 'closing', 'erasing', 'erased'] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

export function presentClient(row: Row): Row {
  if (row.state === 'erased') {
    return { id: String(row.id), name: F.erasedClient, state: 'erased' };
  }
  return {
    id: String(row.id),
    name: String(row.name),
    town: String(row.town),
    language: String(row.language),
    email: text(row.email),
    state: String(row.state),
    closesAt: instant(row.closes_at),
  };
}

// ----------------------------------------------------------------------- piece

export const PIECE_STATES = [
  'received',
  'inSurvey',
  'onTheBench',
  'ready',
  'collected',
  'archived',
] as const;
export type PieceState = (typeof PIECE_STATES)[number];

export const PIECE_STATE_NAMES: Record<PieceState, string> = {
  received: 'Received',
  inSurvey: 'In survey',
  onTheBench: 'On the bench',
  ready: 'Ready',
  collected: 'Collected',
  archived: 'Archived',
};

export function presentPiece(row: Row): Row {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: row.client_name === undefined ? undefined : String(row.client_name),
    title: String(row.title),
    maker: text(row.maker),
    year: text(row.year),
    stampNumber: text(row.stamp_number),
    widthCm: num(row.width_cm),
    depthCm: num(row.depth_cm),
    heightCm: num(row.height_cm),
    weightKg: num(row.weight_kg),
    dueDate: text(row.due_date),
    notes: text(row.notes),
    state: String(row.state),
    createdAt: instant(row.created_at),
  };
}

// ------------------------------------------------------------------------- pin

export const PIN_KINDS = ['tear', 'crack', 'stain', 'looseJoint', 'woodworm'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export const PIN_KIND_NAMES: Record<PinKind, string> = {
  tear: 'Tear',
  crack: 'Crack',
  stain: 'Stain',
  looseJoint: 'Loose joint',
  woodworm: 'Woodworm',
};

export function presentPin(row: Row): Row {
  return {
    id: String(row.id),
    number: Number(row.number),
    x: String(row.x),
    y: String(row.y),
    kind: String(row.kind),
    note: String(row.note),
    signed: Boolean(row.signed),
  };
}

// ------------------------------------------------------------------ photograph

export function presentPhotograph(row: Row): Row {
  return {
    id: String(row.id),
    number: Number(row.number),
    side: String(row.side),
    sha256: String(row.sha256),
    bytes: Number(row.bytes),
    state: String(row.state),
    createdAt: instant(row.created_at),
  };
}

// ---------------------------------------------------------------------- layout

export function presentLayout(row: Row, flaws: readonly Row[], hide: Row): Row {
  const placements = row.placements as Placement[];
  return {
    version: Number(row.version),
    hide,
    flaws,
    pieces: placements.map((p) => {
      const box = boxOf(p.name as PieceName, p.rotation);
      return {
        name: p.name,
        width: box.width,
        height: box.height,
        x: p.x,
        y: p.y,
        rotation: p.rotation,
        state: p.state,
      };
    }),
    changedAt: instant(row.changed_at),
  };
}

// ------------------------------------------------------------------------ hold

export function presentHold(row: Row): Row {
  const endsOn = parseDate(String(row.ends_on));
  const dateText = endsOn ? englishDate(endsOn) : String(row.ends_on);
  const state = String(row.state);
  return {
    id: String(row.id),
    holdId: String(row.hold_id),
    code: String(row.code),
    lot: String(row.lot),
    quantity: String(row.quantity),
    state,
    endsOn: String(row.ends_on),
    label: state === 'held' ? F.heldUntil(dateText) : F.holdEnded(dateText),
  };
}

/** `2 hides`, `1 hide` or `7.50 m`. */
export function quantityText(quantity: string, unit: 'sqFt' | 'metre'): string {
  if (unit === 'metre') return `${quantity} m`;
  return quantity === '1' ? '1 hide' : `${quantity} hides`;
}

// -------------------------------------------------------------------- estimate

export function presentEstimate(row: Row): Row {
  const currency = String(row.currency) as Currency;
  const totalMinor = BigInt(String(row.total_minor));
  const milestones = splitMilestones(totalMinor);
  const amount = (value: unknown): string => formatMinor(currency, BigInt(String(value)));

  // A preview carries no id, no version and no instant: nothing is kept.
  const kept = row.id === null || row.id === undefined ? {} : { id: String(row.id) };
  return {
    ...kept,
    version: Number(row.version),
    state: String(row.state),
    currency,
    materialCode: text(row.material_code),
    lot: text(row.lot),
    patternAreaSqFt: text(row.pattern_area),
    hides: num(row.hides),
    metres: text(row.metres),
    labourHours: String(row.labour_hours),
    labourRateMinor: Number(row.labour_rate_minor),
    materialMinor: Number(row.material_minor),
    labourMinor: Number(row.labour_minor),
    subtotalMinor: Number(row.subtotal_minor),
    taxPercent: Number(row.tax_percent),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(totalMinor),
    milestones: MILESTONE_PERCENTS.map((percent, i) => ({
      percent,
      amountMinor: Number(milestones[i]!),
    })),
    display: {
      material: amount(row.material_minor),
      labour: amount(row.labour_minor),
      labourRate: amount(row.labour_rate_minor),
      subtotal: amount(row.subtotal_minor),
      tax: amount(row.tax_minor),
      total: amount(totalMinor),
      milestones: milestones.map((m) => formatMinor(currency, m)),
    },
    signedBy: text(row.signed_by),
    signedAt: instant(row.signed_at),
    createdAt: instant(row.created_at),
  };
}

export function estimateTotalText(row: Row): string {
  return formatMinor(String(row.currency) as Currency, BigInt(String(row.total_minor)));
}

export function amountText(currency: Currency, minor: bigint): string {
  return formatMinor(currency, minor);
}

export { minorToDec };

// ------------------------------------------------------------------ bench jobs

export const BENCH_NAMES = { frame: 'Frame bench', cover: 'Cover bench' } as const;
export type Bench = keyof typeof BENCH_NAMES;

export function presentBenchJob(row: Row, curesAtMs: number | null, nowMs: number): Row {
  const day = parseDate(String(row.day));
  const glueLaid = row.glue_laid_at === null || row.glue_laid_at === undefined ? null : row.glue_laid_at;
  const glue =
    glueLaid === null || curesAtMs === null
      ? null
      : {
          laidAt: instant(glueLaid),
          curesAt: instantText(curesAtMs),
          state: nowMs >= curesAtMs ? 'cured' : 'curing',
          label:
            nowMs >= curesAtMs
              ? 'Cured'
              : `Curing until ${englishDateTimeAt(TOWN_ZONE.Turin, curesAtMs, 'Turin')}`,
        };
  return {
    id: String(row.id),
    pieceId: String(row.piece_id),
    pieceTitle: String(row.piece_title),
    bench: String(row.bench),
    day: String(row.day),
    dayLabel: day ? englishDate(day) : String(row.day),
    glue,
  };
}

// ------------------------------------------------------------------ collection

/** `Mon 29 Mar 2027, 09:00 New York time · 15:00 Turin time`. */
export function collectionDisplay(town: Town, collectAtMs: number): string {
  const zone = TOWN_ZONE[town];
  const localPart = `${englishDateAt(zone, collectAtMs)}, ${localTime(zone, collectAtMs)} ${town} time`;
  if (town === 'Turin') return localPart;
  return `${localPart} \u00b7 ${localTime(TOWN_ZONE.Turin, collectAtMs)} Turin time`;
}

/** `Mon 29 Mar 2027, 09:00 New York time`, the `<collection time>` placeholder. */
export function collectionTimeText(town: Town, collectAtMs: number): string {
  const zone = TOWN_ZONE[town];
  return `${englishDateAt(zone, collectAtMs)}, ${localTime(zone, collectAtMs)} ${town} time`;
}

export function presentCollection(row: Row): Row {
  const town = String(row.town) as Town;
  const collectAtMs = new Date(row.collect_at as string).getTime();
  return {
    id: String(row.id),
    state: String(row.state),
    collectAt: instantText(collectAtMs),
    localDate: String(row.local_date),
    localTime: String(row.local_time),
    town,
    display: collectionDisplay(town, collectAtMs),
    labelSha256: text(row.label_sha256),
  };
}

// --------------------------------------------------------------------- dossier

export function presentDossier(row: Row, history: readonly Row[]): Row {
  return {
    id: String(row.id),
    state: String(row.state),
    message: text(row.message),
    signedBy: text(row.signed_by),
    signedAt: instant(row.signed_at),
    history: history.map((h) => ({
      at: instant(h.at),
      who: String(h.who),
      what: String(h.what),
    })),
  };
}

// ------------------------------------------------------------------- materials

export function presentMaterial(row: Row): Row {
  return {
    code: String(row.code),
    name: String(row.name),
    family: String(row.family),
    unit: String(row.unit),
    prices: row.prices as Record<string, string>,
  };
}

export function presentRate(row: Row): Row {
  return {
    takesEffectOn: String(row.takes_effect_on),
    eur: String(row.eur),
    gbp: String(row.gbp),
    usd: String(row.usd),
    jpy: String(row.jpy),
    aed: String(row.aed),
  };
}

/** `L-2041-A, 2 hides at 48.25 sq ft` or `L-3000-A, 40.00 m`. */
export function lotLabel(lot: {
  lot: string;
  hides?: number;
  averageSqFt?: string;
  metres?: string;
}): string {
  if (lot.metres !== undefined) {
    const parsed = parseDec(lot.metres);
    return `${lot.lot}, ${parsed ? toFixed(parsed, 2) : lot.metres} m`;
  }
  const hides = lot.hides ?? 0;
  return `${lot.lot}, ${hides === 1 ? '1 hide' : `${hides} hides`} at ${lot.averageSqFt} sq ft`;
}

export function languageOf(row: Row): Language {
  return String(row.language) as Language;
}
