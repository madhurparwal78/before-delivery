import type { FinishId, HubId, ModelId } from './catalogue.js';

export type LockState =
  | 'requested'
  | 'locked'
  | 'refused'
  | 'released'
  | 'expired'
  | 'delivery_set'
  | 'delivered'
  | 'withdrawn';

export interface Lock {
  id: string;
  state: LockState;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  ref: string;
  issuedAt: string;
  expiresAt: string | null;
  expiresLabel: string | null;
  hoursLeft: number;
  exShowroomPaise: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
  stepEffectiveFrom: string;
  deliveryDate: string | null;
  sheetReady: boolean;
  waitingFor: string | null;
  waitPosition: number | null;
}

export type RideState = 'booked' | 'cancelled' | 'ridden' | 'no_show';

export interface Ride {
  id: string;
  state: RideState;
  hub: HubId;
  model: ModelId;
  startsAt: string;
  label: string;
  dayLabel: string;
  cutOffAt: string;
  movedFrom: string | null;
}

export interface User {
  id: string;
  role: 'rider' | 'hub_host';
  name: string;
  mobile: string;
  hub: HubId | null;
  licenceNumber: string | null;
  licenceValidUntil: string | null;
  remindersOn: boolean;
}

export interface Quote {
  stepEffectiveFrom: string;
  exFactoryPaise: number;
  gstPercent: number;
  gstPaise: number;
  exShowroomPaise: number;
  roadTaxPercent: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
}

export interface LiveReading {
  seq: number;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  serverNow: string;
  stale: boolean;
  staleReason: 'system' | 'count' | null;
  stockAsOf: string;
  stockAsOfLabel: string;
  unitsLeft: number;
  finishes: { finish: FinishId; unitsLeft: number }[];
  quote: Quote;
  nextSlot: { startsAt: string; label: string } | null;
  lockPreview: { expiresAt: string; expiresLabel: string };
  lock: Lock | null;
  hoursLeft: number;
}

export interface SlotView {
  startsAt: string;
  label: string;
  state: 'free' | 'taken' | 'past_cut_off';
}

export interface DeliveryDayView {
  date: string;
  dayLabel: string;
  capacity: number;
  placesLeft: number;
  state: 'open' | 'full' | 'closed';
}

export type DaySheetAction = 'ridden' | 'no_show' | 'delivered';

export interface DaySheetRow {
  kind: 'ride' | 'handover';
  id: string;
  label: string;
  riderName: string;
  model: ModelId;
  finish: FinishId | null;
  licenceLast4: string | null;
  state: 'booked' | 'ridden' | 'no_show' | 'delivery_set' | 'delivered';
  actions: DaySheetAction[];
}

export interface HeldUnitRow {
  id: string;
  riderName: string;
  model: ModelId;
  finish: FinishId;
  state: 'requested' | 'locked' | 'delivery_set';
  expiresLabel: string | null;
  deliveryDate: string | null;
  waitingFor: string | null;
  actions: ('confirm' | 'refuse' | 'withdraw')[];
}

export interface StockRow {
  model: ModelId;
  finish: FinishId;
  onHand: number;
  held: number;
  unitsLeft: number;
}

export interface Notice {
  id: string;
  kind: 'lock_ending' | 'ride_reminder' | 'delivery_place';
  state: 'pending' | 'sent' | 'cancelled';
  dueAt: string;
  sentAt: string | null;
  lockId: string | null;
  rideId: string | null;
}
