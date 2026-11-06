import type { RenderableProps } from 'preact';
// Shared client types mirroring the server's API shapes.

export interface User {
  id: string;
  email: string;
  name: string;
  country: string;
  role: 'rider' | 'fitter';
  landing: '/orders' | '/desk';
}

export interface QuoteLine {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
}

export interface Quote {
  lines: QuoteLine[];
  totalCents: number;
  vatCents: number;
  vatRatePct: number;
  schedule: { stage: string; label: string; amountCents: number }[];
  notices: string[];
  fit: FitResult;
}

export interface RailStation {
  id: string;
  name: string;
  travelMm: number;
  gapMm: number | null;
  passes: boolean;
}

export interface RailResult {
  part: 'traction-pack' | 'hub-motor';
  railMm: number;
  stopTravelMm: number;
  foulingFeature: string | null;
  stations: RailStation[];
}

export interface FitResult {
  verdict: 'fits' | 'too_tight' | 'fouls' | 'outside_limits';
  word: string;
  sentence: string;
  confirmed: boolean;
  revision: 'A' | 'B';
  rails: { pack: RailResult; hub: RailResult };
  axle: { donorFrontPct: string; builtFrontPct: string; shiftPct: string; passes: boolean };
  builtMassKg: string;
  rangeKm: number;
  limits: { rule: string; passes: boolean; sentence: string | null }[];
  parts?: ScenePart[];
}

export interface ScenePart {
  id: string;
  name: string;
  position: [number, number, number];
  storyStage: number | null;
  axis: string | null;
  storyDistanceMm: number;
  fadedFor: string[];
  dimension: string;
}

export interface PlateLookup {
  plate: string;
  country: string;
  model: string;
  modelName: string;
  firstAdmissionYear: number;
  roadClass: 25 | 45;
  className: string;
  plateColour: string;
  registeredMassKg: number;
  revision: 'A' | 'B';
  confirmed: true;
}

export interface OrderLine extends QuoteLine {
  collectedCents: number;
  refundedCents: number;
}

export interface ApiStage {
  stage: string;
  label: string;
  dueDate: string | null;
  amountCents: number;
  vatCents: number;
  vatCorrectedCents: number;
  status: 'scheduled' | 'pending' | 'paid' | 'failed' | 'overdue';
  attempts: number;
  confirmedAt: string | null;
  allocations: { lineId: string; grossCents: number; vatCents: number; netCents: number }[];
}

export interface ApiRefund {
  id: string;
  lineId: string;
  amountCents: number;
  returnedCents: number;
  failedCents: number;
  vatCents: number;
  status: 'pending' | 'returned' | 'partly returned' | 'failed';
  draws: { stage: string; killbillPaymentId: string | null; amountCents: number; vatCents: number; status: string }[];
}

export interface Order {
  id: string;
  number: string;
  kind: 'kit' | 'bike';
  state: string;
  partlyRefunded: boolean;
  planVersion: number;
  plan: { name: string; street: string; postcode: string; city: string; note?: string };
  donor: { plate: string; country: string; model: string; confirmed: boolean; roadClass?: number } | null;
  config: { packId: string; hubId: string; roadClass: 25 | 45; fulfilment: 'posted' | 'workshop'; country: string } | null;
  lines: OrderLine[];
  totalCents: number;
  vatCents: number;
  notices: string[];
  schedule: ApiStage[];
  refunds: ApiRefund[];
  deliveredOn: string | null;
  withdrawalDeadline: string | null;
  withdrawalOpen: boolean;
}

export interface Ride {
  id: string;
  bikeId: string;
  slotId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  state: 'held' | 'confirmed' | 'ridden' | 'no-show' | 'expired' | 'cancelled';
  expiresAt: string;
  remainingSeconds: number;
  serverNow: string;
  freeCancellation: boolean;
  riderName?: string;
  bikeName?: string;
}

export interface Slot {
  id: string;
  bikeId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  status: 'free' | 'held' | 'booked';
}

export interface Bike {
  id: string;
  name: string;
  roadClass: 25 | 45;
  rangeKm: number;
  grossCents: number;
}

export interface Catalogue {
  donors: {
    id: string; name: string; powerKw: number; wheelbaseMm: number;
    revisions: { revision: string; stations: { id: string; name: string; travelMm: number; widthMm: number; heightMm: number }[] }[];
    hubStations: { id: string; name: string; travelMm: number }[];
  }[];
  packs: { id: string; widthMm: number; heightMm: number; wh: number; massKg: number; grossCents: number }[];
  hubs: { id: string; widthMm: number; shaftMm: number; kw: number; massKg: number; grossCents: number }[];
  parts: ScenePart[];
  roadClasses: { country: string; class: number; name: string }[];
  fixedLines: { code: string; name: string; grossCents: number }[];
  inspectionFees: { code: string; country: string; upTo: string; cents: number }[];
}

export function StatusWord({ word }: RenderableProps<{ word: string }>) {
  return <span class={`status-word ${word}`}>{word}</span>;
}
