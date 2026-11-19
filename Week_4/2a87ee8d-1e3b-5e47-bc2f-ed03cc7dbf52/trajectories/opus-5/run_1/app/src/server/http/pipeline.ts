import { AppError } from '../errors.js';
import { pool } from '../db/pool.js';
import {
  actorKey,
  lookupCaller,
  resolveActor,
  type Actor,
  type CallerLookup,
} from '../auth/sessions.js';
import { assertWorkspaceWritable } from '../billing/mirror.js';
import { findWorkshop, type WorkshopRow } from '../board/repository.js';
import type { RateLimitClass } from '../domain/ratelimits.js';
import { consumeRateLimit } from './ratelimit.js';
import { claimOperation, recordOperationResult, releaseOperation } from './operations.js';
import { readClientOpId } from '../domain/writeKeys.js';
import { readJsonBody, type RequestContext } from './context.js';
import { sendEmpty, sendJson } from './respond.js';

export interface HandlerResult {
  readonly status: number;
  /** `null` sends an empty response; `undefined` means the handler already wrote it. */
  readonly body: unknown;
}

export function json(status: number, body: unknown): HandlerResult {
  return { status, body };
}

export const noContent: HandlerResult = { status: 204, body: null };

/** For handlers that stream or send bytes themselves, such as the board stream. */
export const alreadySent: HandlerResult = { status: 200, body: undefined };

export interface RouteContext {
  readonly context: RequestContext;
  readonly actor: Actor;
  readonly lookup: CallerLookup;
  readonly body: Record<string, unknown>;
  readonly workshop: WorkshopRow | null;
  readonly nowMs: number;
}

/** How a route finds the workshop its path addresses, for the 404 and workspace checks. */
export type WorkshopLocator =
  | { readonly kind: 'none' }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'lookup'; readonly find: (context: RequestContext) => Promise<string | null> };

export interface RouteDefinition {
  readonly method: string;
  readonly path: string;
  /** `session` rejects a request carrying no valid session with 401. */
  readonly auth: 'none' | 'session';
  readonly body?: 'json' | 'none';
  readonly workshop?: WorkshopLocator;
  readonly rateLimit?: { readonly limitClass: RateLimitClass; readonly key: 'ip' | 'actor' | 'session' };
  /** A participant calling a facilitator-only endpoint answers 403. */
  readonly facilitatorOnly?: boolean;
  /**
   * Role checks that belong at step 5 of the error order, so a 403 precedes operation
   * replay and the payment check.
   */
  readonly preflight?: (route: RouteContext) => Promise<void>;
  /** Endpoints marked ✱ require `clientOpId` and replay their stored response. */
  readonly operation?: boolean;
  /** Writes in a read-only workspace answer 402. */
  readonly requiresWritableWorkspace?: boolean;
  readonly handle: (route: RouteContext) => Promise<HandlerResult>;
}

function rateLimitKeyFor(definition: RouteDefinition, context: RequestContext, actor: Actor | null): string {
  switch (definition.rateLimit?.key) {
    case 'actor':
      return actor === null ? context.ip : actorKey(actor);
    case 'session':
      return actor === null || actor.kind === 'facilitator'
        ? `facilitator:${context.ip}`
        : `participant:${actor.participantId}`;
    default:
      return context.ip;
  }
}

async function locateWorkshopId(
  locator: WorkshopLocator,
  context: RequestContext,
): Promise<string | null> {
  switch (locator.kind) {
    case 'none':
      return null;
    case 'param':
      return context.params[locator.name] ?? null;
    case 'lookup':
      return locator.find(context);
  }
}

/**
 * Runs one route through the API's error order:
 * boundary, 401, 429, 404, 403, operation replay, 402, then the handler's own
 * 409 / 422 / entitlement / 503 checks.
 */
export async function runRoute(definition: RouteDefinition, context: RequestContext): Promise<void> {
  const body = definition.body === 'json' ? await readJsonBody(context) : {};

  // 401: the request carries no valid session at all.
  const lookup = await lookupCaller(context);
  const locator = definition.workshop ?? { kind: 'none' as const };
  const pathWorkshopId = await locateWorkshopId(locator, context);
  const actor = definition.auth === 'session' ? resolveActor(lookup, pathWorkshopId) : null;

  // 429 for the request's limit class.
  let rateHeaders: Readonly<Record<string, string>> = {};  // carried on every response in the class
  if (definition.rateLimit) {
    const outcome = await consumeRateLimit(
      definition.rateLimit.limitClass,
      rateLimitKeyFor(definition, context, actor),
      context.nowMs,
    );
    rateHeaders = outcome.headers;
  }

  // 404: an unknown resource, or one outside the caller's workspace or workshop.
  let workshop: WorkshopRow | null = null;
  if (pathWorkshopId !== null && definition.auth === 'session') {
    workshop = await findWorkshop(pool, pathWorkshopId);
    if (workshop === null) throw new AppError('not_found');
    if (actor !== null) {
      const ownsWorkspace =
        actor.kind === 'facilitator'
          ? workshop.facilitatorId === actor.facilitatorId
          : workshop.id === actor.workshopId;
      if (!ownsWorkspace) throw new AppError('not_found');
    }
  }

  // 403: the caller's role may not do this.
  if (definition.facilitatorOnly && actor !== null && actor.kind !== 'facilitator') {
    throw new AppError('forbidden');
  }

  const routeContext: RouteContext = {
    context,
    actor: actor as Actor,
    lookup,
    body,
    workshop,
    nowMs: context.nowMs,
  };
  if (definition.preflight) await definition.preflight(routeContext);

  if (!definition.operation) {
    await guardPayment(definition, routeContext);
    const result = await definition.handle(routeContext);
    send(context, result, rateHeaders);
    return;
  }

  // Operation replay, before any later check in the error order.
  const clientOpId = readClientOpId(body);
  const owner = actorKey(routeContext.actor);
  const claim = await claimOperation(owner, clientOpId, context.method, context.path, body);
  if (claim.kind === 'replay') {
    send(context, { status: claim.result.status, body: claim.result.body }, rateHeaders);
    return;
  }

  let result: HandlerResult;
  try {
    await guardPayment(definition, routeContext);
    result = await definition.handle(routeContext);
  } catch (error) {
    // Every 2xx and 4xx is stored; a 5xx is not, so a later retry runs again.
    if (error instanceof AppError && error.status >= 400 && error.status < 500) {
      await recordOperationResult(owner, clientOpId, { status: error.status, body: error.body() });
    } else {
      await releaseOperation(owner, clientOpId);
    }
    throw error;
  }
  await recordOperationResult(owner, clientOpId, { status: result.status, body: result.body });
  send(context, result, rateHeaders);
}

async function guardPayment(definition: RouteDefinition, route: RouteContext): Promise<void> {
  if (definition.requiresWritableWorkspace !== true) return;
  await assertWorkspaceWritable(route.actor.facilitatorId, route.nowMs);
}

function send(
  context: RequestContext,
  result: HandlerResult,
  extraHeaders: Readonly<Record<string, string>>,
): void {
  if (result.body === undefined) return;
  if (result.body === null) {
    sendEmpty(context, result.status, extraHeaders);
    return;
  }
  sendJson(context, result.status, result.body, extraHeaders);
}
