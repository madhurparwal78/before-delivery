import type pg from 'pg';
import type { Caller } from '../auth.ts';
import { allows, type Capability } from '../domain/roles.ts';
import { forbidden, invalidState, notFound } from '../http/errors.ts';
import { codePoints } from '../http/read.ts';
import type { Ctx } from '../http/server.ts';
import { VALIDATION } from '../../shared/copy.ts';
import { loadAggregate, type Aggregate, type RecipientRow } from '../model/document.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads the route's document, scoped to the caller's team. */
export const loadForCaller = async (
  ctx: Ctx,
  caller: Caller,
  client?: pg.PoolClient,
): Promise<Aggregate> => {
  const id = ctx.params['id'] ?? '';
  if (!UUID_PATTERN.test(id)) throw notFound();
  const aggregate = await loadAggregate(id, caller.teamId, client);
  if (!aggregate) throw notFound();
  return aggregate;
};

export const requireCapability = (
  caller: Caller,
  aggregate: Aggregate,
  capability: Capability,
): void => {
  if (!allows({ userId: caller.userId, role: caller.role }, capability, aggregate.doc.owner_id)) {
    throw forbidden();
  }
};

/** Fields, recipients, title and time zone change only while the document is a draft. */
export const requireDraft = (aggregate: Aggregate): void => {
  if (aggregate.doc.status !== 'draft') throw invalidState(aggregate.doc.status);
};

export const requireRecipient = (aggregate: Aggregate, recipientId: string): RecipientRow => {
  const recipient = aggregate.recipients.find((row) => row.id === recipientId);
  if (!recipient) throw notFound();
  return recipient;
};

export const titleError = (title: string): string | null =>
  codePoints(title) >= 1 && codePoints(title) <= 120 ? null : VALIDATION.title;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
