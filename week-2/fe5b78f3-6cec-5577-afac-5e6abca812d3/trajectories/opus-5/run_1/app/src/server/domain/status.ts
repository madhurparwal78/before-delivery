import type { BerthType } from './berths';
import type { WaitingList } from './schedule';

export type PassengerStatusKind =
  | 'CNF'
  | 'RAC'
  | WaitingList
  | 'NOSB'
  | 'CAN'
  | 'CHART_NOT_CONFIRMED';

export interface ConfirmedStatus {
  readonly status: 'CNF';
  readonly position: null;
  readonly coach: string;
  readonly berth: number;
  readonly berth_type: BerthType;
  readonly label: string;
}

export interface RacStatus {
  readonly status: 'RAC';
  readonly position: number;
  readonly coach: string;
  readonly berth: number;
  readonly berth_type: 'SL';
  readonly label: string;
}

export interface QueuedStatus {
  readonly status: WaitingList;
  readonly position: number;
  readonly coach: null;
  readonly berth: null;
  readonly berth_type: null;
  readonly label: string;
}

export interface SettledStatus {
  readonly status: 'NOSB' | 'CAN' | 'CHART_NOT_CONFIRMED';
  readonly position: null;
  readonly coach: null;
  readonly berth: null;
  readonly berth_type: null;
  readonly label: string;
}

export type PassengerStatus = ConfirmedStatus | RacStatus | QueuedStatus | SettledStatus;

export function isWaitingList(status: PassengerStatusKind): status is WaitingList {
  return status === 'GNWL' || status === 'RLWL' || status === 'PQWL' || status === 'TQWL';
}

/** CAN and CHART_NOT_CONFIRMED are final. */
export function isFinalStatus(status: PassengerStatusKind): boolean {
  return status === 'CAN' || status === 'CHART_NOT_CONFIRMED';
}

export function confirmed(coach: string, berth: number, berthType: BerthType): ConfirmedStatus {
  return {
    status: 'CNF',
    position: null,
    coach,
    berth,
    berth_type: berthType,
    label: `CNF ${coach} ${berth} ${berthType}`,
  };
}

export function racPlace(position: number, coach: string, berth: number): RacStatus {
  return {
    status: 'RAC',
    position,
    coach,
    berth,
    berth_type: 'SL',
    label: `RAC ${position} ${coach} ${berth} SL`,
  };
}

export function waitlisted(list: WaitingList, position: number): QueuedStatus {
  return {
    status: list,
    position,
    coach: null,
    berth: null,
    berth_type: null,
    label: `${list} ${position}`,
  };
}

export const NO_BERTH_CHILD: SettledStatus = {
  status: 'NOSB',
  position: null,
  coach: null,
  berth: null,
  berth_type: null,
  label: 'NOSB',
};

export const CANCELLED: SettledStatus = {
  status: 'CAN',
  position: null,
  coach: null,
  berth: null,
  berth_type: null,
  label: 'CAN',
};

export const CHART_NOT_CONFIRMED: SettledStatus = {
  status: 'CHART_NOT_CONFIRMED',
  position: null,
  coach: null,
  berth: null,
  berth_type: null,
  label: 'NOT CNF',
};

export type AcceptedStatus = 'CNF' | 'RAC' | 'WL';

/** Statuses rank CNF best, then RAC, then any waiting list. */
export function statusRank(status: PassengerStatusKind): number {
  if (status === 'CNF' || status === 'NOSB') return 0;
  if (status === 'RAC') return 1;
  return 2;
}

export function acceptRank(accept: AcceptedStatus): number {
  if (accept === 'CNF') return 0;
  return accept === 'RAC' ? 1 : 2;
}

export function acceptForStatus(status: PassengerStatusKind): AcceptedStatus {
  if (status === 'CNF' || status === 'NOSB') return 'CNF';
  return status === 'RAC' ? 'RAC' : 'WL';
}

export function isAcceptedStatus(value: unknown): value is AcceptedStatus {
  return value === 'CNF' || value === 'RAC' || value === 'WL';
}
