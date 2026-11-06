import { isValidLocalDateTime } from './time.js';
import {
  codePointLength,
  hasControlCharacters,
  integerField,
  isInteger,
  isJsonObject,
  stringField,
  type BodySpec,
  type FieldSpec,
} from './validate.js';

export const TITLE_LENGTH_MESSAGE = 'Title must be 1 to 120 characters';
export const TITLE_CONTROL_MESSAGE = "Title can't contain line breaks or control characters";
export const CAPTION_MESSAGE = 'Caption must be at most 2000 characters';
export const LIFT_MESSAGE = 'Enter the lift as a co-op date and time';
export const EXCLUSIVE_DAYS_MESSAGE = 'Exclusive window must be 1 to 14 days';
export const STANDARD_DAYS_MESSAGE = 'Standard licence must be 1 to 30 days';
export const PRICE_MESSAGE = 'Price must be $1.00 to $100,000.00';
export const FRAME_CAPTION_MESSAGE = 'Caption must be at most 500 characters';
export const CREDITS_SHAPE_MESSAGE = 'Credits must list 1 to 6 contributors';
export const CREDITS_ENTRY_MESSAGE =
  'Each credit needs a contributor handle and an integer split_bp from 1 to 10000';
export const CREDITS_KEYS_MESSAGE = 'Credits accept only contributor and split_bp';
export const CREDITS_DUPLICATE_MESSAGE = 'Each contributor may be credited once';
export const CREDITS_SELF_MESSAGE = 'You must credit yourself';

export interface CreditInput {
  contributor: string;
  split_bp: number;
}

export interface EssayFieldsInput {
  title: string;
  caption: string;
  lift_local: string;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  credits: CreditInput[];
}

export function trimTitle(title: string): string {
  return title.replace(/^ +| +$/g, '');
}

function checkTitle(value: string): string | null {
  if (hasControlCharacters(value)) return TITLE_CONTROL_MESSAGE;
  const trimmed = trimTitle(value);
  const length = codePointLength(trimmed);
  if (length < 1 || length > 120) return TITLE_LENGTH_MESSAGE;
  return null;
}

export interface CreditsContext {
  knownHandles: Set<string>;
  signerHandle: string;
}

function checkCredits(value: unknown, context: CreditsContext): string | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return CREDITS_SHAPE_MESSAGE;
  for (const entry of value) {
    if (!isJsonObject(entry)) return CREDITS_ENTRY_MESSAGE;
    const handle = entry.contributor;
    const split = entry.split_bp;
    if (typeof handle !== 'string') return CREDITS_ENTRY_MESSAGE;
    if (!isInteger(split) || split < 1 || split > 10000) return CREDITS_ENTRY_MESSAGE;
  }
  for (const entry of value as Record<string, unknown>[]) {
    for (const key of Object.keys(entry)) {
      if (key !== 'contributor' && key !== 'split_bp') return CREDITS_KEYS_MESSAGE;
    }
  }
  const entries = value as CreditInput[];
  for (const entry of entries) {
    if (!context.knownHandles.has(entry.contributor)) return `Unknown contributor ${entry.contributor}`;
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.contributor)) return CREDITS_DUPLICATE_MESSAGE;
    seen.add(entry.contributor);
  }
  if (!seen.has(context.signerHandle)) return CREDITS_SELF_MESSAGE;
  const sum = entries.reduce((total, entry) => total + entry.split_bp, 0);
  if (sum !== 10000) return `Shares must total 10000 basis points (now ${sum})`;
  return null;
}

function priceField(): FieldSpec {
  return integerField(PRICE_MESSAGE, (value) =>
    value >= 100 && value <= 10_000_000 ? null : PRICE_MESSAGE,
  );
}

export function essayBodySpec(context: CreditsContext, partial: boolean): BodySpec {
  const optional = partial;
  const spec: BodySpec = {
    title: { ...stringField(TITLE_LENGTH_MESSAGE, checkTitle), optional },
    caption: {
      ...stringField(CAPTION_MESSAGE, (value) =>
        codePointLength(value) <= 2000 ? null : CAPTION_MESSAGE,
      ),
      optional,
    },
    lift_local: {
      ...stringField(LIFT_MESSAGE, (value) => (isValidLocalDateTime(value) ? null : LIFT_MESSAGE)),
      optional,
    },
    exclusive_days: {
      ...integerField(EXCLUSIVE_DAYS_MESSAGE, (value) =>
        value >= 1 && value <= 14 ? null : EXCLUSIVE_DAYS_MESSAGE,
      ),
      optional,
    },
    standard_days: {
      ...integerField(STANDARD_DAYS_MESSAGE, (value) =>
        value >= 1 && value <= 30 ? null : STANDARD_DAYS_MESSAGE,
      ),
      optional,
    },
    exclusive_price_minor: { ...priceField(), optional },
    standard_price_minor: { ...priceField(), optional },
    credits: {
      message: CREDITS_SHAPE_MESSAGE,
      optional,
      check: (value) => checkCredits(value, context),
    },
  };
  return spec;
}

export function frameCaptionSpec(): BodySpec {
  return {
    caption: stringField(FRAME_CAPTION_MESSAGE, (value) =>
      codePointLength(value) <= 500 ? null : FRAME_CAPTION_MESSAGE,
    ),
  };
}

/** `Photographs by Ada Reyes, Tomas Whitcombe and Noor Haddad` */
export function creditLine(names: string[]): string {
  if (names.length === 0) return 'Photographs by';
  if (names.length === 1) return `Photographs by ${names[0]}`;
  const head = names.slice(0, -1).join(', ');
  return `Photographs by ${head} and ${names[names.length - 1]}`;
}
