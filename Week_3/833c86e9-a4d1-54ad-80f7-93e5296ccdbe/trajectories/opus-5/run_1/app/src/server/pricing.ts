import { off, pctOf } from '../shared/money';
import { sumLines } from '../shared/lines';
import { PlanCode, PriceLine, QuoteNightRoom, QuoteRoom } from '../shared/types';
import { Inventory, NightRow, PropertyRow, RoomTypeRow, nightOf, stayDates } from './inventory';
import { diffDays } from './zone';

export interface RoomSelection {
  room_type: string;
  plan: PlanCode;
  breakfast: boolean;
  adults: number;
  ages: number[];
}

export interface StayContext {
  property: PropertyRow;
  inDate: string;
  outDate: string;
  nightsCount: number;
  daysAhead: number;
  tierPct: number;
}

export function planRate(night: NightRow, plan: PlanCode): number {
  return plan === 'refundable' ? night.base_rate_minor : off(night.base_rate_minor, 10);
}

/** The nightly price build, in the published order, rounding once per step. */
export function priceRoomNight(
  ctx: StayContext,
  rt: RoomTypeRow,
  night: NightRow,
  room: RoomSelection,
): QuoteNightRoom {
  const lines: PriceLine[] = [];
  const push = (key: PriceLine['key'], minor: number): void => {
    if (minor !== 0) lines.push({ key, minor });
  };
  const property = ctx.property;

  let x = planRate(night, room.plan);
  push('plan_rate', x);

  let prev = x;
  if (room.adults === 1 && rt.included_adults >= 2) x = off(x, property.single_pct);
  else x += Math.max(0, room.adults - rt.included_adults) * rt.extra_adult_minor;
  push('occupancy', x - prev);

  prev = x;
  for (const age of room.ages) {
    if (age >= 12) x += rt.extra_adult_minor;
    else if (age >= 3) x += rt.child_minor;
  }
  push('children', x - prev);

  prev = x;
  let losApplied = false;
  if (ctx.nightsCount >= 14) {
    x = off(x, 12);
    losApplied = true;
  } else if (ctx.nightsCount >= 7) {
    x = off(x, 8);
    losApplied = true;
  }
  push('length_of_stay', x - prev);

  if (room.plan === 'refundable') {
    if (ctx.daysAhead >= 60) {
      prev = x;
      x = off(x, 10);
      push('early_booking', x - prev);
    } else if (!losApplied && ctx.daysAhead <= 3) {
      prev = x;
      x = off(x, 15);
      push('last_minute', x - prev);
    }
  }

  prev = x;
  x = off(x, ctx.tierPct);
  push('loyalty', x - prev);

  const discounted = x;
  const personsEating = room.adults + room.ages.filter((age) => age >= 3).length;
  const breakfast = room.breakfast ? property.breakfast_minor * personsEating : 0;
  push('breakfast', breakfast);

  const taxable = discounted + breakfast;
  const vat = pctOf(taxable, property.vat_pct);
  push('vat', vat);
  const cityPersons = room.adults + room.ages.filter((age) => age >= 12).length;
  const cityTax = property.city_minor * cityPersons;
  push('city_tax', cityTax);
  const levy = pctOf(cityTax, property.levy_pct);
  push('tourism_levy', levy);

  const total = taxable + vat + cityTax + levy;
  lines.push({ key: 'night_total', minor: total });
  return { date: night.date, lines, total_minor: total, taxable_minor: taxable };
}

/** The discounted room amount of a night, the base for statements. */
export function discountedOf(night: QuoteNightRoom): number {
  const breakfast = night.lines.find((l) => l.key === 'breakfast')?.minor ?? 0;
  return night.taxable_minor - breakfast;
}

export interface PricedStay {
  rooms: QuoteRoom[];
  nights: { date: string; total_minor: number; taxable_minor: number; lines: PriceLine[] }[];
  total_minor: number;
  taxable_minor: number;
}

export function makeStayContext(
  property: PropertyRow,
  inDate: string,
  outDate: string,
  todayLocal: string,
  tierPct: number,
): StayContext {
  return {
    property,
    inDate,
    outDate,
    nightsCount: diffDays(inDate, outDate),
    daysAhead: diffDays(todayLocal, inDate),
    tierPct,
  };
}

export function priceStay(ctx: StayContext, inv: Inventory, rooms: RoomSelection[]): PricedStay {
  const dates = stayDates(ctx.inDate, ctx.outDate);
  const pricedRooms: QuoteRoom[] = [];
  for (const room of rooms) {
    const rt = inv.roomType.get(room.room_type);
    if (!rt) throw new Error(`unknown room type ${room.room_type}`);
    const nights: QuoteNightRoom[] = [];
    for (const date of dates) {
      const night = nightOf(inv, room.room_type, date);
      if (!night) throw new Error(`no night ${room.room_type} ${date}`);
      nights.push(priceRoomNight(ctx, rt, night, room));
    }
    pricedRooms.push({
      room_type: room.room_type,
      plan: room.plan,
      breakfast: room.breakfast,
      adults: room.adults,
      ages: room.ages,
      nights,
      total_minor: nights.reduce((sum, n) => sum + n.total_minor, 0),
    });
  }
  const nights = dates.map((date, index) => {
    const lines = sumLines(pricedRooms.map((room) => room.nights[index].lines));
    return {
      date,
      total_minor: pricedRooms.reduce((sum, room) => sum + room.nights[index].total_minor, 0),
      taxable_minor: pricedRooms.reduce((sum, room) => sum + room.nights[index].taxable_minor, 0),
      lines,
    };
  });
  return {
    rooms: pricedRooms,
    nights,
    total_minor: nights.reduce((sum, n) => sum + n.total_minor, 0),
    taxable_minor: nights.reduce((sum, n) => sum + n.taxable_minor, 0),
  };
}

export function hasDiscount(rooms: QuoteRoom[], nightIndex: number): boolean {
  for (const room of rooms) {
    if (room.plan === 'nonrefundable') return true;
    const night = room.nights[nightIndex];
    for (const line of night.lines) {
      if (
        line.minor < 0 &&
        (line.key === 'occupancy' ||
          line.key === 'length_of_stay' ||
          line.key === 'early_booking' ||
          line.key === 'last_minute' ||
          line.key === 'loyalty')
      ) {
        return true;
      }
    }
  }
  return false;
}
