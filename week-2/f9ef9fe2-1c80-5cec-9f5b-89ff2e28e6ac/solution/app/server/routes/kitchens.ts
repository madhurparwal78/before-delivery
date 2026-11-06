import { config } from "../config.js";
import { audit, transaction } from "../db.js";
import type { Kitchen, Member, RateCard } from "../domain.js";
import { refuse } from "../errors.js";
import { json, route } from "../http.js";
import { isCalendarDate, isQuarterHour, kitchenDate } from "../kitchenTime.js";
import { hoursText } from "../money.js";
import { covers } from "../rules.js";
import { cardInForce, kitchenMembers, loadStations, memberFor, monthQuarters, occupants, packBalance, rateCards, userKitchen } from "../store.js";
import { newId } from "../bookingUnit.js";
import { allow, authed, bodyOf, type Errors, failIfAny, isRecord } from "../validate.js";
import { kitchenView } from "../views.js";
import { memberCover } from "./holds.js";

async function kitchenBody(kitchen: Kitchen, now: Date) {
  return { kitchen: kitchenView(kitchen, await loadStations(kitchen.id), now, config.holdSeconds) };
}

route(
  "GET",
  "/api/kitchens/:kitchen_id",
  authed(async (request, user, now) => json(200, await kitchenBody(await userKitchen(user, request.params.kitchen_id), now))),
);

route(
  "PATCH",
  "/api/kitchens/:kitchen_id/settings",
  authed(async (request, user, now) => {
    const kitchen = await userKitchen(user, request.params.kitchen_id);
    allow(user, "operator");
    const cutoff = bodyOf(request).same_day_cutoff;
    if (!isQuarterHour(cutoff, 0, 23 * 60 + 45)) throw refuse.validation({ same_day_cutoff: "Enter a time on a quarter hour." });
    await transaction(async (client) => {
      await client.query("UPDATE kitchens SET same_day_cutoff = $1 WHERE id = $2", [cutoff, kitchen.id]);
      await audit(client, user.id, "kitchen", kitchen.id, kitchen.same_day_cutoff, cutoff, now);
    });
    return json(200, await kitchenBody({ ...kitchen, same_day_cutoff: cutoff }, now));
  }),
);

route(
  "GET",
  "/api/kitchens/:kitchen_id/loom",
  authed(async (request, user, now) => {
    const kitchen = await userKitchen(user, request.params.kitchen_id);
    const asked = request.query.get("member_id");
    let viewer: Member | null = null;
    if (user.role === "member" && user.member_id) viewer = await memberFor(user, user.member_id);
    else if (asked !== null) viewer = await memberFor(user, asked);
    allow(user, "operator", "member");
    const date = request.query.get("date");
    if (!isCalendarDate(date)) throw refuse.validation({ date: "Choose a date as YYYY-MM-DD." });
    const stations = await loadStations(kitchen.id);
    const businesses = new Map((await kitchenMembers(kitchen.id)).map((m) => [m.id, m.business]));
    const cover = viewer ? await memberCover(viewer, kitchen, now) : null;
    const cells = (await occupants(kitchen.id, date, now)).map((o) => {
      const where = { station_id: o.cell.station_id, start: o.cell.start };
      const state = o.hold_id !== null ? "held" : "booked";
      const ids = o.hold_id !== null ? { hold_id: o.hold_id, expires_at: o.expires_at?.toISOString() ?? null } : { booking_id: o.booking_id };
      if (user.role === "operator") return { ...where, state, business: businesses.get(o.member_id) ?? "", ...ids };
      if (o.member_id === user.member_id) return { ...where, state, ...ids };
      return { ...where, state: "taken" };
    });
    return json(200, {
      date,
      today: kitchenDate(kitchen.timezone, now),
      server_now: now.toISOString(),
      timezone: kitchen.timezone,
      same_day_cutoff: kitchen.same_day_cutoff,
      hold_seconds: config.holdSeconds,
      covered_until: cover,
      papers: viewer !== null && !covers(cover, date),
      stations,
      cells,
    });
  }),
);

async function memberSummary(member: Member, kitchen: Kitchen, now: Date) {
  return {
    id: member.id,
    business: member.business,
    contact_email: member.contact_email,
    covered_until: await memberCover(member, kitchen, now),
    month_hours: hoursText(await monthQuarters(member.id, kitchenDate(kitchen.timezone, now).slice(0, 7))),
    pack_balance_quarters: await packBalance(member.id),
  };
}

route(
  "GET",
  "/api/kitchens/:kitchen_id/members",
  authed(async (request, user, now) => {
    const kitchen = await userKitchen(user, request.params.kitchen_id);
    allow(user, "operator");
    const members = await Promise.all((await kitchenMembers(kitchen.id)).map((m) => memberSummary(m, kitchen, now)));
    return json(200, { members });
  }),
);

route(
  "GET",
  "/api/members/:member_id",
  authed(async (request, user, now) => {
    const member = await memberFor(user, request.params.member_id ?? "");
    allow(user, "operator", "member");
    return json(200, { member: await memberSummary(member, await userKitchen(user), now) });
  }),
);

function cardView(card: RateCard, inForceId: string) {
  return {
    id: card.id,
    effective_from: card.effective_from,
    tier_rates_cents: card.tier_rates_cents,
    station_surcharges_cents: card.station_surcharges_cents,
    cancellation_window_hours: card.cancellation_window_hours,
    pack_price_cents: card.pack_price_cents,
    in_force: card.id === inForceId,
    created_at: card.created_at.toISOString(),
  };
}

route(
  "GET",
  "/api/kitchens/:kitchen_id/rate-cards",
  authed(async (request, user, now) => {
    const kitchen = await userKitchen(user, request.params.kitchen_id);
    allow(user, "operator", "bookkeeper");
    const inForce = await cardInForce(kitchen, now);
    return json(200, { rate_cards: (await rateCards(kitchen.id)).map((c) => cardView(c, inForce.id)) });
  }),
);

const isWhole = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

route(
  "POST",
  "/api/kitchens/:kitchen_id/rate-cards",
  authed(async (request, user, now) => {
    const kitchen = await userKitchen(user, request.params.kitchen_id);
    allow(user, "operator");
    const body = bodyOf(request);
    const stations = await loadStations(kitchen.id);
    const today = kitchenDate(kitchen.timezone, now);
    const errors: Errors = {};
    const effective = isCalendarDate(body.effective_from) && body.effective_from >= today ? body.effective_from : "";
    if (!effective) errors.effective_from = "Choose today or a later date.";
    const tiers = Array.isArray(body.tier_rates_cents) ? body.tier_rates_cents.filter((t): t is number => isWhole(t, 1)) : [];
    if (!Array.isArray(body.tier_rates_cents) || body.tier_rates_cents.length !== 4 || tiers.length !== 4) {
      errors.tier_rates_cents = "Enter four hourly rates in dollars and cents.";
    }
    const raw = body.station_surcharges_cents;
    const surcharges: Record<string, number> = {};
    if (!isRecord(raw) || Object.keys(raw).length !== stations.length) {
      errors.station_surcharges_cents = "Enter a surcharge for every station.";
    } else {
      for (const station of stations) {
        const value = raw[station.id];
        if (isWhole(value, 0)) surcharges[station.id] = value;
        else errors.station_surcharges_cents = "Enter a surcharge for every station.";
      }
    }
    const windowHours = isWhole(body.cancellation_window_hours, 0, 336) ? body.cancellation_window_hours : -1;
    if (windowHours < 0) errors.cancellation_window_hours = "Enter 0 to 336 hours.";
    const packPrice = isWhole(body.pack_price_cents, 1) ? body.pack_price_cents : 0;
    if (packPrice === 0) errors.pack_price_cents = "Enter an amount in dollars and cents.";
    failIfAny(errors);
    const card: RateCard = {
      id: newId("rc"),
      kitchen_id: kitchen.id,
      effective_from: effective,
      tier_rates_cents: tiers,
      station_surcharges_cents: surcharges,
      cancellation_window_hours: windowHours,
      pack_price_cents: packPrice,
      created_at: now,
    };
    await transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO rate_cards (id, kitchen_id, effective_from, tier_rates_cents, station_surcharges_cents, cancellation_window_hours,
           pack_price_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (kitchen_id, effective_from) DO NOTHING`,
        [card.id, kitchen.id, effective, tiers, JSON.stringify(surcharges), card.cancellation_window_hours, card.pack_price_cents, now],
      );
      if (inserted.rowCount === 0) throw refuse.rateCardExists(effective);
      await audit(client, user.id, "rate_card", card.id, null, "added", now);
    });
    const inForce = await cardInForce(kitchen, now);
    return json(201, { rate_card: cardView(card, inForce.id) });
  }),
);

