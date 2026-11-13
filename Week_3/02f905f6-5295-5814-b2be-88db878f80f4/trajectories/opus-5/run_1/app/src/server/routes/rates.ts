import type { Route } from '../http/router';
import { signedInUser } from '../http/router';
import * as errors from '../http/errors';
import { quoteOf, validateRateSet } from '../domain/fee';
import { measure, parsePlan, sidesInOf, MSG, type Measured } from '../domain/measure';
import { validateProfile } from '../domain/schedule';
import { studioDate } from '../domain/time';
import {
  createRateSet,
  findKiln,
  findProfile,
  listRateSets,
  maxPieceHeightHalfUnits,
  rateSetFor,
  saveProfile,
} from '../repo/catalog';

export const rateRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/rates',
    roles: ['owner'],
    handler: async () => ({ status: 200, body: await listRateSets() }),
  },
  {
    method: 'GET',
    path: '/api/rates/current',
    roles: 'signed-in',
    handler: async (ctx) => {
      const rateSet = await rateSetFor(studioDate(ctx.now));
      if (!rateSet) throw errors.notFound();
      return { status: 200, body: rateSet };
    },
  },
  {
    method: 'POST',
    path: '/api/rates',
    roles: ['owner'],
    handler: async (ctx) => {
      const { draft, fields } = validateRateSet(
        {
          bisque_rate: ctx.body.bisque_rate,
          glaze_rate: ctx.body.glaze_rate,
          member_discount_percent: ctx.body.member_discount_percent,
          order_minimum_cents: ctx.body.order_minimum_cents,
          effective_date: ctx.body.effective_date,
        },
        studioDate(ctx.now),
      );
      if (!draft) throw errors.unprocessable(fields);
      const created = await createRateSet(draft);
      if (created === 'date_taken') {
        throw errors.conflict(
          'rate_date_taken',
          `Rates already set for ${draft.effective_date}.`,
        );
      }
      return { status: 201, body: created };
    },
  },
  {
    method: 'POST',
    path: '/api/quote',
    roles: ['member', 'tech', 'owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const outcome = measure(ctx.body, await maxPieceHeightHalfUnits());
      const fields = { ...outcome.fields };
      const plan = parsePlan(ctx.body.plan);
      if (!plan) fields.plan = MSG.plan;
      if (Object.keys(fields).length > 0) throw errors.unprocessable(fields);
      const rateSet = await rateSetFor(studioDate(ctx.now));
      if (!rateSet) throw errors.conflict('no_rate_set', 'No firing rates are in effect.');
      const measured = outcome.measured as Measured;
      return {
        status: 200,
        body: quoteOf({
          sidesIn: sidesInOf(measured),
          cubicMilli: measured.cubicMilli,
          plan: plan as NonNullable<typeof plan>,
          rateSet,
          isMember: user.role === 'member',
        }),
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/kilns/:kiln_id/profiles/:profile_id',
    roles: ['owner'],
    handler: async (ctx) => {
      const kilnId = ctx.params.kiln_id as string;
      const profileId = ctx.params.profile_id as string;
      const kiln = await findKiln(kilnId);
      if (!kiln) throw errors.notFound();
      const profile = await findProfile(kilnId, profileId);
      if (!profile) throw errors.notFound();
      const { draft, fields } = validateProfile({
        segments: ctx.body.segments,
        cool_down_hours: ctx.body.cool_down_hours,
      });
      if (!draft) throw errors.unprocessable(fields);
      const saved = await saveProfile({
        profileId,
        kilnId,
        segments: draft.segments,
        coolDownHours: draft.cool_down_hours,
      });
      if (!saved) throw errors.notFound();
      return { status: 200, body: saved };
    },
  },
];
