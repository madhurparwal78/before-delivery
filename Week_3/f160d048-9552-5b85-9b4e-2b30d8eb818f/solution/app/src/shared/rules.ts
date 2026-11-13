import { FIELD_COPY } from "./errors";
import {
  CITIES,
  COMPANY_SIZES,
  OUTCOMES,
  PAY_BANDS,
  REJECTION_REASONS,
  ROLE_FAMILIES,
  WORK_PATTERNS,
} from "./reference";

export type FieldErrors = Record<string, string>;

interface Field<T> {
  readonly message: string;
  readonly parse: (raw: unknown) => T | undefined;
}

type Shape = Record<string, Field<unknown>>;
type Parsed<S extends Shape> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never };
type ParseResult<S extends Shape> =
  | { ok: true; value: Parsed<S> }
  | { ok: false; fields: FieldErrors };

function field<T>(message: string, parse: (raw: unknown) => T | undefined): Field<T> {
  return { message, parse };
}

function trimmed(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw.trim() : undefined;
}

const length = (value: string): number => Array.from(value).length;

function text(min: number, max: number, message: string): Field<string> {
  return field(message, (raw) => {
    const value = trimmed(raw);
    return value !== undefined && length(value) >= min && length(value) <= max ? value : undefined;
  });
}

function optionalText(max: number, message: string): Field<string> {
  return field(message, (raw) => {
    if (raw === undefined || raw === null) return "";
    const value = trimmed(raw);
    return value !== undefined && length(value) <= max ? value : undefined;
  });
}

function integer(min: number, max: number, message: string): Field<number> {
  return field(message, (raw) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max ? raw : undefined,
  );
}

function choice<const L extends readonly string[]>(list: L, message: string): Field<L[number]> {
  return field(message, (raw) => list.find((entry) => entry === raw));
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailAddress(): Field<string> {
  return field(FIELD_COPY.email, (raw) => {
    const value = trimmed(raw);
    return value !== undefined && EMAIL_PATTERN.test(value) ? value : undefined;
  });
}

const PHONE_PATTERN = /^\+?[0-9 -]+$/;

function phoneNumber(): Field<string> {
  return field(FIELD_COPY.phone, (raw) => {
    if (raw === undefined || raw === null) return "";
    const value = trimmed(raw);
    if (value === undefined) return undefined;
    if (value === "") return "";
    return value.length >= 7 && value.length <= 20 && PHONE_PATTERN.test(value) ? value : undefined;
  });
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? { ...input } : {};
}

export function parseShape<S extends Shape>(
  shape: S,
  input: unknown,
  only?: readonly (keyof S & string)[],
): ParseResult<S> {
  const source = asRecord(input);
  const fields: FieldErrors = {};
  const value: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(shape)) {
    if (only && !only.includes(name)) continue;
    const parsed = rule.parse(source[name]);
    if (parsed === undefined) fields[name] = rule.message;
    else value[name] = parsed;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: value as Parsed<S> };
}

const cityIds = CITIES.map((entry) => entry.id);
const roleIds = ROLE_FAMILIES.map((entry) => entry.id);
const patternIds = WORK_PATTERNS.map((entry) => entry.id);
const bandIds = PAY_BANDS.map((entry) => entry.id);
const outcomeIds = OUTCOMES.map((entry) => entry.id);

const rating = () => integer(1, 5, FIELD_COPY.rating);
const companyId = () => text(1, 200, FIELD_COPY.company_id);
const longText = () => text(20, 3000, FIELD_COPY.long_text);
const annualPay = () => integer(100000, 5000000, FIELD_COPY.pay);

export const reviewShape = {
  company_id: companyId(),
  overall: rating(),
  work_life: rating(),
  pay: rating(),
  management: rating(),
  title: text(5, 120, FIELD_COPY.review_title),
  pros: longText(),
  cons: longText(),
};

export const payReportShape = {
  company_id: companyId(),
  role_family: choice(roleIds, FIELD_COPY.role_family),
  city: choice(cityIds, FIELD_COPY.city),
  annual_pay: annualPay(),
  years_experience: integer(0, 40, FIELD_COPY.years_experience),
};

export const interviewNoteShape = {
  company_id: companyId(),
  role_family: choice(roleIds, FIELD_COPY.role_family),
  difficulty: rating(),
  outcome: choice(outcomeIds, FIELD_COPY.outcome),
  text: longText(),
};

export const REVIEW_STEPS: readonly (readonly (keyof typeof reviewShape)[])[] = [
  ["company_id"],
  ["overall", "work_life", "pay", "management"],
  ["title", "pros", "cons"],
];

export const CONTACT_FIELDS = {
  review: ["title", "pros", "cons"],
  pay_report: [],
  interview_note: ["text"],
} as const;

export function withoutCompany<S extends { company_id: Field<string> }>(shape: S): Omit<S, "company_id"> {
  const { company_id: _company, ...rest } = shape;
  return rest;
}

export const replyShape = { body: text(20, 2000, FIELD_COPY.reply_body) };
export const channelPostShape = { body: text(1, 2000, FIELD_COPY.channel_body) };

export const jobShape = {
  title: text(3, 120, FIELD_COPY.job_title),
  role_family: choice(roleIds, FIELD_COPY.role_family),
  city: choice(cityIds, FIELD_COPY.city),
  remote: choice(patternIds, FIELD_COPY.remote),
  pay_low: annualPay(),
  pay_high: annualPay(),
  description: text(40, 5000, FIELD_COPY.description),
};

export function parseJob(input: unknown): ParseResult<typeof jobShape> {
  const parsed = parseShape(jobShape, input);
  const raw = asRecord(input);
  const low = jobShape.pay_low.parse(raw["pay_low"]);
  const high = jobShape.pay_high.parse(raw["pay_high"]);
  const inverted = low !== undefined && high !== undefined && high < low;
  if (parsed.ok && !inverted) return parsed;
  return {
    ok: false,
    fields: { ...(parsed.ok ? {} : parsed.fields), ...(inverted ? { pay_high: FIELD_COPY.pay_high } : {}) },
  };
}

export const applyShape = {
  candidate_name: text(2, 100, FIELD_COPY.candidate_name),
  contact_email: emailAddress(),
  phone: phoneNumber(),
  cover_note: optionalText(2000, FIELD_COPY.cover_note),
};

export const signInShape = { email: emailAddress(), password: text(1, 200, FIELD_COPY.password) };
export const joinShape = {
  display_name: text(2, 40, FIELD_COPY.display_name),
  email: emailAddress(),
  password: text(10, 200, FIELD_COPY.password),
};
export const forgotShape = { email: emailAddress() };
export const resetShape = { token: text(1, 200, FIELD_COPY.password), password: text(10, 200, FIELD_COPY.password) };
export const confirmShape = { token: text(1, 200, FIELD_COPY.password) };

export function verificationEmailShape(domain: string) {
  return {
    email: field(FIELD_COPY.verification_email.replace("{domain}", domain), (raw) => {
      const value = trimmed(raw);
      if (value === undefined || !EMAIL_PATTERN.test(value)) return undefined;
      return value.toLowerCase().endsWith(`@${domain.toLowerCase()}`) ? value : undefined;
    }),
  };
}

const decisionShape = {
  decision: choice(["approve", "reject"] as const, FIELD_COPY.decision),
};

export function parseDecision(input: unknown):
  | { ok: true; value: { decision: "approve" } | { decision: "reject"; reason: string; details: string | null } }
  | { ok: false; fields: FieldErrors } {
  const base = parseShape(decisionShape, input);
  if (!base.ok) return base;
  if (base.value.decision === "approve") return { ok: true, value: { decision: "approve" } };
  const source = asRecord(input);
  const reason = choice(REJECTION_REASONS, FIELD_COPY.reason).parse(source["reason"]);
  if (reason === undefined) return { ok: false, fields: { reason: FIELD_COPY.reason } };
  if (reason !== "Other") return { ok: true, value: { decision: "reject", reason, details: null } };
  const details = text(5, 200, FIELD_COPY.details).parse(source["details"]);
  if (details === undefined) return { ok: false, fields: { details: FIELD_COPY.details } };
  return { ok: true, value: { decision: "reject", reason, details } };
}

export const alertShape = {
  q: optionalText(200, FIELD_COPY.search_text),
  city: listOf(cityIds, FIELD_COPY.city),
  role: listOf(roleIds, FIELD_COPY.role_family),
  remote: listOf(patternIds, FIELD_COPY.remote),
  band: listOf(bandIds, FIELD_COPY.pay_band),
};

function listOf<const L extends readonly string[]>(ids: L, message: string): Field<L[number][]> {
  return field(message, (raw) => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return undefined;
    const picked: L[number][] = [];
    for (const entry of raw) {
      const id = ids.find((candidate) => candidate === entry);
      if (id === undefined) return undefined;
      if (!picked.includes(id)) picked.push(id);
    }
    return picked;
  });
}

export const founderCompanyShape = {
  name: text(2, 100, FIELD_COPY.name),
  slug: field(FIELD_COPY.slug, (raw) => {
    const value = trimmed(raw);
    return value !== undefined && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80 ? value : undefined;
  }),
  city: choice(cityIds, FIELD_COPY.city),
  size: choice(COMPANY_SIZES, FIELD_COPY.size),
  email_domain: field(FIELD_COPY.email, (raw) => {
    const value = trimmed(raw);
    return value !== undefined && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value) ? value.toLowerCase() : undefined;
  }),
};

export const founderEmployerShape = {
  display_name: text(2, 40, FIELD_COPY.display_name),
  email: emailAddress(),
  role: choice(["employer_admin", "recruiter"] as const, FIELD_COPY.staff_role),
};
