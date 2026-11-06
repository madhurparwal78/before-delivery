import { POSITION_WORD } from '../domain/berths';
import type { PassengerStatus } from '../domain/status';

/** The spoken form of a status, used in announcements and in status-moved mail. */
export function spokenStatus(status: PassengerStatus): string {
  switch (status.status) {
    case 'CNF':
      return `CNF, ${status.coach} berth ${status.berth}, ${POSITION_WORD[status.berth_type]}`;
    case 'RAC':
      return `RAC ${status.position}`;
    case 'CAN':
      return 'cancelled';
    case 'CHART_NOT_CONFIRMED':
      return 'not confirmed, refund pending';
    case 'NOSB':
      return 'NOSB';
    default:
      return `${status.status} ${status.position}`;
  }
}

export function announcementLine(
  passengerNumber: number,
  from: PassengerStatus,
  to: PassengerStatus,
): string {
  return `Passenger ${passengerNumber}: ${spokenStatus(from)} to ${spokenStatus(to)}`;
}
