import { wallClock } from "./kitchenTime.js";
import { priceSlots, type SlotWall, type PriceSettings } from "../shared/hourPrice.js";

// The single hour-price definition on the server. A booking is priced over its
// real elapsed 15-minute slots; see shared/hourPrice.ts for the arithmetic.
export const priceBooking = (start: Date, end: Date, settings: PriceSettings): number => {
  const slots: { wallStart: SlotWall; fraction: number }[] = [];
  let cursor = start.getTime();
  const finish = end.getTime();
  while (cursor < finish) {
    const slotEnd = Math.min(cursor + 900000, finish);
    const wall = wallClock(new Date(cursor));
    slots.push({ wallStart: { date: wall.date, minutes: wall.minutes }, fraction: (slotEnd - cursor) / 900000 });
    cursor = slotEnd;
  }
  return priceSlots(slots, settings);
};
