export type ListingStatus = 'draft' | 'rendering' | 'live' | 'under_offer' | 'sold' | 'withdrawn';

export type OfferStatus = 'open' | 'needs_reread' | 'accepted' | 'declined' | 'lapsed' | 'closed_by_acceptance';

export type LinkStatus = 'active' | 'revoked' | 'expired';

export type LinkRole = 'buyer' | 'inspector';

export type AlertState = 'waiting' | 'delivered' | 'failed';

export type AlertKind = 'viewing_claim' | 'new_offer' | 'offer_lapsing';

export type Severity = 'cosmetic' | 'moderate' | 'serious';

export type Stance = 'repaired' | 'monitoring' | 'not_repaired';

export type Band = 'Thin' | 'Original' | 'Refinished' | 'Filler' | 'Not gauged' | 'No reading' | 'No baseline';

export type BlockerReason =
  | 'no_findings'
  | 'no_record_pull'
  | 'record_stale'
  | 'advisories_unanswered'
  | 'advisory_recurred';

export interface Standing {
  panelsRead: number;
  panelsGaugeable: number;
  findings: number;
  files: number;
  activeLinks: number;
  slotsHeld: number;
  slots: number;
  liveOffers: number;
  failedAlerts: number;
}

export interface CarDto {
  id: string;
  name: string;
  registration: string;
  askingPounds: number;
  viewingArea: string;
  homeAddress: string;
  story: string;
  listingStatus: ListingStatus;
  currentVersion: number | null;
  pulledAt: string | null;
  publishedOpenAdvisories: number;
  workingOpenAdvisories: number;
  publishBlockers: BlockerReason[];
  standing: Standing;
}

export interface OwnerReadingDto {
  microns: number;
  mils: string;
  band: Band;
  readAt: string;
}

export interface InspectorReadingDto {
  name?: string;
  microns: number;
  mils: string;
  band: Band;
  capturedAt: string;
  receivedAt: string;
}

export interface InspectorFindingDto {
  name?: string;
  u: number;
  v: number;
  wording: string;
  capturedAt: string;
  receivedAt: string;
}

export interface PanelDto {
  id: string;
  label: string;
  substrate: string;
  owner: OwnerReadingDto | null;
  inspector: InspectorReadingDto[];
  inspectorFindings: InspectorFindingDto[];
}

export interface PanelsResponse {
  panels: PanelDto[];
  medians: { steel: number | null; aluminium: number | null };
}

export interface FindingDto {
  id: string;
  revision: number;
  position: number;
  panelId: string;
  panelLabel: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: Severity;
  material: boolean;
  band: Band;
  photoId: string | null;
}

export interface UploadDto {
  id: string;
  kind: 'photo' | 'invoice';
  status: 'stored';
  fileName: string;
  sha256: string;
  bytes: number;
  contentType: string;
  derivativeSha256: string | null;
  locationRemoved: boolean;
  label: string | null;
}

export type OdometerFlag = null | 'unit_change' | 'drop' | 'no_odometer' | 'unreadable';

export interface TapeStepDto {
  motTestNumber: string;
  completedDate: string;
  testResult: string;
  status: 'read' | 'skipped';
  odometerValue: string | null;
  odometerUnit: string | null;
  normalisedKm: number | null;
  flag: OdometerFlag;
  defects: { type: string; text: string; dangerous: boolean }[];
}

export interface AdvisoryDto {
  id: string;
  motTestNumber: string;
  text: string;
  stance: Stance | null;
  note: string | null;
  answeredAt: string | null;
  recurred: boolean;
}

export interface RecordDto {
  pulledAt: string;
  firstUsedDate: string | null;
  tape: TapeStepDto[];
  advisories: AdvisoryDto[];
  openAdvisories: number;
}

export interface LinkDto {
  id: string;
  role: LinkRole;
  name: string;
  status: LinkStatus;
  expiresAt: string;
  secondsRemaining: number;
  seen: number;
  total: number;
  materialUnseen: number;
  lastSeenAt: string | null;
  offerStatus: OfferStatus | null;
}

export interface SlotDto {
  id: string;
  localStart: string;
  zone: 'GMT' | 'BST';
  startsAt: string;
  durationMinutes: number;
  label: string;
  held: boolean;
  heldByYou: boolean;
  holderName?: string | null;
}

export interface OfferDto {
  id: string;
  amountPounds: number;
  status: OfferStatus;
  stampedAt: string;
  lapsesAt: string;
  secondsRemaining: number;
}

export interface OwnerOfferDto extends OfferDto {
  linkId: string;
  buyerName: string;
  seen: number;
  total: number;
}

export interface AlertDto {
  id: string;
  carId: string;
  kind: AlertKind;
  state: AlertState;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
}

export interface LinkViewFindingDto extends Omit<FindingDto, 'revision'> {
  seen: boolean;
  seenAt: string | null;
  changedSinceSeen: boolean;
}

export interface LinkView {
  role: LinkRole;
  name: string;
  status: LinkStatus;
  expiresAt: string;
  serverNow: string;
  car: {
    name: string;
    maskedRegistration: string;
    askingPounds: number;
    viewingArea: string;
    story: string;
    listingStatus: ListingStatus;
    firstUsedDate: string | null;
  };
  version?: { number: number; publishedAt: string } | null;
  heroFindingId?: string | null;
  findings?: LinkViewFindingDto[];
  removedFindings?: { id: string; title: string; removedInVersion: number }[];
  progress?: { seen: number; total: number; materialUnseen: number };
  panels: PanelDto[];
  record?: RecordDto | null;
  versionsRead?: number[];
  slots?: SlotDto[];
  invoices?: { label: string }[];
  offer?: OfferDto | null;
}

export interface VersionDto {
  number: number;
  publishedAt: string;
  findings: FindingDto[];
  panels: PanelDto[];
  record: RecordDto | null;
}

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  reasons?: BlockerReason[];
  unseen?: string[];
  currentRevision?: number;
  retryAfterSeconds?: number;
}

export type CaptureItemState = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface CaptureReadingItem {
  clientId: string;
  kind: 'reading';
  panelId: string;
  microns: number;
  capturedAt: string;
}

export interface CaptureFindingItem {
  clientId: string;
  kind: 'finding';
  panelId: string;
  u: number;
  v: number;
  wording: string;
  capturedAt: string;
}

export type CaptureItem = CaptureReadingItem | CaptureFindingItem;

export interface CaptureResult {
  clientId: string;
  state: CaptureItemState;
  errors?: Record<string, string>;
}

export interface CaptureResponse {
  batchId: string;
  results: CaptureResult[];
}
