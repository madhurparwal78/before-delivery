import { divideRoundHalfUp, formatMoney } from '../../shared/money';
import { NO_FIGURE } from '../../shared/figures';

export interface Figures {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
  occupancy: string;
  averageDailyRate: string;
  revenuePerAvailableRoom: string;
}

function formatPercentOneDecimal(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export function figuresFrom(
  roomsAvailable: number,
  roomsSold: number,
  roomRevenueCents: number,
): Figures {
  return {
    roomsAvailable,
    roomsSold,
    roomRevenueCents,
    occupancy:
      roomsAvailable === 0 ? NO_FIGURE : formatPercentOneDecimal(divideRoundHalfUp(roomsSold * 1000, roomsAvailable)),
    averageDailyRate:
      roomsSold === 0 ? NO_FIGURE : formatMoney(divideRoundHalfUp(roomRevenueCents, roomsSold)),
    revenuePerAvailableRoom:
      roomsAvailable === 0 ? NO_FIGURE : formatMoney(divideRoundHalfUp(roomRevenueCents, roomsAvailable)),
  };
}
