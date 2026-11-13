import { BlendRow, PlanRow, currentBlend, findBlend, findPlan, latestPublishedPlan } from '../data';
import { newId, query } from '../db';
import { ApiError, conflict, notFound, stale } from '../http/errors';
import { Route, defineRoute, jsonBody, person } from '../http/kernel';
import { INGREDIENTS, INGREDIENTS_BY_ID } from '../shared/catalog';
import { copy } from '../shared/copy';
import { PRACTICE_ZONE, instantToIso, localTime } from '../shared/time';
import { BlendItemInput, overfullPacket, packBlend } from '../domain/blend';
import { FieldErrors, readString } from './validate';
import { requireMember } from './members';
import { blendView, planView } from './views';

const SECTION_LIMIT = 20000;
const SECTION_NAMES = ['nutrition', 'movement', 'sleep', 'supplements'] as const;

interface Sections {
  nutrition: string;
  movement: string;
  sleep: string;
  supplements: string;
}

function readSections(body: Record<string, unknown>): Sections {
  const errors = new FieldErrors();
  const raw = (body.sections ?? {}) as Record<string, unknown>;
  const sections: Sections = { nutrition: '', movement: '', sleep: '', supplements: '' };
  for (const name of SECTION_NAMES) {
    const text = readString(raw[name]) ?? '';
    if ([...text].length > SECTION_LIMIT) errors.add(`sections.${name}`, copy.planSectionLength);
    sections[name] = text;
  }
  errors.throwIfAny();
  return sections;
}

async function refuseWhenNewerPlan(memberId: string, basedOnPlanId: string | null): Promise<void> {
  const latest = await latestPublishedPlan(memberId);
  if (!latest || latest.id === basedOnPlanId) return;
  throw stale(
    copy.newerPlan(
      latest.published_by ?? 'A specialist',
      localTime(latest.published_at as Date, PRACTICE_ZONE),
    ),
  );
}

async function planReply(plan: PlanRow, status: number): Promise<{ status: number; json: unknown }> {
  const blend = plan.blend_id ? await findBlend(plan.blend_id) : null;
  return { status, json: { plan: planView(plan, blend) } };
}

function readBlendItems(body: Record<string, unknown>): BlendItemInput[] {
  const errors = new FieldErrors();
  const list = Array.isArray(body.items) ? body.items : [];
  const items: BlendItemInput[] = [];
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const ingredientId = readString(raw.ingredient) ?? '';
    const ingredient = INGREDIENTS_BY_ID.get(ingredientId);
    if (!ingredient) {
      errors.add(`items.${index}.ingredient`, copy.ingredientChoice);
      return;
    }
    if (seen.has(ingredient.id)) {
      errors.add(`items.${index}.ingredient`, copy.ingredientOnce);
      return;
    }
    seen.add(ingredient.id);
    const capsules = raw.capsulesPerDay;
    if (typeof capsules !== 'number' || !Number.isInteger(capsules) || capsules < 1) {
      errors.add(`items.${index}.capsulesPerDay`, copy.capsulesWhole);
      return;
    }
    items.push({ ingredient: ingredient.id, capsulesPerDay: capsules });
  });
  errors.throwIfAny();
  return items;
}

function packOrRefuse(items: BlendItemInput[]) {
  const packed = packBlend(items);
  const overfull = overfullPacket(packed);
  if (overfull) throw new ApiError(422, 'packet_full', copy.packetFull(overfull));
  return packed;
}

export const planRoutes: Route[] = [
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/plans',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      const body = jsonBody<Record<string, unknown>>(ctx);
      const basedOnPlanId = readString(body.basedOnPlanId);
      if (basedOnPlanId) {
        const basis = await findPlan(basedOnPlanId);
        if (!basis || basis.member_id !== member.id) throw notFound();
      }
      return { member, body, basedOnPlanId: basedOnPlanId ?? null };
    },
    handler: async (ctx, { member, body, basedOnPlanId }) => {
      const sections = readSections(body);
      await refuseWhenNewerPlan(member.id, basedOnPlanId);
      const id = newId();
      await query(
        `insert into plans (id, member_id, state, based_on_plan_id, nutrition, movement, sleep, supplements)
         values ($1, $2, 'draft', $3, $4, $5, $6, $7)`,
        [
          id,
          member.id,
          basedOnPlanId,
          sections.nutrition,
          sections.movement,
          sections.sleep,
          sections.supplements,
        ],
      );
      const plan = await findPlan(id);
      if (!plan) throw new Error('Plan vanished after create');
      return planReply(plan, 201);
    },
  }),
  defineRoute({
    method: 'PUT',
    path: '/api/longevity-plans/:planId',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const plan = await findPlan(ctx.params.planId as string);
      if (!plan) throw notFound();
      return plan;
    },
    handler: async (ctx, plan) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const sections = readSections(body);
      if (plan.state === 'published') {
        throw conflict('already_published', copy.planAlreadyPublished);
      }
      await refuseWhenNewerPlan(plan.member_id, plan.based_on_plan_id);
      await query(
        `update plans set nutrition = $2, movement = $3, sleep = $4, supplements = $5,
           updated_at = now() where id = $1`,
        [plan.id, sections.nutrition, sections.movement, sections.sleep, sections.supplements],
      );
      const saved = await findPlan(plan.id);
      return planReply(saved as PlanRow, 200);
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/longevity-plans/:planId/publish',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const plan = await findPlan(ctx.params.planId as string);
      if (!plan) throw notFound();
      return plan;
    },
    handler: async (ctx, plan) => {
      jsonBody<Record<string, unknown>>(ctx);
      if (plan.state === 'published') {
        throw conflict('already_published', copy.planAlreadyPublished);
      }
      await refuseWhenNewerPlan(plan.member_id, plan.based_on_plan_id);
      const blend = await currentBlend(plan.member_id);
      const who = person(ctx);
      await query(
        `update plans set state = 'published', published_at = now(), published_by = $2,
           blend_id = $3, updated_at = now() where id = $1`,
        [plan.id, who.name, blend?.id ?? null],
      );
      const published = await findPlan(plan.id);
      return planReply(published as PlanRow, 200);
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members/:memberId/plans',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (_ctx, member) => {
      const rows = await query<PlanRow>(
        `select * from plans where member_id = $1
         order by coalesce(published_at, updated_at) desc, created_at desc`,
        [member.id],
      );
      const plans = [];
      for (const plan of rows) {
        const blend = plan.blend_id ? await findBlend(plan.blend_id) : null;
        plans.push(planView(plan, blend));
      }
      return { status: 200, json: { plans } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/longevity-plans/:planId',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const plan = await findPlan(ctx.params.planId as string);
      if (!plan) throw notFound();
      return plan;
    },
    handler: async (_ctx, plan) => planReply(plan, 200),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/plan',
    access: ['member'],
    handler: async (ctx) => {
      const member = await requireMember(person(ctx).id);
      const plan = await latestPublishedPlan(member.id);
      if (!plan) return { status: 200, json: { plan: null } };
      const blend = await currentBlend(member.id);
      return { status: 200, json: { plan: planView(plan, blend) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/ingredients',
    access: ['owner', 'specialist'],
    handler: async () => ({
      status: 200,
      json: {
        ingredients: INGREDIENTS.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          strength: ingredient.strength.mcg
            ? {
                amount: ingredient.strength.amount,
                unit: ingredient.strength.unit,
                mcg: ingredient.strength.mcg,
              }
            : { amount: ingredient.strength.amount, unit: ingredient.strength.unit },
          time: ingredient.time,
          priceCentsPerCapsule: ingredient.priceCentsPerCapsule,
        })),
      },
    }),
  }),
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/blends/preview',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (ctx, member) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const packed = packOrRefuse(readBlendItems(body));
      const who = person(ctx);
      return {
        status: 200,
        json: {
          blend: {
            memberId: member.id,
            items: packed.items,
            morningCapsules: packed.morningCapsules,
            eveningCapsules: packed.eveningCapsules,
            listPriceCents: packed.listPriceCents,
            memberPriceCents: packed.memberPriceCents,
            savedBy: who.name,
            savedAt: instantToIso(new Date()),
          },
        },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/members/:memberId/blends',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (ctx, member) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const packed = packOrRefuse(readBlendItems(body));
      const who = person(ctx);
      const id = newId();
      await query(
        `insert into blends (id, member_id, items, morning_capsules, evening_capsules,
           list_price_cents, member_price_cents, saved_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          member.id,
          JSON.stringify(packed.items),
          packed.morningCapsules,
          packed.eveningCapsules,
          packed.listPriceCents,
          packed.memberPriceCents,
          who.name,
        ],
      );
      const blend = await findBlend(id);
      return { status: 201, json: { blend: blendView(blend as BlendRow) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/members/:memberId/blends',
    access: ['owner', 'specialist'],
    resolve: async (ctx) => {
      const member = await requireMember(ctx.params.memberId as string);
      if (member.account_state === 'erased') throw notFound();
      return member;
    },
    handler: async (_ctx, member) => {
      const rows = await query<BlendRow>(
        'select * from blends where member_id = $1 order by saved_at desc, id desc',
        [member.id],
      );
      return { status: 200, json: { blends: rows.map(blendView) } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/blend',
    access: ['member'],
    handler: async (ctx) => {
      const blend = await currentBlend(person(ctx).id);
      return { status: 200, json: { blend: blend ? blendView(blend) : null } };
    },
  }),
];
