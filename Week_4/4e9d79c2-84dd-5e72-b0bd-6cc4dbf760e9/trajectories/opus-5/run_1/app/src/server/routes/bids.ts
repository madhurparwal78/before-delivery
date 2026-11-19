import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, gone, invalid, notFound } from '../errors.js';
import { alreadyAwarded, awardedTo, bidsClosedAt, copy, noPriceOnHire } from '../copy.js';
import { inTransaction, makeId, nextCounter, query } from '../db.js';
import { requireDesk } from '../session.js';
import { instantString, readWall, ukTimeOf } from '../../domain/time.js';
import { moneyString, parseTypedPrice } from '../../domain/money.js';
import { Size } from '../../domain/vehicles.js';
import {
  askOperator,
  bidByToken,
  bidStatus,
  bidTotal,
  bidsOf,
  hasLivePrice,
  markClosingMailed,
  savePrices,
  sortBids,
  windowEndedAt,
  windowOpen,
  withdrawBid,
} from '../data/bids.js';
import { loadHire } from '../data/hires.js';
import { operatorsOf, standingFor } from '../data/operators.js';
import { savedPlan } from '../data/trips.js';
import { rateTableInForce } from '../data/rates.js';
import { makeRun } from '../data/runs.js';
import { mailHireClosed, mailPriceRequest } from '../mails.js';
import { ukDateOf } from '../../domain/time.js';

export const bidRoutes: Route[] = [
  route('POST', '/api/enquiries/:id/bids/ask', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const ids = Array.isArray(body.operatorIds) ? body.operatorIds : [];
    if (ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw invalid('Choose at least one operator.', { operatorIds: 'Choose at least one operator.' });
    }
    if (hire.awardedOperatorId) {
      throw conflict('alreadyAwarded', alreadyAwarded(hire.awardedOperatorId, ukTimeOf(hire.awardedAt ?? Date.now())));
    }
    const plan = await savedPlan(desk.id, hire.id);
    if (!plan) throw conflict('noPlan', copy.savePlanFirst);
    const operators = await operatorsOf(desk.id);
    for (const id of ids as string[]) {
      if (!operators.some((operator) => operator.id === id)) throw notFound();
    }
    const already = await bidsOf(desk.id, hire.id);
    const asks: Record<string, unknown>[] = [];
    for (const operatorId of ids as string[]) {
      const held = already.find((bid) => bid.operatorId === operatorId);
      if (held) {
        asks.push({
          operatorId,
          bidPath: `/b/${held.token}`,
          sentAt: instantString(held.sentAt),
          closesAt: instantString(held.closesAt),
        });
        continue;
      }
      const bid = await askOperator(desk.id, hire.id, operatorId, Date.now());
      const operator = operators.find((candidate) => candidate.id === operatorId);
      if (operator) {
        await mailPriceRequest(
          operator.email,
          hire.reference,
          hire.stops.map((stop) => stop.text),
          hire.departAt,
          hire.returnAt,
          plan,
          hire.party.people,
          `/b/${bid.token}`,
        );
      }
      asks.push({
        operatorId,
        bidPath: `/b/${bid.token}`,
        sentAt: instantString(bid.sentAt),
        closesAt: instantString(bid.closesAt),
      });
    }
    ctx.json(201, { asks });
  }),

  route('GET', '/api/enquiries/:id/bids', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const sort = ctx.queryValue('sort') === 'priceHighest' ? 'priceHighest' : 'priceLowest';
    const operators = await operatorsOf(desk.id);
    const now = Date.now();
    const sorted = sortBids(await bidsOf(desk.id, hire.id), sort);
    ctx.json(200, {
      bids: sorted.map(({ bid, total }) => {
        const operator = operators.find((candidate) => candidate.id === bid.operatorId);
        const standing = operator ? standingFor(operator, hire) : { clear: false, reason: copy.noLongerListed };
        const live = hasLivePrice(bid);
        return {
          operatorId: bid.operatorId,
          operatorName: operator?.name ?? bid.operatorId,
          status: bidStatus(bid, hire.awardedAt, now),
          clear: standing.clear,
          reason: standing.reason,
          prices: live && bid.prices ? bid.prices.map(moneyString) : [],
          total: total === null ? null : moneyString(total),
          receivedAt: live && bid.receivedAt !== null ? instantString(bid.receivedAt) : null,
          closesAt: instantString(bid.closesAt),
        };
      }),
      awarded: hire.awardedOperatorId
        ? {
            operatorId: hire.awardedOperatorId,
            operatorName:
              operators.find((candidate) => candidate.id === hire.awardedOperatorId)?.name ?? hire.awardedOperatorId,
            at: instantString(hire.awardedAt ?? 0),
          }
        : null,
    });
  }),

  route('POST', '/api/enquiries/:id/award', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const operatorId = body.operatorId;
    if (typeof operatorId !== 'string') throw invalid('Choose an operator.', { operatorId: 'Choose an operator.' });
    const operators = await operatorsOf(desk.id);
    const operator = operators.find((candidate) => candidate.id === operatorId);
    if (!operator) throw notFound();
    if (hire.awardedOperatorId) {
      const held = operators.find((candidate) => candidate.id === hire.awardedOperatorId);
      throw conflict(
        'alreadyAwarded',
        alreadyAwarded(held?.name ?? hire.awardedOperatorId, ukTimeOf(hire.awardedAt ?? Date.now())),
      );
    }
    const bids = await bidsOf(desk.id, hire.id);
    const bid = bids.find((candidate) => candidate.operatorId === operatorId);
    if (!bid || !hasLivePrice(bid) || !bid.prices) throw conflict('noBid', noPriceOnHire(operator.name));
    const standing = standingFor(operator, hire);
    if (!standing.clear) throw conflict('operatorNotClear', standing.reason ?? copy.noLongerListed);

    const now = Date.now();
    const plan = (await savedPlan(desk.id, hire.id)) ?? [];
    const rates = await rateTableInForce(desk.id, ukDateOf(now));
    const won = await inTransaction(async (client) => {
      const taken = await client.query(
        'update hires set awarded_operator_id = $3, awarded_at = $4 where desk_id = $1 and id = $2 and awarded_operator_id is null',
        [desk.id, hire.id, operatorId, now],
      );
      if (taken.rowCount === 0) return false;
      await client.query('delete from vehicles where desk_id = $1 and hire_id = $2', [desk.id, hire.id]);
      for (let index = 0; index < plan.length; index += 1) {
        const vehicleId = makeId('VH');
        await client.query(
          `insert into vehicles (desk_id, id, hire_id, position, seats, operator_id, bought_price, margin_tenths)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            desk.id,
            vehicleId,
            hire.id,
            index,
            plan[index],
            operatorId,
            (bid.prices as number[])[index] ?? 0,
            rates.defaultMarginTenths,
          ],
        );
        const number = await nextCounter(client, desk.id, 'run');
        await makeRun(
          client,
          desk.id,
          hire.id,
          vehicleId,
          plan[index] as Size,
          number,
          hire.departAt,
          hire.departInstant,
          hire.stops.map((stop) => stop.text),
        );
      }
      return true;
    });
    if (!won) {
      const fresh = assertKnown(await loadHire(desk.id, hire.id));
      const held = operators.find((candidate) => candidate.id === fresh.awardedOperatorId);
      throw conflict(
        'alreadyAwarded',
        alreadyAwarded(held?.name ?? (fresh.awardedOperatorId as string), ukTimeOf(fresh.awardedAt ?? now)),
      );
    }
    for (const other of bids) {
      if (other.operatorId === operatorId || other.closingMailed) continue;
      const losing = operators.find((candidate) => candidate.id === other.operatorId);
      if (losing) await mailHireClosed(losing.email, hire.reference);
      await markClosingMailed(desk.id, other.id);
    }
    ctx.json(200, {
      awarded: { operatorId, operatorName: operator.name, at: instantString(now) },
      announcement: awardedTo(operator.name),
    });
  }),

  route('GET', '/api/b/:token', 'private', async (ctx) => {
    const found = await bidByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    const hire = assertKnown(await loadHire(found.deskId, found.bid.enquiryId));
    const now = Date.now();
    if (!windowOpen(found.bid, hire.awardedAt, now)) {
      throw gone('bidsClosed', bidsClosedAt(ukTimeOf(windowEndedAt(found.bid, hire.awardedAt))));
    }
    const plan = (await savedPlan(found.deskId, hire.id)) ?? [];
    ctx.json(200, {
      route: { stops: hire.stops.map((stop) => stop.text) },
      dates: {
        departAt: hire.departAt,
        returnAt: hire.returnAt,
        departInstant: instantString(hire.departInstant),
        returnInstant: hire.returnInstant === null ? null : instantString(hire.returnInstant),
      },
      vehicles: plan.map((seats, index) => ({ index: index + 1, seats })),
      partySize: hire.party.people,
      closesAt: instantString(found.bid.closesAt),
      bid: hasLivePrice(found.bid) && found.bid.prices
        ? { prices: found.bid.prices.map(moneyString), receivedAt: instantString(found.bid.receivedAt as number) }
        : null,
    });
  }),

  route('PUT', '/api/b/:token/bid', 'private', async (ctx) => {
    const found = await bidByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    const hire = assertKnown(await loadHire(found.deskId, found.bid.enquiryId));
    const now = Date.now();
    if (!windowOpen(found.bid, hire.awardedAt, now)) {
      throw gone('bidsClosed', bidsClosedAt(ukTimeOf(windowEndedAt(found.bid, hire.awardedAt))));
    }
    const body = await jsonBody(ctx);
    const plan = (await savedPlan(found.deskId, hire.id)) ?? [];
    const prices = Array.isArray(body.prices) ? body.prices : null;
    if (!prices || prices.length !== plan.length) {
      throw invalid(copy.priceGrammar, { prices: copy.priceGrammar });
    }
    const pennies: number[] = [];
    for (let index = 0; index < prices.length; index += 1) {
      const parsed = parseTypedPrice(prices[index]);
      if (parsed === null) {
        throw invalid(copy.priceGrammar, { [`prices.${index}`]: copy.priceGrammar });
      }
      pennies.push(parsed);
    }
    const changed = hasLivePrice(found.bid);
    await savePrices(found.deskId, found.bid.id, pennies, now);
    if (hire.enquiryState === 'new') {
      await query("update enquiries set state = 'priced' where desk_id = $1 and id = $2 and state = 'new'", [
        found.deskId,
        hire.id,
      ]);
    }
    ctx.json(200, {
      bid: { prices: pennies.map(moneyString), receivedAt: instantString(now) },
      announcement: changed ? copy.priceChanged : copy.priceSent,
    });
  }),

  route('DELETE', '/api/b/:token/bid', 'private', async (ctx) => {
    const found = await bidByToken(pathParam(ctx, 'token'));
    if (!found) throw notFound();
    const hire = assertKnown(await loadHire(found.deskId, found.bid.enquiryId));
    const now = Date.now();
    if (!windowOpen(found.bid, hire.awardedAt, now)) {
      throw gone('bidsClosed', bidsClosedAt(ukTimeOf(windowEndedAt(found.bid, hire.awardedAt))));
    }
    if (!hasLivePrice(found.bid)) throw conflict('noBid', 'There is no price to withdraw.');
    await withdrawBid(found.deskId, found.bid.id);
    ctx.send(204, '');
  }),
];

export function instantOf(local: { date: string; time: string }): number {
  return readWall(local)?.instant ?? 0;
}
