import type { ReportFigures } from "../../shared/api";
import { NO_FIGURE, divide, formatMoney, roundHalfUp } from "../../shared/money";

const PERCENT_TENTHS = 1000;
const TENTHS = 10;

/** Occupancy, average daily rate and revenue per available room as the strings every screen shows. */
export function figuresFor(roomsAvailable: number, roomsSold: number, roomRevenueCents: number): ReportFigures {
  const tenths = roomsAvailable === 0 ? 0 : roundHalfUp(roomsSold * PERCENT_TENTHS, roomsAvailable);
  const { quotient, remainder } = divide(tenths, TENTHS);
  return {
    roomsAvailable,
    roomsSold,
    roomRevenueCents,
    occupancy: roomsAvailable === 0 ? NO_FIGURE : `${quotient}.${remainder}%`,
    averageDailyRate: roomsSold === 0 ? NO_FIGURE : formatMoney(roundHalfUp(roomRevenueCents, roomsSold)),
    revenuePerAvailableRoom: roomsAvailable === 0 ? NO_FIGURE : formatMoney(roundHalfUp(roomRevenueCents, roomsAvailable)),
  };
}
