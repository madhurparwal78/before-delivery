// Field rules and their exact messages (brief: Field error messages, Party rules).
import type { Accept, BerthPreference, ClassCode, Gender, Quota } from "../../shared/api.js";
import { meetsSeniorCriteria } from "./allot.js";
import { isIsoDate } from "./clock.js";
import { isChild } from "./fare.js";

export type FieldErrors = Record<string, string>;

const CLASSES: ClassCode[] = ["SL", "3A"];
const QUOTAS: Quota[] = ["GN", "TQ", "LD", "SS"];
const ACCEPTS: Accept[] = ["CNF", "RAC", "WL"];
const GENDERS: Gender[] = ["M", "F", "T"];
const PREFERENCES: BerthPreference[] = ["LB", "MB", "UB", "SL", "SU", "NONE"];

export const isClass = (v: unknown): v is ClassCode => CLASSES.includes(v as ClassCode);
export const isQuota = (v: unknown): v is Quota => QUOTAS.includes(v as Quota);
export const isAccept = (v: unknown): v is Accept => ACCEPTS.includes(v as Accept);
const isGender = (v: unknown): v is Gender => GENDERS.includes(v as Gender);
const isPreference = (v: unknown): v is BerthPreference => PREFERENCES.includes(v as BerthPreference);
export const isAge = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 125;

function setOnce(errors: FieldErrors, key: string, message: string): void {
  if (!(key in errors)) errors[key] = message;
}

function isName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 80;
}

export function isPhone(v: unknown): v is string {
  return typeof v === "string" && /^\+91[6-9]\d{9}$/.test(v);
}

function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function accountErrors(body: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};
  if (!isName(body.name)) errors.name = "Enter a name";
  if (!isEmail(body.email)) errors.email = "Enter a valid email";
  if (typeof body.password !== "string" || body.password.length < 10) errors.password = "Use at least 10 characters";
  if (!isPhone(body.phone)) errors.phone = "Enter +91 and a 10-digit mobile number";
  return errors;
}

export function journeyErrors(body: Record<string, unknown>, dateKey: "date" | "run_date"): FieldErrors {
  const errors: FieldErrors = {};
  if (!isClass(body.class)) errors.class = "Choose SL or 3A";
  if (!isQuota(body.quota)) errors.quota = "Choose GN, TQ, LD or SS";
  if (!isIsoDate(body[dateKey])) errors[dateKey] = "Enter a date as YYYY-MM-DD";
  if (body.from === body.to) errors.to = "Choose a different station from From";
  return errors;
}

/** Party sizes, ages and quota eligibility on one PNR, in the order of the brief's table. */
export function partyErrors(passengers: unknown, quota: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(passengers)) {
    errors.passengers = "Add at least one passenger aged 5 or over";
    return errors;
  }
  passengers.forEach((raw: unknown, i) => {
    const p = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (!isName(p.name)) setOnce(errors, `passengers[${i}].name`, "Enter a name");
    if (!isAge(p.age)) setOnce(errors, `passengers[${i}].age`, "Enter an age from 0 to 125");
    if (!isGender(p.gender)) setOnce(errors, `passengers[${i}].gender`, "Choose a gender");
    if (!isPreference(p.berth_preference)) setOnce(errors, `passengers[${i}].berth_preference`, "Choose a berth preference");
  });
  const people = passengers.map((raw: unknown) => (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>);
  const adults = people.filter((p) => isAge(p.age) && !isChild(p.age));
  const children = people.filter((p) => isAge(p.age) && isChild(p.age));
  if (adults.length === 0) errors.passengers = "Add at least one passenger aged 5 or over";
  else if (adults.length > 6) errors.passengers = "Up to 6 passengers aged 5 or over";
  else if (children.length > 2) errors.passengers = "Up to 2 children under five";
  else if (quota === "TQ" && adults.length > 4) errors.passengers = "Up to 4 passengers aged 5 or over on a Tatkal ticket";
  else if (quota === "SS" && adults.length > 2) errors.passengers = "Up to 2 passengers on a Senior quota ticket";
  people.forEach((p, i) => {
    if (!isAge(p.age) || isChild(p.age)) return;
    if (quota === "LD" && p.gender !== "F") setOnce(errors, `passengers[${i}].gender`, "Ladies quota is for women travellers");
    if (quota === "SS" && !(isGender(p.gender) && meetsSeniorCriteria(p.age, p.gender))) {
      setOnce(errors, `passengers[${i}].age`, "Senior quota is for passengers aged 60 or over, or women aged 45 or over");
    }
  });
  return errors;
}

/** Passenger numbers for a cancellation or its quote. */
export function selectionErrors(selection: unknown, numbers: number[]): FieldErrors {
  if (!Array.isArray(selection) || selection.length === 0) return { passengers: "Choose at least one passenger" };
  const unknown = selection.find((n: unknown) => !numbers.includes(n as number));
  return unknown === undefined ? {} : { passengers: `Passenger ${String(unknown)} is not on this PNR` };
}
