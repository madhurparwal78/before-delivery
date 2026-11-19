export type StayStatus = 'booked' | 'in_house' | 'checked_out' | 'cancelled' | 'no_show';

const STAY_STATUSES: StayStatus[] = [
  'booked',
  'in_house',
  'checked_out',
  'cancelled',
  'no_show',
];

export function isStayStatus(value: unknown): value is StayStatus {
  return typeof value === 'string' && (STAY_STATUSES as string[]).includes(value);
}

export function mayCheckIn(status: StayStatus): boolean {
  return status === 'booked';
}

export function mayCheckOut(status: StayStatus): boolean {
  return status === 'in_house';
}

export function mayCancel(status: StayStatus): boolean {
  return status === 'booked';
}

export function mayChangeOrMove(status: StayStatus): boolean {
  return status === 'booked' || status === 'in_house';
}

export function awaitingOnlineCheckIn(status: StayStatus): boolean {
  return status === 'booked';
}
