import { isMarket, MARKETS, type Market } from '../../domain/markets.ts';
import { FIELD_COPY } from '../../domain/copy.ts';
import { isDropType, resolveCopenhagenGoLive, type DropType } from '../../domain/golive.ts';
import { SWATCH_NAMES } from '../../domain/palette.ts';
import {
  copenhagenWall,
  formatCopenhagenDate,
  formatLocalDateTime,
  parseInstant,
  parseLocalDateTime,
} from '../../domain/time.ts';
import { integer, list, Problems, readString, record, text } from '../http/validate.ts';
import { openingsFor, type DropTiming } from '../repo/timing.ts';
import { earliestOpening } from '../../domain/golive.ts';

export interface StyleInput {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
  rrpDkkMinor: number;
}

export interface DropInput {
  name?: string;
  type?: DropType;
  holdSeconds?: number;
  palette?: string[];
  internalNote?: string;
  markets?: Record<Market, number>;
  styles?: StyleInput[];
  timing?: DropTiming;
  status?: 'draft' | 'scheduled';
}

const NAME_LIMIT = 80;
const NOTE_LIMIT = 2000;
const STYLE_NAME_LIMIT = 80;

/**
 * Reads the drop fields in a body. With `partial`, fields that are not sent are not checked, so
 * the New drop form can check one step at a time.
 */
export function readDropInput(
  body: Record<string, unknown>,
  problems: Problems,
  options: { partial: boolean; currentType?: DropType; nowMs: number },
): DropInput {
  const input: DropInput = {};
  const has = (key: string): boolean => Object.hasOwn(body, key);

  if (has('name') || !options.partial) {
    input.name = text(problems, body, 'name', { max: NAME_LIMIT });
  }

  if (has('type')) {
    const value = readString(body, 'type');
    if (!isDropType(value)) {
      problems.add('type', FIELD_COPY.required);
    } else {
      input.type = value;
    }
  }

  if (has('holdSeconds')) {
    input.holdSeconds = integer(problems, body, 'holdSeconds', 10, 86_400, 'holdSeconds', 900);
  } else if (!options.partial) {
    input.holdSeconds = 900;
  }

  if (has('internalNote')) {
    input.internalNote = text(problems, body, 'internalNote', { max: NOTE_LIMIT, required: false });
  }

  if (has('palette')) {
    const palette = list(body, 'palette').map((entry) => (typeof entry === 'string' ? entry : ''));
    if (palette.length !== 3 || palette.some((swatch) => !SWATCH_NAMES.includes(swatch))) {
      problems.add('palette', FIELD_COPY.required);
    } else {
      input.palette = palette;
    }
  } else if (!options.partial) {
    input.palette = ['stone', 'ink', 'vermilion'];
  }

  if (has('markets')) {
    const markets = record(body['markets']);
    const collected: Partial<Record<Market, number>> = {};
    for (const market of MARKETS) {
      if (!Object.hasOwn(markets, market)) {
        problems.add(`markets.${market}`, FIELD_COPY.required);
        continue;
      }
      collected[market] = integer(problems, markets, market, 0, 100_000, `markets.${market}`);
    }
    if (!problems.any) input.markets = collected as Record<Market, number>;
  } else if (!options.partial) {
    problems.add('markets', FIELD_COPY.required);
  }

  if (has('styles')) {
    input.styles = readStyles(list(body, 'styles'), problems);
  } else if (!options.partial) {
    problems.add('styles', FIELD_COPY.required);
  }

  if (has('status')) {
    const status = readString(body, 'status');
    if (status !== 'draft' && status !== 'scheduled') {
      problems.add('status', FIELD_COPY.required);
    } else {
      input.status = status;
    }
  }

  const type = input.type ?? options.currentType ?? 'simultaneous';
  const timing = readTiming(body, problems, type, options);
  if (timing !== null) input.timing = timing;

  return input;
}

function readStyles(entries: readonly unknown[], problems: Problems): StyleInput[] {
  if (entries.length < 1 || entries.length > 50) {
    problems.add('styles', FIELD_COPY.range(1, 50));
    return [];
  }
  const styles: StyleInput[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const row = record(entry);
    const styleNumber = text(problems, row, 'styleNumber', { max: 40 }, `styles.${index}.styleNumber`);
    const name = text(problems, row, 'name', { max: STYLE_NAME_LIMIT }, `styles.${index}.name`);
    const colour = text(problems, row, 'colour', { max: 40 }, `styles.${index}.colour`);
    const wholesaleEdition = integer(
      problems,
      row,
      'wholesaleEdition',
      0,
      100_000,
      `styles.${index}.wholesaleEdition`,
      0,
    );
    const rrpDkkMinor = integer(
      problems,
      row,
      'rrpDkkMinor',
      0,
      100_000_000,
      `styles.${index}.rrpDkkMinor`,
      0,
    );
    const key = styleNumber.trim().toUpperCase();
    if (key !== '' && seen.has(key)) {
      problems.add(`styles.${index}.styleNumber`, FIELD_COPY.required);
    }
    seen.add(key);
    styles.push({ styleNumber, name, colour, wholesaleEdition, rrpDkkMinor });
  }
  return styles;
}

function readTiming(
  body: Record<string, unknown>,
  problems: Problems,
  type: DropType,
  options: { partial: boolean; nowMs: number },
): DropTiming | null {
  const hasInstant = Object.hasOwn(body, 'goLiveAt') && body['goLiveAt'] !== null;
  const hasCopenhagen = Object.hasOwn(body, 'copenhagenGoLive') && body['copenhagenGoLive'] !== null;
  const hasLocal = Object.hasOwn(body, 'localGoLive') && body['localGoLive'] !== null;
  if (!hasInstant && !hasCopenhagen && !hasLocal) return null;

  if (type === 'rolling') {
    if (hasInstant) problems.add('goLiveAt', FIELD_COPY.required);
    if (hasCopenhagen) problems.add('copenhagenGoLive', FIELD_COPY.required);
    const raw = readString(body, 'localGoLive');
    const wall = raw === null ? null : parseLocalDateTime(raw);
    if (wall === null) {
      problems.add('localGoLive', FIELD_COPY.instant);
      return null;
    }
    const timing: DropTiming = { type, goLiveAtMs: null, copenhagenGoLive: null, localGoLive: raw };
    checkLaterThanNow(problems, timing, options.nowMs, 'localGoLive');
    return timing;
  }

  if (hasLocal) problems.add('localGoLive', FIELD_COPY.required);
  if (hasInstant && hasCopenhagen) {
    problems.add('goLiveAt', FIELD_COPY.required);
    problems.add('copenhagenGoLive', FIELD_COPY.required);
    return null;
  }
  if (hasInstant) {
    const raw = readString(body, 'goLiveAt');
    const instantMs = raw === null ? null : parseInstant(raw);
    if (instantMs === null) {
      problems.add('goLiveAt', FIELD_COPY.instant);
      return null;
    }
    const timing: DropTiming = {
      type,
      goLiveAtMs: instantMs,
      copenhagenGoLive: copenhagenLocalOf(instantMs),
      localGoLive: null,
    };
    checkLaterThanNow(problems, timing, options.nowMs, 'goLiveAt');
    return timing;
  }

  const raw = readString(body, 'copenhagenGoLive');
  const wall = raw === null ? null : parseLocalDateTime(raw);
  if (wall === null) {
    problems.add('copenhagenGoLive', FIELD_COPY.instant);
    return null;
  }
  const resolved = resolveCopenhagenGoLive(wall);
  if (resolved.kind === 'gap') {
    problems.add('copenhagenGoLive', FIELD_COPY.gap(formatCopenhagenDate(resolved.gapDate)));
    return null;
  }
  const timing: DropTiming = {
    type,
    goLiveAtMs: resolved.instantMs,
    copenhagenGoLive: raw,
    localGoLive: null,
  };
  checkLaterThanNow(problems, timing, options.nowMs, 'copenhagenGoLive');
  return timing;
}

function checkLaterThanNow(
  problems: Problems,
  timing: DropTiming,
  nowMs: number,
  field: string,
): void {
  const openings = openingsFor(timing);
  const earliest = openings === null ? null : earliestOpening(openings);
  if (earliest !== null && earliest <= nowMs) problems.add(field, FIELD_COPY.notLater);
}

/** The Copenhagen local date-time of an instant, as the API writes it. */
export function copenhagenLocalOf(instantMs: number): string {
  return formatLocalDateTime(copenhagenWall(instantMs));
}

export function readMarketValue(value: unknown, problems: Problems, path: string): Market | null {
  if (!isMarket(value)) {
    problems.add(path, FIELD_COPY.unknownMarket);
    return null;
  }
  return value;
}
