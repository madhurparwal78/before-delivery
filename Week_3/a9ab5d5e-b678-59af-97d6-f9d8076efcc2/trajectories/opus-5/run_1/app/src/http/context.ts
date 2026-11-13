import { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { ApiError, fail, failField } from '../errors';
import { Household, StoredVersion, householdToday, householdZone, loadVersions } from '../db/repo';
import { Json, ParsedBody, isPlainIntegerLiteral } from '../lib/json';
import { ParentRole } from '../domain/plan';
import { PlainDate, isValidDate, parseInstant } from '../domain/time';
import { graphemeLength, hasHiddenCharacters, normaliseText } from '../lib/text';

export interface Session {
  token: string;
  parentId: string;
  householdId: string;
  role: ParentRole;
  name: string;
}

export interface ApiResponse {
  status: number;
  json?: Json;
  body?: Buffer;
  headers?: Record<string, string>;
}

export interface CtxInit {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
  params: Record<string, string>;
  raw: Buffer;
  parsed: ParsedBody | null;
  session: Session | null;
  request: IncomingMessage;
}

export class Ctx {
  readonly method: string;
  readonly url: URL;
  readonly headers: IncomingHttpHeaders;
  readonly params: Record<string, string>;
  readonly raw: Buffer;
  readonly session: Session | null;
  readonly request: IncomingMessage;
  readonly now = Date.now();
  private readonly literals: Map<string, string>;
  private readonly bodyValue: Json;
  private household: Household | null = null;
  private versions: StoredVersion[] | null = null;

  constructor(init: CtxInit) {
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers;
    this.params = init.params;
    this.raw = init.raw;
    this.session = init.session;
    this.request = init.request;
    this.bodyValue = init.parsed ? init.parsed.value : {};
    this.literals = init.parsed ? init.parsed.numberLiterals : new Map();
  }

  get user(): Session {
    if (!this.session) fail('unauthenticated');
    return this.session;
  }

  setHousehold(household: Household): void {
    this.household = household;
  }

  get home(): Household {
    if (!this.household) throw new Error('household not loaded');
    return this.household;
  }

  async planVersions(): Promise<StoredVersion[]> {
    if (!this.versions) this.versions = await loadVersions(this.home.id);
    return this.versions;
  }

  async today(): Promise<PlainDate> {
    return householdToday(await this.planVersions(), this.now);
  }

  async zone(): Promise<string> {
    return householdZone(await this.planVersions(), this.now);
  }

  header(name: string): string | undefined {
    const value = this.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /** Shape rung: a body must be an object and may only hold the route's own fields. */
  allow(...fields: string[]): void {
    if (this.bodyValue === null || typeof this.bodyValue !== 'object' || Array.isArray(this.bodyValue)) {
      failField('body', 'This value is out of range.');
    }
    const errors = Object.create(null) as Record<string, string>;
    for (const key of Object.keys(this.bodyValue as Record<string, Json>)) {
      if (!fields.includes(key)) errors[key] = 'This field is not accepted.';
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  }

  get body(): Record<string, Json> {
    return this.bodyValue as Record<string, Json>;
  }

  present(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  }

  value(field: string): Json | undefined {
    return this.present(field) ? (this.body[field] as Json) : undefined;
  }

  literal(path: string): string | undefined {
    return this.literals.get(path);
  }

  text(field: string, message: string, limits: { min: number; max: number; multiline?: boolean }): string {
    const value = this.value(field);
    if (typeof value !== 'string') failField(field, message);
    return cleanText(field, value, message, limits);
  }

  optionalText(
    field: string,
    message: string,
    limits: { min: number; max: number; multiline?: boolean },
  ): string | null {
    const value = this.value(field);
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') failField(field, message);
    return cleanText(field, value, message, limits);
  }

  integer(field: string, message: string, limits: { min: number; max: number }, path = field): number {
    const value = this.value(field);
    if (typeof value !== 'number' || !isPlainIntegerLiteral(this.literal(path))) failField(path, message);
    if (value < limits.min || value > limits.max) failField(path, message);
    return value;
  }

  choice<T extends string>(field: string, values: readonly T[], message: string): T {
    const value = this.value(field);
    if (typeof value !== 'string' || !values.includes(value as T)) failField(field, message);
    return value as T;
  }

  date(field: string): PlainDate {
    const value = this.value(field);
    if (typeof value !== 'string' || !isValidDate(value)) failField(field, 'Enter a real date as YYYY-MM-DD.');
    return value;
  }

  instant(field: string): number {
    const value = this.value(field);
    if (typeof value !== 'string') {
      failField(field, 'Enter an RFC 3339 instant with an offset and no fractional seconds.');
    }
    const parsed = parseInstant(value);
    if (parsed === null) failField(field, 'Enter an RFC 3339 instant with an offset and no fractional seconds.');
    return parsed;
  }
}

export function cleanText(
  path: string,
  value: string,
  message: string,
  limits: { min: number; max: number; multiline?: boolean },
): string {
  if (hasHiddenCharacters(value, { allowNewlines: limits.multiline === true })) {
    failField(path, 'Remove hidden or control characters.');
  }
  const normalised = normaliseText(value);
  const length = graphemeLength(normalised);
  if (length < limits.min || length > limits.max) failField(path, message);
  return normalised;
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number.parseInt(declared, 10) > limit) fail('payload_too_large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      request.destroy();
      fail('payload_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
