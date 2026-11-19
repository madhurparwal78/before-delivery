import { isCountryCode } from '../../shared/countries.js';
import { FIELD_COPY } from '../../shared/copy.js';
import { invalid } from '../http/errors.js';
import type { StretchPoint } from '../data/campaigns.js';
import type { TierFields } from '../data/tiers.js';
import { isTimeZone, resolveLocalDeadline } from './timezone.js';

export class FieldErrors {
  private readonly messages: Record<string, string> = {};

  add(field: string, message: string): void {
    this.messages[field] ??= message;
  }

  get any(): boolean {
    return Object.keys(this.messages).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw invalid(this.messages);
  }
}

export function readString(body: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' ? value : null;
}

export function readInteger(
  body: Readonly<Record<string, unknown>>,
  field: string,
): number | null {
  const value = body[field];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function inRange(value: number, low: number, high: number): boolean {
  return value >= low && value <= high;
}

export interface CampaignInput {
  title: string;
  story: string;
  goal: number;
  min_run_copies: number;
  stretch: StretchPoint[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
}

interface CampaignDefaults {
  title: string;
  story: string;
  goal: number;
  min_run_copies: number;
  stretch: StretchPoint[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
}

function validateStretch(
  raw: unknown,
  minRunCopies: number,
  goal: number,
  errors: FieldErrors,
): StretchPoint[] {
  if (!Array.isArray(raw)) {
    errors.add('stretch', 'Give between 0 and 3 break points.');
    return [];
  }
  if (raw.length > 3) {
    errors.add('stretch', 'Give between 0 and 3 break points.');
    return [];
  }
  const points: StretchPoint[] = [];
  let previousCopies = minRunCopies;
  let previousAmount = goal;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.add('stretch', 'Each break point needs copies and an amount.');
      return [];
    }
    const record = entry as Record<string, unknown>;
    const copies = record['copies'];
    const amount = record['amount'];
    if (
      typeof copies !== 'number' ||
      !Number.isSafeInteger(copies) ||
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount)
    ) {
      errors.add('stretch', 'Each break point needs copies and an amount.');
      return [];
    }
    if (copies <= previousCopies) {
      errors.add('stretch', 'Each break point needs more copies than the one before it.');
      return [];
    }
    if (amount <= previousAmount) {
      errors.add('stretch', 'Each break point needs a higher amount than the one before it.');
      return [];
    }
    previousCopies = copies;
    previousAmount = amount;
    points.push({ copies, amount });
  }
  return points;
}

/**
 * Validates the campaign create fields, or any subset of them over existing values.
 * Throws a 422 listing every field at fault.
 */
export function validateCampaign(
  body: Readonly<Record<string, unknown>>,
  defaults: CampaignDefaults | null,
): CampaignInput {
  const errors = new FieldErrors();
  /** A create validates every field; a patch validates only the fields it carries. */
  const sent = (field: string): boolean => defaults === null || Object.hasOwn(body, field);

  let title = defaults?.title ?? '';
  if (sent('title')) {
    title = readString(body, 'title') ?? '';
    if (title.length < 1 || title.length > 120) {
      errors.add('title', 'Give a title of 1 to 120 characters.');
    }
  }

  let story = defaults?.story ?? '';
  if (sent('story')) {
    const value = readString(body, 'story');
    if (value === null) errors.add('story', 'Give a story.');
    else if (value.length > 20_000) errors.add('story', 'Keep the story under 20,000 characters.');
    else story = value;
  }

  let goal = defaults?.goal ?? 10_000;
  if (sent('goal')) {
    const value = readInteger(body, 'goal');
    if (value === null || !inRange(value, 10_000, 10_000_000)) {
      errors.add('goal', 'Give a goal from 100.00 to 100,000.00.');
    } else {
      goal = value;
    }
  }

  let minRunCopies = defaults?.min_run_copies ?? 10;
  if (sent('min_run_copies')) {
    const value = readInteger(body, 'min_run_copies');
    if (value === null || !inRange(value, 10, 100_000)) {
      errors.add('min_run_copies', 'Give a minimum run of 10 to 100,000 copies.');
    } else {
      minRunCopies = value;
    }
  }

  const stretch = sent('stretch')
    ? validateStretch(body['stretch'] ?? [], minRunCopies, goal, errors)
    : (defaults as CampaignDefaults).stretch;

  let shipsFrom = defaults?.ships_from ?? 'GB';
  if (sent('ships_from')) {
    const value = readString(body, 'ships_from') ?? '';
    if (!isCountryCode(value)) errors.add('ships_from', 'Choose a country Dotgain ships from.');
    else shipsFrom = value;
  }

  let timeZone = defaults?.time_zone ?? 'Europe/London';
  if (sent('time_zone')) {
    const value = readString(body, 'time_zone') ?? '';
    if (!isTimeZone(value)) errors.add('time_zone', 'Choose an IANA time zone name.');
    else timeZone = value;
  }

  const deadlineText = sent('deadline_local')
    ? (readString(body, 'deadline_local') ?? '')
    : (defaults as CampaignDefaults).deadline_local;
  const resolved = resolveLocalDeadline(deadlineText, timeZone);
  if (resolved === null) {
    errors.add('deadline_local', 'Give a local date and time that exists in this time zone.');
  }

  errors.throwIfAny();
  const deadline = resolved as { local: string; instant: Date };
  return {
    title,
    story,
    goal,
    min_run_copies: minRunCopies,
    stretch,
    ships_from: shipsFrom,
    time_zone: timeZone,
    deadline_local: deadline.local,
    deadline_utc: deadline.instant,
  };
}

export function validateTier(
  body: Readonly<Record<string, unknown>>,
  defaults: TierFields | null,
): TierFields {
  const errors = new FieldErrors();
  const sent = (field: string): boolean => defaults === null || Object.hasOwn(body, field);

  let title = defaults?.title ?? '';
  if (sent('title')) {
    title = readString(body, 'title') ?? '';
    if (title.length < 1 || title.length > 80) {
      errors.add('title', 'Give a tier title of 1 to 80 characters.');
    }
  }

  let description = defaults?.description ?? '';
  if (sent('description')) {
    const value = readString(body, 'description');
    if (value === null) errors.add('description', 'Give a description.');
    else if (value.length > 1_000) {
      errors.add('description', 'Keep the description under 1,000 characters.');
    } else {
      description = value;
    }
  }

  let price = defaults?.price ?? 100;
  if (sent('price')) {
    const value = readInteger(body, 'price');
    if (value === null || !inRange(value, 100, 1_000_000)) {
      errors.add('price', 'Give a price from 1.00 to 10,000.00.');
    } else {
      price = value;
    }
  }

  let quantity = defaults?.quantity ?? null;
  if (sent('quantity')) {
    const raw = body['quantity'];
    if (raw === null || raw === undefined) {
      quantity = null;
    } else {
      const value = readInteger(body, 'quantity');
      if (value === null || !inRange(value, 1, 100_000)) {
        errors.add('quantity', 'Give 1 to 100,000 copies, or leave it blank for an open edition.');
      } else {
        quantity = value;
      }
    }
  }

  let shipping = defaults === null
    ? { domestic: 0, europe: 0, rest_of_world: 0 }
    : { ...defaults.shipping };
  if (sent('shipping')) {
    const raw = body['shipping'];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.add('shipping', 'Give a shipping price for each zone.');
    } else {
      const record = raw as Record<string, unknown>;
      const read = (zone: 'domestic' | 'europe' | 'rest_of_world'): number => {
        const value = record[zone];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || !inRange(value, 0, 10_000)) {
          errors.add('shipping', 'Give each shipping price from 0.00 to 100.00.');
          return 0;
        }
        return value;
      };
      shipping = {
        domestic: read('domestic'),
        europe: read('europe'),
        rest_of_world: read('rest_of_world'),
      };
    }
  }

  errors.throwIfAny();
  return { title, description, price, quantity, shipping };
}

export function validateCountry(body: Readonly<Record<string, unknown>>, errors: FieldErrors): string {
  const value = readString(body, 'country') ?? '';
  if (!isCountryCode(value)) errors.add('country', 'Choose a country Dotgain ships to.');
  return value;
}

export function validateAddOn(body: Readonly<Record<string, unknown>>, errors: FieldErrors): number {
  const value = readInteger(body, 'add_on');
  if (value === null || !inRange(value, 0, 50_000)) {
    errors.add('add_on', FIELD_COPY.add_on);
    return 0;
  }
  return value;
}
