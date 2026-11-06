// Shared hour-price definition: the same pure function prices the browser's
// draft ticket and the server's booking. Both halves of the app import this.

export type PriceSettings = { hourWeight: number; offPeakPercent: number };

export type SlotWall = { date: string; minutes: number };

// offPeakWall decides whether a slot whose wall-clock start is `wall` is
// off-peak (>= 22:00 or < 06:00 kitchen local).
export const offPeakWall = (wall: SlotWall): boolean => wall.minutes >= 22 * 60 || wall.minutes < 6 * 60;

// priceSlots prices a booking from its real elapsed 15-minute slots. Each slot
// carries the kitchen wall-clock start of the slot and the fraction of the
// 15-minute unit it covers, so the browser can compute the same total from the
// slots the server would use.
export const priceSlots = (
  slots: readonly { wallStart: SlotWall; fraction: number }[],
  settings: PriceSettings,
): number => {
  const peak = 15 * settings.hourWeight;
  const offPeak = (15 * settings.hourWeight * settings.offPeakPercent) / 100;
  let total = 0;
  for (const slot of slots) {
    const unit = offPeakWall(slot.wallStart) ? offPeak : peak;
    total += unit * slot.fraction;
  }
  return Math.ceil(total);
};

export const hoursDisplay = (minutes: number): string => {
  const rounded = Math.round((minutes / 60) * 100) / 100;
  return rounded.toFixed(2);
};

export const minutesToHHMM = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
