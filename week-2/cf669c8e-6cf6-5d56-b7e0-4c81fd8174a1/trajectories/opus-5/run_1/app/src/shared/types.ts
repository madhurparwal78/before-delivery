/**
 * Domain vocabulary shared by server and browser.
 *
 * Lengths and masses crossing this boundary as numbers are integer tenths
 * (tenths of a millimetre, tenths of a kilogram). Money is integer cents.
 * Display strings are produced by the formatters in `format.ts`.
 */

export type RegCountry = 'NL' | 'BE' | 'DE';
export type DeliveryCountry = 'NL' | 'BE' | 'DE' | 'LU';
export type RoadClass = 25 | 45;
export type PlateColour = 'blue' | 'yellow' | 'white';
export type Fulfilment = 'posted' | 'workshop';
export type Units = 'metric' | 'imperial';
export type Revision = 'A' | 'B';
export type Verdict = 'fits' | 'too_tight' | 'fouls' | 'outside_limits';
export type RailName = 'pack' | 'hub';

export type LimitRule =
  | 'axle_split'
  | 'road_class_power'
  | 'donor_power'
  | 'registered_mass'
  | 'overall_dimensions';

export type StageName = 'deposit' | 'instalment-1' | 'instalment-2' | 'instalment-3';
export type StageStatus = 'scheduled' | 'pending' | 'paid' | 'failed' | 'overdue';
export type RefundStatus = 'pending' | 'returned' | 'partly returned' | 'failed';
export type DrawStatus = 'pending' | 'returned' | 'failed';

export type OrderState =
  | 'quoted'
  | 'deposit pending'
  | 'deposit confirmed'
  | 'instalments running'
  | 'in arrears'
  | 'paid in full'
  | 'kit dispatched'
  | 'fitted'
  | 'inspection passed'
  | 'withdrawn';

export type RideState = 'held' | 'confirmed' | 'ridden' | 'no-show' | 'expired' | 'cancelled';

export type Role = 'rider' | 'fitter';

/** A donor identified by plate (registry-confirmed) or entered by hand. */
export interface ManualDonorInput {
  model: string;
  country: RegCountry;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  plateColour: PlateColour;
  registeredMassKg: number | string;
}

export type DonorInput = { plate: string; country: RegCountry } | { manual: ManualDonorInput };

export interface Config {
  donor: DonorInput;
  packId: string;
  hubId: string;
  roadClass: RoadClass;
  fulfilment: Fulfilment;
  country: DeliveryCountry;
  units?: Units;
}

/** A donor resolved against the registry or hand entry, in integer tenths. */
export interface ResolvedDonor {
  plate: string | null;
  country: RegCountry;
  model: string;
  modelName: string;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  className: string;
  plateColour: PlateColour;
  registeredMassTenthsKg: number;
  revision: Revision;
  confirmed: boolean;
}

export interface StationResult {
  id: string;
  name: string;
  travelMm: string;
  gapMm: string | null;
  passes: boolean;
}

export interface RailResult {
  railMm: string;
  stopTravelMm: string;
  foulingFeature: string | null;
  stations: StationResult[];
}

export interface AxleResult {
  donorFrontPct: string;
  builtFrontPct: string;
  shiftPct: string;
  passes: boolean;
}

export interface LimitResult {
  rule: LimitRule;
  passes: boolean;
  sentence: string | null;
}

export interface FitResult {
  verdict: Verdict;
  word: string;
  sentence: string;
  confirmed: boolean;
  revision: Revision;
  rails: { pack: RailResult; hub: RailResult };
  axle: AxleResult;
  builtMassKg: string;
  rangeKm: number;
  limits: LimitResult[];
}

export interface Line {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
  collectedCents: number;
  refundedCents: number;
}

export interface Allocation {
  lineId: string;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

export interface Stage {
  stage: StageName;
  label: string;
  dueDate: string | null;
  amountCents: number;
  vatCents: number;
  vatCorrectedCents: number;
  status: StageStatus;
  attempts: number;
  confirmedAt: string | null;
  allocations: Allocation[];
}

export interface Draw {
  stage: StageName;
  killbillPaymentId: string | null;
  amountCents: number;
  vatCents: number;
  status: DrawStatus;
}

export interface Refund {
  id: string;
  lineId: string;
  amountCents: number;
  returnedCents: number;
  failedCents: number;
  vatCents: number;
  status: RefundStatus;
  draws: Draw[];
}

export interface Quote {
  lines: Line[];
  totalCents: number;
  vatCents: number;
  vatRatePct: number;
  schedule: Stage[];
  notices: string[];
  fit: FitResult | null;
}

export interface OrderDonorView {
  plate: string | null;
  country: RegCountry;
  model: string;
  confirmed: boolean;
}

export interface PlanInput {
  name: string;
  street: string;
  postcode: string;
  city: string;
  note?: string | null;
}

export interface Order {
  id: string;
  number: string;
  kind: 'kit' | 'bike';
  state: OrderState;
  partlyRefunded: boolean;
  planVersion: number;
  plan: PlanInput;
  donor: OrderDonorView | null;
  config: Config | null;
  lines: Line[];
  totalCents: number;
  vatCents: number;
  notices: string[];
  schedule: Stage[];
  refunds: Refund[];
  deliveredOn: string | null;
  withdrawalDeadline: string | null;
  withdrawalOpen: boolean;
}

export interface DeskPayment {
  stage: StageName;
  amountCents: number;
  status: string;
  killbillPaymentId: string | null;
  killbillTransactionId: string | null;
}

export interface Ride {
  id: string;
  bikeId: string;
  slotId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  state: RideState;
  expiresAt: string | null;
  remainingSeconds: number | null;
  serverNow: string;
  freeCancellation: boolean;
}

export interface DeskRide extends Ride {
  riderName: string;
  bikeName: string;
}

export interface Slot {
  id: string;
  bikeId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  status: 'free' | 'held' | 'booked';
}

export interface BikeView {
  id: string;
  name: string;
  roadClass: RoadClass;
  rangeKm: number;
  grossCents: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  country: DeliveryCountry;
  role: Role;
  landing: '/orders' | '/desk';
}

export interface ProviderStatus {
  killbill: 'up' | 'down';
  registry: 'up' | 'down';
  serverNow: string;
}

export interface PlateLookupResult {
  plate: string;
  country: RegCountry;
  model: string;
  modelName: string;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  className: string;
  plateColour: PlateColour;
  registeredMassKg: string;
  revision: Revision;
  confirmed: true;
}
