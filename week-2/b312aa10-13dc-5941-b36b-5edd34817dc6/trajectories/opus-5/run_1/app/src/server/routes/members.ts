import { isMonth } from '../../shared/calendar.js';
import { db, transact } from '../db/pool.js';
import { localMonthOf } from '../domain/time.js';
import { businessNameIsValid, normalise } from '../domain/text.js';
import { requireRole, type RequestContext, type SignedContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, storedJson, type Result } from '../http/respond.js';
import { hourBank, memberRecord } from '../api/shapes.js';
import { asString, exactBody } from '../api/validate.js';
import { loadMember, loadMembers, saveBusinessName } from '../store/kitchens.js';
import { itemsFor, usedQuarters } from '../store/ledger.js';
import { frozenInvoice, isMonthClosed } from '../store/months.js';
import { flushMemberQuietly } from '../services/outbox.js';

/** GET /api/members */
export async function listMembers(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator', 'shift_lead']);
  const query = signedContext.query.get('q');
  const members = await loadMembers(db(), signedContext.kitchen.id);
  const needle = (query ?? '').toLocaleLowerCase();
  const matched = members
    .filter(
      (member) =>
        needle.length === 0 ||
        member.name.toLocaleLowerCase().includes(needle) ||
        member.businessName.toLocaleLowerCase().includes(needle),
    )
    .slice(0, 20);
  return json(200, {
    members: matched.map((member) => memberRecord(member, signedContext.person.role)),
  });
}

async function resolveMember(context: RequestContext, memberId: string) {
  const signedContext = context as SignedContext;
  const member = await loadMember(db(), signedContext.kitchen.id, memberId);
  if (!member) throw errors.notFound();
  if (signedContext.person.role === 'member' && signedContext.person.memberId !== member.id) {
    throw errors.notFound();
  }
  return member;
}

/** GET /api/members/{memberId} */
export async function readMember(context: RequestContext, memberId: string): Promise<Result> {
  const member = await resolveMember(context, memberId);
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  return json(200, { member: memberRecord(member, signedContext.person.role) });
}

/** PATCH /api/members/me */
export async function patchOwnMember(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['member']);
  const body = exactBody(signedContext.json, ['businessName']);
  const raw = asString(body['businessName']);
  const name = raw === null ? null : normalise(raw);
  if (name === null || !businessNameIsValid(name)) {
    throw errors.validationFailed({ businessName: fieldCopy.businessName });
  }
  const memberId = signedContext.person.memberId!;
  await transact((client) => saveBusinessName(client, memberId, name));
  void flushMemberQuietly(memberId, 1000);
  const member = (await loadMember(db(), signedContext.kitchen.id, memberId))!;
  return json(200, { member: memberRecord(member, signedContext.person.role) });
}

/** GET /api/members/{memberId}/hour-bank */
export async function readHourBank(context: RequestContext, memberId: string): Promise<Result> {
  const member = await resolveMember(context, memberId);
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  const requested = signedContext.query.get('month');
  if (requested !== null && !isMonth(requested)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const month = requested ?? localMonthOf(signedContext.kitchen.timeZone, signedContext.nowMs);
  return json(
    200,
    hourBank(month, member.allowanceQuarters, await usedQuarters(db(), member.id, month)),
  );
}

export type InvoiceLine = {
  kind: string;
  bookingId: string;
  description: string;
  amountCents: number;
  billingStatus: 'billed' | 'pending_billing';
};

export type Invoice = {
  memberId: string;
  month: string;
  status: 'open' | 'closed';
  lines: InvoiceLine[];
  totalCents: number;
  hourBank: Record<string, unknown>;
};

/** The live invoice for a member and month. */
export async function buildInvoice(
  kitchenId: string,
  member: { id: string; allowanceQuarters: number },
  month: string,
): Promise<Invoice> {
  const items = await itemsFor(db(), member.id, month);
  const lines: InvoiceLine[] = items.map((item) => ({
    kind: item.lineKind,
    bookingId: item.bookingId,
    description: item.description,
    amountCents: item.amountCents,
    billingStatus: item.recorded ? 'billed' : 'pending_billing',
  }));
  const closed = await isMonthClosed(db(), kitchenId, month);
  return {
    memberId: member.id,
    month,
    status: closed ? 'closed' : 'open',
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    hourBank: hourBank(
      month,
      member.allowanceQuarters,
      await usedQuarters(db(), member.id, month),
    ) as Record<string, unknown>,
  };
}

/** GET /api/members/{memberId}/invoices/{month} */
export async function readInvoice(
  context: RequestContext,
  memberId: string,
  month: string,
): Promise<Result> {
  const member = await resolveMember(context, memberId);
  const signedContext = requireRole(context, ['member', 'operator']);
  if (!isMonth(month)) throw errors.validationFailed({ month: fieldCopy.month });
  const frozen = await frozenInvoice(db(), signedContext.kitchen.id, month, member.id);
  if (frozen !== null) return storedJson(200, frozen);
  return json(200, await buildInvoice(signedContext.kitchen.id, member, month));
}
