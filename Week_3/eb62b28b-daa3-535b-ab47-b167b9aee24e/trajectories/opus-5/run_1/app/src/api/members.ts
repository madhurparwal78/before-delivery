import { createHash } from 'node:crypto';
import { MemberRow, findMember } from '../data';
import { newId, query, queryOne } from '../db';
import { conflict, invalid, notFound, requestKeyReused } from '../http/errors';
import { Reply, Route, defineRoute, jsonBody, person } from '../http/kernel';
import { hashPassword } from '../http/sessions';
import { copy } from '../shared/copy';
import { Cadence } from '../shared/money';
import { PRACTICE_ZONE, localDate, parseDateOnly } from '../shared/time';
import {
  cancelPlus,
  changeCadence,
  membershipOf,
  refreshFromKillBill,
  startPlus,
  uncancelPlus,
} from '../services/memberships';
import { checkReachable } from '../services/killbill';
import { config } from '../config';
import {
  FieldErrors,
  readAccountInput,
  readAddress,
  readString,
  validCadence,
} from './validate';
import { billingMemberView, memberView, membershipView } from './views';

function practiceToday(): { year: number; month: number; day: number } {
  const parsed = parseDateOnly(localDate(new Date(), PRACTICE_ZONE));
  if (!parsed) throw new Error('Bad practice date');
  return parsed;
}

export async function requireMember(id: string): Promise<MemberRow> {
  const member = await findMember(id);
  if (!member) throw notFound();
  return member;
}

/** Resolves the signed-in member's own row. */
export async function ownMember(memberId: string): Promise<MemberRow> {
  const member = await findMember(memberId);
  if (!member) throw notFound();
  return member;
}

export function refuseWhenClosing(member: MemberRow): void {
  if (member.account_state !== 'active') throw conflict('account_closing', copy.writeToClosing);
}

async function replayOrRemember<T>(
  memberId: string,
  key: string | null,
  bodyBytes: Buffer,
  run: () => Promise<Reply>,
): Promise<Reply> {
  if (!key) return run();
  const digest = createHash('sha256').update(bodyBytes).digest('hex');
  const stored = await queryOne<{ body_digest: string; status: number; response: string }>(
    'select body_digest, status, response from request_keys where member_id = $1 and key = $2',
    [memberId, key],
  );
  if (stored) {
    if (stored.body_digest !== digest) throw requestKeyReused();
    return {
      status: stored.status,
      bytes: Buffer.from(stored.response, 'utf8'),
      contentType: 'application/json; charset=utf-8',
    };
  }
  const reply = await run();
  await query(
    `insert into request_keys (member_id, key, body_digest, status, response)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [memberId, key, digest, reply.status, JSON.stringify(reply.json ?? null)],
  );
  return reply;
}

export const memberRoutes: Route[] = [
  defineRoute({
    method: 'POST',
    path: '/api/members',
    access: ['owner'],
    handler: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const input = readAccountInput(body, practiceToday(), errors);
      const address = readAddress(body.address, errors);
      const cadence = body.cadence === null || body.cadence === undefined ? null : validCadence(body.cadence);
      if (body.cadence !== null && body.cadence !== undefined && !cadence) {
        errors.add('cadence', copy.fieldChooseOption);
      }
      errors.throwIfAny();
      if (!input) throw invalid({ name: copy.fieldName });
      const takenMember = await queryOne<{ id: string }>(
        'select id from members where lower(email) = lower($1)',
        [input.email],
      );
      const takenStaff = await queryOne<{ id: string }>(
        'select id from staff where lower(email) = lower($1) and removed_at is null',
        [input.email],
      );
      if (takenMember || takenStaff) throw conflict('email_taken', copy.emailTaken);
      const id = newId();
      const member: MemberRow = {
        id,
        name: input.name,
        email: input.email,
        password_hash: hashPassword(input.password),
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        state: input.state,
        time_zone: input.timeZone,
        phone: readString(body.phone),
        address_line1: address?.line1 ?? null,
        address_line2: address?.line2 ?? null,
        city: address?.city ?? null,
        postal_code: address?.postalCode ?? null,
        gate_notes: readString(body.gateNotes) === '' ? null : readString(body.gateNotes),
        account_state: 'active',
        closing_at: null,
        erases_at: null,
        killbill_account_id: null,
        seq: '0',
      };
      await query(
        `insert into members (id, name, email, password_hash, date_of_birth, sex, state, time_zone,
           phone, address_line1, address_line2, city, postal_code, gate_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          member.name,
          member.email,
          member.password_hash,
          member.date_of_birth,
          member.sex,
          member.state,
          member.time_zone,
          member.phone,
          member.address_line1,
          member.address_line2,
          member.city,
          member.postal_code,
          member.gate_notes,
        ],
      );
      await membershipOf(id);
      if (cadence) {
        try {
          await startPlus(member, cadence);
        } catch (error) {
          await query('delete from members where id = $1', [id]);
          throw error;
        }
      }
      const created = await requireMember(id);
      return { status: 201, json: { member: memberView(created, await membershipOf(id)) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members',
    access: ['owner', 'specialist', 'coordinator', 'billingLead'],
    handler: async (ctx) => {
      const search = ctx.query.get('q');
      const rows = search
        ? await query<MemberRow>(
            `select * from members where name ilike $1 or email ilike $1 order by seq`,
            [`%${search}%`],
          )
        : await query<MemberRow>('select * from members order by seq');
      const views = [];
      for (const member of rows) {
        const membership = await membershipOf(member.id);
        views.push(
          ctx.session?.person.role === 'billingLead'
            ? billingMemberView(member, membership)
            : memberView(member, membership),
        );
      }
      return { status: 200, json: { members: views } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members/:memberId',
    access: ['owner', 'specialist', 'coordinator', 'billingLead'],
    resolve: async (ctx) => requireMember(ctx.params.memberId as string),
    handler: async (ctx, member) => {
      let membership = await membershipOf(member.id);
      if (membership.state === 'pending') {
        membership = await refreshFromKillBill(member, membership).catch(() => membership);
      }
      return {
        status: 200,
        json: {
          member:
            ctx.session?.person.role === 'billingLead'
              ? billingMemberView(member, membership)
              : memberView(member, membership),
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      let membership = await membershipOf(member.id);
      if (membership.state === 'pending') {
        membership = await refreshFromKillBill(member, membership).catch(() => membership);
      }
      return { status: 200, json: { member: memberView(member, membership) } };
    },
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/me',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const address = readAddress(body.address, errors);
      errors.throwIfAny();
      refuseWhenClosing(member);
      const gateNotes = readString(body.gateNotes);
      await query(
        `update members set phone = $2, address_line1 = $3, address_line2 = $4, city = $5,
           postal_code = $6, gate_notes = $7 where id = $1`,
        [
          member.id,
          readString(body.phone) ?? member.phone,
          address?.line1 ?? member.address_line1,
          address?.line2 ?? member.address_line2,
          address?.city ?? member.city,
          address?.postalCode ?? member.postal_code,
          gateNotes === null ? member.gate_notes : gateNotes === '' ? null : gateNotes,
        ],
      );
      const updated = await requireMember(member.id);
      return { status: 200, json: { member: memberView(updated, await membershipOf(member.id)) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/membership',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      let membership = await membershipOf(member.id);
      if (membership.state === 'pending') {
        membership = await refreshFromKillBill(member, membership).catch(() => membership);
      }
      return { status: 200, json: { membership: membershipView(membership) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/membership',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      return replayOrRemember(member.id, ctx.requestKey, ctx.bodyBytes, async () => {
        const body = jsonBody<Record<string, unknown>>(ctx);
        const errors = new FieldErrors();
        const cadence = validCadence(body.cadence);
        if (!cadence) errors.add('cadence', copy.fieldChooseOption);
        errors.throwIfAny();
        refuseWhenClosing(member);
        const membership = await membershipOf(member.id);
        if (membership.state !== 'free') throw conflict('already_plus', copy.alreadyPlus);
        const started = await startPlus(member, cadence as Cadence);
        return { status: 201, json: { membership: membershipView(started) } };
      });
    },
  }),
  defineRoute({
    method: 'PATCH',
    path: '/api/me/membership',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const cadence = validCadence(body.cadence);
      if (!cadence) errors.add('cadence', copy.fieldChooseOption);
      errors.throwIfAny();
      refuseWhenClosing(member);
      const membership = await membershipOf(member.id);
      if (membership.state === 'free') throw conflict('not_plus', copy.notPlus);
      const effective = membership.pending_cadence ?? membership.cadence;
      if (effective === cadence) throw conflict('same_cadence', copy.sameCadence);
      const changed = await changeCadence(member, membership, cadence as Cadence);
      return { status: 200, json: { membership: membershipView(changed) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/membership/cancel',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      jsonBody<Record<string, unknown>>(ctx);
      refuseWhenClosing(member);
      const membership = await membershipOf(member.id);
      if (membership.state === 'free') throw conflict('not_plus', copy.notPlus);
      if (membership.state === 'cancelled') {
        throw conflict('already_ending', copy.alreadyEnding);
      }
      const cancelled = await cancelPlus(member, membership);
      return { status: 200, json: { membership: membershipView(cancelled) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/closure',
    access: ['member'],
    handler: async (ctx) => {
      const member = await ownMember(person(ctx).id);
      jsonBody<Record<string, unknown>>(ctx);
      if (member.account_state !== 'active') {
        throw conflict('account_closing', copy.writeToClosing);
      }
      const membership = await membershipOf(member.id);
      const cancelledAlready = membership.state === 'cancelled';
      if (membership.state === 'active' || membership.state === 'pending') {
        await cancelPlus(member, membership);
      } else if (membership.state === 'cancelled') {
        await checkReachable();
      }
      const erasesAt = new Date(Date.now() + config.closureWaitSeconds * 1000);
      await query(
        `update members set account_state = 'closing', closing_at = now(), erases_at = $2
         where id = $1`,
        [member.id, erasesAt],
      );
      await query('update memberships set cancelled_before_closure = $2 where member_id = $1', [
        member.id,
        cancelledAlready,
      ]);
      const updated = await requireMember(member.id);
      return {
        status: 200,
        json: { member: memberView(updated, await membershipOf(member.id)) },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/restore',
    access: ['owner'],
    resolve: async (ctx) => requireMember(ctx.params.memberId as string),
    handler: async (ctx, member) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (member.account_state === 'erasing' || member.account_state === 'erased') {
        throw conflict('erasure_started', copy.restoreAfterWait);
      }
      if (member.account_state !== 'closing') throw conflict('not_closing', copy.notClosing);
      if (member.erases_at && member.erases_at.getTime() <= Date.now()) {
        throw conflict('erasure_started', copy.restoreAfterWait);
      }
      await checkReachable();
      const membership = await membershipOf(member.id);
      if (!membership.cancelled_before_closure && membership.subscription_id) {
        await uncancelPlus(member, membership);
      }
      await query(
        `update members set account_state = 'active', closing_at = null, erases_at = null
         where id = $1`,
        [member.id],
      );
      const updated = await requireMember(member.id);
      return {
        status: 200,
        json: { member: memberView(updated, await membershipOf(member.id)) },
      };
    },
  }),
];
