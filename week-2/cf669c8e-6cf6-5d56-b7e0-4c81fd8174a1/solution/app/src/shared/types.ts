/** The wire shapes of the API. The server decides every rule; the browser renders these. */
import type { PartDef, ScenePart } from './parts.js';

export type RegCountry = 'NL' | 'BE' | 'DE';
export type Country = 'NL' | 'BE' | 'DE' | 'LU';
export type RoadClass = 25 | 45;
export type Fulfilment = 'posted' | 'workshop';
export type Units = 'metric' | 'imperial';
export type PlateColour = 'blue' | 'yellow' | 'white';

export const REG_COUNTRIES: readonly RegCountry[] = ['NL', 'BE', 'DE'];
export const DELIVERY_COUNTRIES: readonly Country[] = ['NL', 'BE', 'DE', 'LU'];
export const ROAD_CLASSES: readonly RoadClass[] = [25, 45];
export const FULFILMENTS: readonly Fulfilment[] = ['posted', 'workshop'];
export const UNIT_SYSTEMS: readonly Units[] = ['metric', 'imperial'];
export const PLATE_COLOURS: readonly PlateColour[] = ['blue', 'yellow', 'white'];

interface PlateDonor { plate: string; country: RegCountry }
export interface ManualFrame {
  model: string;
  country: RegCountry;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  plateColour: PlateColour;
  registeredMassKg: number;
}
interface ManualDonor { manual: ManualFrame }
export type DonorInput = PlateDonor | ManualDonor;

export interface Config {
  donor: DonorInput;
  packId: string;
  hubId: string;
  roadClass: RoadClass;
  fulfilment: Fulfilment;
  country: Country;
  units?: Units;
}

export interface PlateRecord {
  plate: string;
  country: RegCountry;
  model: string;
  modelName: string;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  className: string;
  plateColour: PlateColour;
  registeredMassKg: string;
  revision: 'A' | 'B';
  confirmed: true;
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
export type VerdictCode = 'fits' | 'too_tight' | 'fouls' | 'outside_limits';
export type LimitRule = 'axle_split' | 'road_class_power' | 'donor_power' | 'registered_mass' | 'overall_dimensions';

export interface FitResult {
  verdict: VerdictCode;
  word: string;
  sentence: string;
  confirmed: boolean;
  revision: 'A' | 'B';
  rails: { pack: RailResult; hub: RailResult };
  axle: { donorFrontPct: string; builtFrontPct: string; shiftPct: string; passes: boolean };
  builtMassKg: string;
  rangeKm: number;
  limits: { rule: LimitRule; passes: boolean; sentence: string | null }[];
  parts: ScenePart[];
}

export interface Allocation { lineId: string; grossCents: number; vatCents: number; netCents: number }
export type StageStatus = 'scheduled' | 'pending' | 'paid' | 'failed' | 'overdue';
export type StageName = 'deposit' | 'instalment-1' | 'instalment-2' | 'instalment-3';
export interface Stage {
  stage: StageName;
  label: string;
  dueDate: string;
  amountCents: number;
  vatCents: number;
  vatCorrectedCents: number;
  status: StageStatus;
  attempts: number;
  confirmedAt: string | null;
  allocations: Allocation[];
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
export interface Quote {
  lines: Line[];
  totalCents: number;
  vatCents: number;
  vatRatePct: number;
  schedule: Stage[];
  notices: string[];
  fit: FitResult;
}

export type OrderState =
  | 'quoted' | 'deposit pending' | 'deposit confirmed' | 'instalments running' | 'in arrears'
  | 'paid in full' | 'kit dispatched' | 'fitted' | 'inspection passed' | 'withdrawn';
export interface Plan { name: string; street: string; postcode: string; city: string; note?: string }
export interface Draw {
  stage: StageName;
  killbillPaymentId: string | null;
  amountCents: number;
  vatCents: number;
  status: 'pending' | 'returned' | 'failed';
}
export interface Refund {
  id: string;
  lineId: string;
  amountCents: number;
  returnedCents: number;
  failedCents: number;
  vatCents: number;
  status: 'pending' | 'returned' | 'partly returned' | 'failed';
  draws: Draw[];
}
export interface Order {
  id: string;
  number: string;
  kind: 'kit' | 'bike';
  state: OrderState;
  partlyRefunded: boolean;
  planVersion: number;
  plan: Plan;
  donor: { plate: string; country: string; model: string; confirmed: boolean } | null;
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
  /** Set when the order belongs to a class move (the browser shows Record inspection only then). */
  classMove?: boolean;
}
export interface DeskPayment {
  stage: StageName;
  amountCents: number;
  status: StageStatus;
  killbillPaymentId: string | null;
  killbillTransactionId: string | null;
}
export type DeskOrder = Order & { payments: DeskPayment[]; riderName: string };

export type RideState = 'held' | 'confirmed' | 'ridden' | 'no-show' | 'expired' | 'cancelled';
export interface Ride {
  id: string;
  bikeId: string;
  slotId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  state: RideState;
  expiresAt: string | null;
  remainingSeconds: number;
  serverNow: string;
  freeCancellation: boolean;
  bikeName?: string;
  riderName?: string;
}
export interface Slot {
  id: string;
  bikeId: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  status: 'free' | 'held' | 'booked';
}
export interface Bike { id: string; name: string; roadClass: RoadClass; rangeKm: number; grossCents: number }

export interface User {
  id: string;
  email: string;
  name: string;
  country: Country;
  role: 'rider' | 'fitter';
  landing: '/orders' | '/desk';
}
export interface ProviderStatus { killbill: 'up' | 'down'; registry: 'up' | 'down'; serverNow: string }

export interface Catalogue {
  donors: {
    model: string; name: string; powerKw: string; wheelbaseMm: string; bayXMm: string;
    revisions: {
      revision: 'A' | 'B'; fromYear: number | null; toYear: number | null;
      stations: { id: string; name: string; travelMm: string; openWidthMm: string; openHeightMm: string }[];
    }[];
    hubRail: { mouthWidthMm: string; armWidthMm: string; sprocketLineMm: string };
  }[];
  packs: { id: string; widthMm: string; heightMm: string; wh: number; massKg: string; growth: string; grossCents: number }[];
  hubs: { id: string; widthMm: string; shaftMm: string; kw: string; massKg: string; grossCents: number }[];
  parts: PartDef[];
  roadClasses: { country: RegCountry; roadClass: RoadClass; name: string }[];
  fixedLines: { code: string; name: string; grossCents: number }[];
  inspectionFees: { code: string; upToAndIncluding: string; fromDate: string; before: number; after: number }[];
}
