// The shapes the API hands the client.

export interface LinkFinding {
  id: string;
  position: number;
  panelId: string;
  panelLabel: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: string;
  material: boolean;
  band: string;
  photoId: string | null;
  seen: boolean;
  seenAt: string | null;
  changedSinceSeen: boolean;
}

export interface LinkSlot {
  id: string;
  localStart: string;
  zone: string;
  startsAt: string;
  durationMinutes: number;
  label: string;
  held: boolean;
  heldByYou: boolean;
  holderName?: string | null;
}

interface LinkOffer {
  id: string;
  amountPounds: number;
  status: string;
  stampedAt: string;
  lapsesAt: string;
  secondsRemaining: number;
}

interface PanelReading {
  microns: number | null;
  mils: string | null;
  band: string;
  readAt: string | null;
}

export interface PanelView {
  id: string;
  label: string;
  substrate: string;
  owner: PanelReading;
  inspector: (PanelReading & { name?: string; capturedAt: string; receivedAt: string })[];
  inspectorFindings: { name?: string; u: number; v: number; wording: string; capturedAt: string }[];
}

interface TapeStep {
  motTestNumber: string;
  completedDate: string;
  testResult: string;
  status: string;
  odometerValue: string | null;
  odometerUnit: string | null;
  normalisedKm: number | null;
  flag: string | null;
  defects: { text: string; type: string; dangerous: boolean }[];
}

interface AdvisoryView {
  id: string;
  motTestNumber: string;
  text: string;
  stance: string | null;
  note: string | null;
  answeredAt: string | null;
  recurred: boolean;
}

export interface RecordView {
  pulledAt: string;
  firstUsedDate: string;
  tape: TapeStep[];
  advisories: AdvisoryView[];
  openAdvisories: number;
}

export interface LinkView {
  role: 'buyer' | 'inspector';
  name: string;
  status: string;
  expiresAt: string;
  serverNow: string;
  car: {
    name: string;
    maskedRegistration: string;
    askingPounds: number;
    viewingArea: string;
    story: string;
    listingStatus: string;
    firstUsedDate: string | null;
  };
  version?: { number: number; publishedAt: string };
  heroFindingId?: string | null;
  findings?: LinkFinding[];
  removedFindings?: { id: string; title: string; removedInVersion: number }[];
  progress?: { seen: number; total: number; materialUnseen: number };
  panels: PanelView[];
  record?: RecordView;
  versionsRead?: number[];
  slots?: LinkSlot[];
  invoices?: { label: string }[];
  offer?: LinkOffer | null;
}

/** A buyer link's view: the server sends every buyer field. */
export interface BuyerView extends LinkView {
  version: { number: number; publishedAt: string };
  heroFindingId: string | null;
  findings: LinkFinding[];
  removedFindings: { id: string; title: string; removedInVersion: number }[];
  progress: { seen: number; total: number; materialUnseen: number };
  record: RecordView;
  versionsRead: number[];
  slots: LinkSlot[];
  offer: LinkOffer | null;
}

interface CarStanding {
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

export interface CarView {
  id: string;
  name: string;
  registration: string;
  askingPounds: number;
  viewingArea: string;
  homeAddress: string;
  story: string;
  listingStatus: string;
  currentVersion: number | null;
  pulledAt: string | null;
  publishedOpenAdvisories: number;
  workingOpenAdvisories: number;
  publishBlockers: string[];
  standing: CarStanding;
}

export interface OwnerFinding {
  id: string;
  revision: number;
  position: number;
  panelId: string;
  panelLabel: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: string;
  material: boolean;
  band: string;
  photoId: string | null;
}

export interface UploadView {
  id: string;
  kind: string;
  status: string;
  fileName: string;
  sha256: string;
  bytes: number;
  contentType: string;
  derivativeSha256: string | null;
  locationRemoved: boolean;
  label: string | null;
}

export interface LinkRow {
  id: string;
  role: string;
  name: string;
  status: string;
  expiresAt: string;
  secondsRemaining: number;
  seen: number;
  total: number;
  materialUnseen: number;
  lastSeenAt: string | null;
  offerStatus: string | null;
  token?: string;
  path?: string;
}

export interface OwnerOffer extends LinkOffer {
  linkId: string;
  buyerName: string;
  seen: number;
  total: number;
}

export interface AlertRow {
  id: string;
  carId: string;
  kind: string;
  state: string;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
}
