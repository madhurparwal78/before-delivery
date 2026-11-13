import { DrawRow, MemberRow, VisitPageRow, findDraw, findMember, listDrawKitCodes } from '../data';
import { query, queryOne } from '../db';
import { conflict, gone, notFound } from '../http/errors';
import { Route, defineRoute, jsonBody } from '../http/kernel';
import { copy } from '../shared/copy';
import { readKitCode } from '../shared/kitcode';
import { instantToIso, localDate } from '../shared/time';
import { shortMemberName } from '../services/visitPages';
import { FieldErrors, readString } from './validate';

interface VisitContext {
  page: VisitPageRow;
  draw: DrawRow;
  member: MemberRow;
  isDrawDay: boolean;
}

async function requireLivePage(token: string): Promise<VisitContext> {
  const page = await queryOne<VisitPageRow>('select * from visit_pages where token = $1', [token]);
  if (!page) throw notFound();
  if (page.ended_at !== null || page.ends_at.getTime() <= Date.now()) throw gone();
  const draw = await findDraw(page.draw_id);
  if (!draw || draw.state === 'cancelled') throw gone();
  const member = await findMember(draw.member_id);
  if (!member || member.account_state === 'erased') throw gone();
  return {
    page,
    draw,
    member,
    isDrawDay: localDate(new Date(), draw.time_zone) === draw.local_date,
  };
}

async function visitView(context: VisitContext): Promise<unknown> {
  const { page, draw, member, isDrawDay } = context;
  return {
    memberName: shortMemberName(member.name ?? ''),
    startsAt: instantToIso(draw.starts_at),
    localDate: draw.local_date,
    localTime: draw.local_time,
    timeZone: draw.time_zone,
    isDrawDay,
    address:
      isDrawDay && member.address_line1
        ? {
            line1: member.address_line1,
            line2: member.address_line2 ?? '',
            city: member.city ?? '',
            state: member.state,
            postalCode: member.postal_code ?? '',
          }
        : null,
    gateNotes: isDrawDay ? member.gate_notes : null,
    kitCodes: await listDrawKitCodes(draw.id),
    state: draw.state === 'booked' ? 'booked' : 'collected',
    collectedAt: draw.collected_at ? instantToIso(draw.collected_at) : null,
    endsAt: instantToIso(page.ends_at),
  };
}

export const visitRoutes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/api/visits/:token',
    access: 'public',
    resolve: async (ctx) => requireLivePage(ctx.params.token as string),
    handler: async (_ctx, context) => ({ status: 200, json: await visitView(context) }),
  }),
  defineRoute({
    method: 'POST',
    path: '/api/visits/:token/kit-codes',
    access: 'public',
    resolve: async (ctx) => requireLivePage(ctx.params.token as string),
    handler: async (ctx, context) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const read = readKitCode(readString(body.kitCode) ?? '');
      if (!read.kitCode) {
        errors.add('kitCode', read.problem === 'check' ? copy.kitCodeCheck : copy.kitCodeShape);
      }
      errors.throwIfAny();
      if (context.draw.state !== 'booked') {
        throw conflict('already_collected', copy.alreadyCollected);
      }
      const kitCode = read.kitCode as string;
      const existing = await listDrawKitCodes(context.draw.id);
      if (existing.includes(kitCode)) {
        return { status: 200, json: { kitCodes: existing } };
      }
      await query('insert into draw_kit_codes (draw_id, kit_code) values ($1, $2)', [
        context.draw.id,
        kitCode,
      ]);
      return { status: 201, json: { kitCodes: await listDrawKitCodes(context.draw.id) } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/visits/:token/collect',
    access: 'public',
    resolve: async (ctx) => requireLivePage(ctx.params.token as string),
    handler: async (ctx, context) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (context.draw.state !== 'booked') {
        throw conflict('already_collected', copy.alreadyCollected);
      }
      const kitCodes = await listDrawKitCodes(context.draw.id);
      if (kitCodes.length === 0) throw conflict('kit_code_required', copy.kitCodeRequired);
      if (!context.isDrawDay) throw conflict('not_draw_day', copy.notDrawDay);
      const collectedAt = new Date();
      await query("update draws set state = 'collected', collected_at = $2 where id = $1", [
        context.draw.id,
        collectedAt,
      ]);
      return {
        status: 200,
        json: { state: 'collected', collectedAt: instantToIso(collectedAt) },
      };
    },
  }),
];
