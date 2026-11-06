import type { Gender, PartyMember } from '../domain/allotment';
import { meetsSeniorCriteria } from '../domain/allotment';
import type { BerthPreference, Quota } from '../domain/berths';
import { isBerthPreference } from '../domain/berths';
import { isChild } from '../domain/fare';
import type { FieldErrors } from '../http/errors';
import { FIELD_MESSAGES } from '../http/errors';

export const MAX_ADULTS = 6;
export const MAX_CHILDREN = 2;
export const MAX_TATKAL_ADULTS = 4;
export const MAX_SENIOR_ADULTS = 2;
export const MAX_AGE = 125;

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isPhone(value: unknown): value is string {
  return typeof value === 'string' && /^\+91[6-9]\d{9}$/.test(value);
}

export function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

export function isGender(value: unknown): value is Gender {
  return value === 'M' || value === 'F' || value === 'T';
}

export interface PassengerInput {
  readonly name: string;
  readonly age: number;
  readonly gender: Gender;
  readonly berth_preference: BerthPreference;
}

function readPassenger(raw: unknown): Partial<PassengerInput> {
  if (typeof raw !== 'object' || raw === null) return {};
  const record = raw as Record<string, unknown>;
  return {
    name: isName(record.name) ? record.name.trim() : undefined,
    age: typeof record.age === 'number' && Number.isInteger(record.age)
      && record.age >= 0 && record.age <= MAX_AGE
      ? record.age
      : undefined,
    gender: isGender(record.gender) ? record.gender : undefined,
    berth_preference: isBerthPreference(record.berth_preference)
      ? record.berth_preference
      : undefined,
  };
}

export interface PartyValidation {
  readonly errors: FieldErrors;
  readonly passengers: readonly PassengerInput[];
}

/** Party sizes, ages and quota eligibility on one PNR. */
export function validateParty(raw: unknown, quota: Quota): PartyValidation {
  const errors: FieldErrors = {};
  if (!Array.isArray(raw)) {
    return { errors: { passengers: FIELD_MESSAGES.atLeastOneAdult }, passengers: [] };
  }
  const drafts = raw.map(readPassenger);
  drafts.forEach((draft, index) => {
    if (draft.name === undefined) errors[`passengers[${index}].name`] = FIELD_MESSAGES.name;
    if (draft.age === undefined) errors[`passengers[${index}].age`] = FIELD_MESSAGES.age;
    if (draft.gender === undefined) errors[`passengers[${index}].gender`] = FIELD_MESSAGES.gender;
    if (draft.berth_preference === undefined) {
      errors[`passengers[${index}].berth_preference`] = FIELD_MESSAGES.berthPreference;
    }
  });

  const complete = drafts.every(
    (draft): draft is PassengerInput => draft.name !== undefined && draft.age !== undefined
      && draft.gender !== undefined && draft.berth_preference !== undefined,
  );
  const ages = drafts.map((draft) => draft.age ?? 0);
  const adults = ages.filter((age) => !isChild(age)).length;
  const children = drafts.length - adults;

  if (adults < 1) errors.passengers = FIELD_MESSAGES.atLeastOneAdult;
  else if (adults > MAX_ADULTS) errors.passengers = FIELD_MESSAGES.tooManyAdults;
  else if (children > MAX_CHILDREN) errors.passengers = FIELD_MESSAGES.tooManyChildren;
  else if (quota === 'TQ' && adults > MAX_TATKAL_ADULTS) {
    errors.passengers = FIELD_MESSAGES.tooManyTatkal;
  } else if (quota === 'SS' && adults > MAX_SENIOR_ADULTS) {
    errors.passengers = FIELD_MESSAGES.tooManySenior;
  }

  drafts.forEach((draft, index) => {
    if (draft.age === undefined || draft.gender === undefined) return;
    if (quota === 'LD' && !isChild(draft.age) && draft.gender !== 'F') {
      errors[`passengers[${index}].gender`] = FIELD_MESSAGES.ladiesGender;
    }
    if (quota === 'SS') {
      const member: PartyMember = {
        age: draft.age,
        gender: draft.gender,
        preference: draft.berth_preference ?? 'NONE',
      };
      if (!meetsSeniorCriteria(member)) {
        errors[`passengers[${index}].age`] = FIELD_MESSAGES.seniorAge;
      }
    }
  });

  return {
    errors,
    passengers: complete ? (drafts as readonly PassengerInput[]) : [],
  };
}
