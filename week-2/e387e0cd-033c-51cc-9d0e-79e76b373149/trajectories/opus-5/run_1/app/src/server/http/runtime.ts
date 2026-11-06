import { createHash } from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';
import { ApiError, failure, methodNotAllowed } from './errors';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Role =
  | 'compliance_officer'
  | 'compliance_analyst'
  | 'operations_lead'
  | 'finance_lead'
  | 'support_agent';

export const ROLES: readonly Role[] = [
  'compliance_officer',
  'compliance_analyst',
  'operations_lead',
  'finance_lead',
  'support_agent',
];

export const ALL_STAFF: readonly Role[] = ROLES;

export interface MemberRecord {
  readonly id: string;
  readonly workspaceSlug: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export interface WorkspaceRecord {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly timeZone: string;
  readonly city: string;
  readonly currency: string;
  readonly confirmationLimitCents: bigint;
  readonly casePrefix: string;
  readonly sendingAddress: string;
}

export interface PartnerKeyRecord {
  readonly id: string;
  readonly workspaceSlug: string;
  readonly label: string;
  readonly startsWith: string;
}

export interface SenderRecord {
  readonly counterpartyId: string;
  readonly legalName: string;
  readonly lei: string;
}

export interface Reply {
  readonly status: number;
  readonly json?: unknown;
  readonly bytes?: Buffer;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly setCookie?: string;
}

export type ContentKind = 'none' | 'json' | 'csv' | 'multipart';

/** What every stage of the pipeline can see before the body is read. */
export interface LoadContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  readonly now: Date;
}

export interface BodyContext extends LoadContext {
  readonly raw: Buffer;
  readonly body: unknown;
}

export interface StaffExtras {
  readonly member: MemberRecord;
  readonly workspace: WorkspaceRecord;
  readonly sessionId: string;
}

export interface PartnerExtras {
  readonly partnerKey: PartnerKeyRecord;
  readonly workspace: WorkspaceRecord;
}

export interface SenderExtras {
  readonly sender: SenderRecord;
  readonly workspace: WorkspaceRecord;
}

interface CommonSpec {
  readonly method: Method;
  readonly path: string;
  readonly bodyLimit?: number;
  readonly content?: ContentKind;
}

export interface PublicSpec<L> extends CommonSpec {
  readonly kind: 'public';
  readonly load?: (context: LoadContext) => Promise<L>;
  readonly handler: (context: BodyContext & { loaded: L }) => Promise<Reply>;
}

export interface StaffSpec<L> extends CommonSpec {
  readonly kind: 'staff';
  readonly roles: readonly Role[];
  readonly rateLimit?: (context: LoadContext, memberId: string) => Promise<void>;
  readonly load?: (context: LoadContext & StaffExtras) => Promise<L>;
  readonly handler: (context: BodyContext & StaffExtras & { loaded: L }) => Promise<Reply>;
}

export interface PartnerSpec<L> extends CommonSpec {
  readonly kind: 'partner';
  readonly rateLimit?: (context: LoadContext, partnerKeyId: string) => Promise<void>;
  readonly load?: (context: LoadContext & PartnerExtras) => Promise<L>;
  readonly handler: (
    context: BodyContext & PartnerExtras & { loaded: L; requestKey: string | null },
  ) => Promise<Reply>;
}

export interface SenderSpec<L> extends CommonSpec {
  readonly kind: 'sender';
  readonly load?: (context: LoadContext & SenderExtras) => Promise<L>;
  readonly handler: (context: BodyContext & SenderExtras & { loaded: L }) => Promise<Reply>;
}

export type AnySpec<L> = PublicSpec<L> | StaffSpec<L> | PartnerSpec<L> | SenderSpec<L>;

export interface Registered {
  readonly method: Method;
  readonly path: string;
  readonly run: (context: RunContext) => Promise<Reply>;
}

export type SessionResolution =
  | { kind: 'none' }
  | { kind: 'ended'; code: 'session_ended' | 'access_removed' }
  | { kind: 'member'; member: MemberRecord; sessionId: string };

export interface RunContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  readonly now: Date;
  readonly readBody: (limit: number) => Promise<{ bytes: Buffer; tooLarge: boolean }>;
  readonly resolveSession: () => Promise<SessionResolution>;
  readonly resolvePartnerKey: () => Promise<PartnerKeyRecord | null>;
  readonly resolveSender: (slug: string, raw: Buffer) => Promise<SenderRecord | null>;
  readonly loadWorkspace: (slug: string) => Promise<WorkspaceRecord | null>;
  readonly replayPartnerRequest: (
    partnerKeyId: string,
    requestKey: string,
    bodySha256: string,
  ) => Promise<Reply | null>;
}

const DEFAULT_BODY_LIMIT = 64000;

function contentTypeOf(headers: IncomingHttpHeaders): string {
  const value = headers['content-type'];
  const text = Array.isArray(value) ? value[0] : value;
  return (text ?? '').split(';')[0].trim().toLowerCase();
}

const EXPECTED_TYPES: Readonly<Record<Exclude<ContentKind, 'none'>, string>> = {
  json: 'application/json',
  csv: 'text/csv',
  multipart: 'multipart/form-data',
};

async function bodyStage(
  context: RunContext,
  spec: CommonSpec,
  already: { bytes: Buffer; tooLarge: boolean } | null,
): Promise<{ raw: Buffer; body: unknown }> {
  const kind: ContentKind = spec.content ?? 'none';
  if (kind === 'none') return { raw: Buffer.alloc(0), body: null };
  const read = already ?? (await context.readBody(spec.bodyLimit ?? DEFAULT_BODY_LIMIT));
  if (read.tooLarge) throw failure('too_large');
  if (contentTypeOf(context.headers) !== EXPECTED_TYPES[kind]) throw failure('unsupported_media_type');
  if (kind !== 'json') return { raw: read.bytes, body: null };
  if (read.bytes.length === 0) return { raw: read.bytes, body: {} };
  try {
    return { raw: read.bytes, body: JSON.parse(read.bytes.toString('utf8')) as unknown };
  } catch {
    throw failure('bad_json');
  }
}

function loadContextOf(context: RunContext): LoadContext {
  return {
    method: context.method,
    url: context.url,
    params: context.params,
    headers: context.headers,
    now: context.now,
  };
}

export function define<L>(spec: AnySpec<L>): Registered {
  return { method: spec.method, path: spec.path, run: (context) => runSpec(spec, context) };
}

/** The one error-precedence ladder, walked in order for every request. */
async function runSpec<L>(spec: AnySpec<L>, context: RunContext): Promise<Reply> {
  const base = loadContextOf(context);
  if (spec.kind === 'public') {
    const loaded = spec.load === undefined ? (null as L) : await spec.load(base);
    const stage = await bodyStage(context, spec, null);
    return spec.handler({ ...base, ...stage, loaded });
  }
  if (spec.kind === 'staff') {
    const resolved = await context.resolveSession();
    if (spec.rateLimit !== undefined && resolved.kind === 'member') {
      await spec.rateLimit(base, resolved.member.id);
    }
    if (resolved.kind === 'none') throw failure('unauthenticated');
    if (resolved.kind === 'ended') throw failure(resolved.code);
    const slug = context.params.slug ?? resolved.member.workspaceSlug;
    const workspace = await context.loadWorkspace(slug);
    if (workspace === null || workspace.slug !== resolved.member.workspaceSlug) {
      throw failure('not_found');
    }
    const extras: StaffExtras = {
      member: resolved.member,
      workspace,
      sessionId: resolved.sessionId,
    };
    const loaded = spec.load === undefined ? (null as L) : await spec.load({ ...base, ...extras });
    if (!spec.roles.includes(resolved.member.role)) throw failure('forbidden');
    const stage = await bodyStage(context, spec, null);
    return spec.handler({ ...base, ...extras, ...stage, loaded });
  }
  if (spec.kind === 'partner') {
    const requestKey = headerValue(context.headers, 'request-key');
    const read = await context.readBody(spec.bodyLimit ?? DEFAULT_BODY_LIMIT);
    const key = await context.resolvePartnerKey();
    if (spec.rateLimit !== undefined && key !== null) await spec.rateLimit(base, key.id);
    if (key === null) throw failure('bad_partner_key');
    if (requestKey !== null && requestKey !== '' && !read.tooLarge) {
      const replay = await context.replayPartnerRequest(key.id, requestKey, sha256Of(read.bytes));
      if (replay !== null) return replay;
    }
    const workspace = await context.loadWorkspace(key.workspaceSlug);
    if (workspace === null) throw failure('not_found');
    const extras: PartnerExtras = { partnerKey: key, workspace };
    const loaded = spec.load === undefined ? (null as L) : await spec.load({ ...base, ...extras });
    const stage = await bodyStage(context, spec, read);
    return spec.handler({ ...base, ...extras, ...stage, loaded, requestKey });
  }
  const read = await context.readBody(spec.bodyLimit ?? DEFAULT_BODY_LIMIT);
  const slug = context.params.slug ?? '';
  const sender = read.tooLarge ? null : await context.resolveSender(slug, read.bytes);
  const workspace = await context.loadWorkspace(slug);
  if (!read.tooLarge && (sender === null || workspace === null)) throw failure('bad_signature');
  const stage = await bodyStage(context, spec, read);
  if (sender === null || workspace === null) throw failure('bad_signature');
  const extras: SenderExtras = { sender, workspace };
  const loaded = spec.load === undefined ? (null as L) : await spec.load({ ...base, ...extras });
  return spec.handler({ ...base, ...extras, ...stage, loaded });
}

export function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value[0] : value;
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class RouteTable {
  private readonly routes: Registered[] = [];

  add(...routes: readonly Registered[]): void {
    this.routes.push(...routes);
  }

  resolve(
    method: string,
    pathname: string,
  ): { route: Registered; params: Record<string, string> } | ApiError {
    const segments = pathname.split('/').filter((part) => part !== '');
    const pathMatches: Registered[] = [];
    for (const route of this.routes) {
      const pattern = route.path.split('/').filter((part) => part !== '');
      if (pattern.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let fits = true;
      for (let index = 0; index < pattern.length; index += 1) {
        const piece = pattern[index];
        if (piece.startsWith(':')) {
          params[piece.slice(1)] = decodeURIComponent(segments[index]);
          continue;
        }
        if (piece !== segments[index]) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;
      pathMatches.push(route);
      if (route.method === method) return { route, params };
    }
    if (pathMatches.length === 0) return failure('not_found');
    return methodNotAllowed([...new Set(pathMatches.map((route) => route.method))].sort());
  }
}
