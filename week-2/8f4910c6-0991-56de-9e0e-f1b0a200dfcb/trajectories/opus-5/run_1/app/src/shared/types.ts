/** API shapes shared by the server and the browser app. */

export type OfficeId = 'toronto' | 'vancouver';
export type Board = 'women' | 'men' | 'creators' | 'new_faces';
export type Role = 'agency_director' | 'booker' | 'accounts_lead' | 'scout' | 'talent';
export type TalentState = 'active' | 'withdrawn' | 'erased';
export type OptionState = 'placed' | 'challenged' | 'confirmed' | 'released' | 'expired';
export type DayState = 'open' | 'held' | 'booked';
export type Media = 'digital' | 'print' | 'out_of_home' | 'broadcast';
export type Territory = 'canada' | 'north_america' | 'worldwide';
export type DayType = 'full_day' | 'half_day';
export type BookingState = 'confirmed' | 'invoiced' | 'corrected';
export type LicenceStatus = 'active' | 'expiring' | 'expired';
export type LineKind = 'day_rate' | 'half_day_rate' | 'overtime' | 'usage' | 'service_fee' | 'tax';
export type MovementKind = 'booking' | 'advance' | 'reversal';
export type PackageState = 'active' | 'revoked';
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'awaiting_guardian'
  | 'approved'
  | 'declined'
  | 'signed';
export type PhotoSlot = 'front' | 'profile' | 'full_length' | 'smile';

export const BOARDS: Board[] = ['women', 'men', 'creators', 'new_faces'];
export const OFFICES: OfficeId[] = ['toronto', 'vancouver'];
export const MEDIA_VALUES: Media[] = ['digital', 'print', 'out_of_home', 'broadcast'];
export const TERRITORY_VALUES: Territory[] = ['canada', 'north_america', 'worldwide'];
export const TERM_MONTH_VALUES = [3, 6, 12];
export const PHOTO_SLOTS: PhotoSlot[] = ['front', 'profile', 'full_length', 'smile'];

export type Measurements = {
  heightCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
};

export type Reach = {
  instagram: number;
  tiktok: number;
  youtube: number;
  total: number;
};

export type PublicCard = {
  slug: string;
  displayName: string;
  office: OfficeId;
  board: Board;
  measurements: Measurements;
  reach: Reach;
  coverPhotoUrl: string | null;
};

export type PortfolioPhoto = {
  photoId: string;
  url: string;
  width: number;
  height: number;
};

export type PublicProfile = PublicCard & { portfolio: PortfolioPhoto[] };

export type PackageDecision = 'shortlisted' | 'passed' | 'undecided';

export type PackageViewTalent = PublicProfile & { decision: PackageDecision };

export type PackageView = {
  title: string;
  expiresAt: string;
  shortlistedCount: number;
  talent: PackageViewTalent[];
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  office: OfficeId;
  talentId: string | null;
};

export type TalentRecord = {
  id: string;
  slug: string;
  displayName: string;
  state: TalentState;
  office: OfficeId;
  board: Board;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  homeAddress: string | null;
  guardian: { name: string | null; email: string | null; phone: string | null } | null;
  measurements: Measurements;
  reach: Reach;
  officeNote?: string | null;
  portfolio: PortfolioPhoto[];
  version: number;
  portfolioVersion: number;
};

export type OptionRecord = {
  id: string;
  talentId: string;
  clientId: string;
  clientCompany: string;
  date: string;
  jobTitle: string;
  note: string | null;
  rank: number | null;
  state: OptionState;
  autoReleaseAt: string;
  holdUntil: string | null;
  holdUntilLocal: string | null;
  releaseAt: string;
  challengeDeadline: string | null;
  placedBy: { id: string; name: string };
  placedAt: string;
  releasedAt: string | null;
  releaseReason: 'manual' | 'challenge_timeout' | 'day_booked' | 'hold_expired' | 'auto_release' | null;
  version: number;
};

export type LadderDay = {
  date: string;
  dayState: DayState;
  options: OptionRecord[];
  bookingId: string | null;
};

export type Ladder = {
  talentId: string;
  office: OfficeId;
  days: LadderDay[];
};

export type BookingLine = {
  kind: LineKind;
  label: string;
  talentId: string | null;
  amountCents: number;
};

export type BookingTalent = {
  talentId: string;
  displayName: string;
  talentFeesCents: number;
  serviceFeeShareCents: number;
};

export type Booking = {
  id: string;
  reference: string;
  state: BookingState;
  date: string;
  office: OfficeId;
  clientId: string;
  clientCompany: string;
  jobTitle: string;
  rateCard: { id: string; name: string; effectiveFrom: string };
  talent: BookingTalent[];
  lines: BookingLine[];
  talentFeesCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
  killbillInvoiceId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  issuedBy: string | null;
  issuedAt: string | null;
};

export type RateCardBoardRates = {
  fullDayCents: number;
  halfDayCents: number;
  overtimeQuarterHourCents: number;
};

export type RateCard = {
  id: string;
  name: string;
  effectiveFrom: string;
  boards: Record<Board, RateCardBoardRates>;
  usageBaseCents: Record<Media, number>;
};

export type Licence = {
  id: string;
  clientId: string;
  clientCompany: string;
  clientTimeZone: string;
  talentId: string;
  talentDisplayName: string;
  media: Media;
  territory: Territory;
  firstUseDate: string;
  termMonths: number;
  endsOn: string;
  endsAt: string;
  status: LicenceStatus;
  monthlyFeeCents: number;
  version: number;
  lastExtension: {
    id: string;
    months: number;
    amountCents: number;
    killbillInvoiceId: string | null;
    extendedBy: string;
    extendedAt: string;
  } | null;
};

export type LedgerEntry = { account: string; amountCents: number };

export type Movement = {
  id: string;
  kind: MovementKind;
  reference: string;
  talentId: string | null;
  bookingId: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
  createdBy: string;
  createdAt: string;
  officeDate: string;
  entries: LedgerEntry[];
};

export type StatementLine = {
  movementId: string;
  officeDate: string;
  kind: MovementKind;
  reference: string;
  client: string;
  description: string;
  amountCents: number;
  balanceCents: number;
};

export type Statement = {
  talentId: string;
  displayName: string;
  month: string;
  openingBalanceCents: number;
  lines: StatementLine[];
  totals: {
    earningsCents: number;
    advancesCents: number;
    reversalsCents: number;
    netCents: number;
  };
  closingBalanceCents: number;
  advances: Array<{
    movementId: string;
    amountCents: number;
    recoupedCents: number;
    outstandingCents: number;
  }>;
};

export type PackageRecord = {
  id: string;
  title: string;
  recipientName: string;
  recipientEmail: string;
  state: PackageState;
  url: string;
  issuedAt: string;
  expiresAt: string;
  talent: Array<{ talentId: string; displayName: string; decision: PackageDecision }>;
};

export type ApplicationDraft = {
  id: string;
  status: ApplicationStatus;
  office: OfficeId;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  dateOfBirth: string | null;
  height: { value: number; unit: 'cm' } | null;
  instagramFollowers: number | null;
  bio: string | null;
  guardianName: string | null;
  guardianEmail: string | null;
  minor: boolean;
  photos: PhotoSlot[];
};

export type ApplicationReview = {
  id: string;
  status: ApplicationStatus;
  office: OfficeId;
  applicantName: string;
  firstName: string;
  email: string | null;
  dateOfBirth: string | null;
  minor: boolean;
  heightCm: number | null;
  instagramFollowers: number;
  bio: string | null;
  guardianName: string | null;
  guardianEmail: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  photos: Array<{ slot: PhotoSlot; url: string }>;
  talentId: string | null;
};

export type ImportReportRow = {
  row: number;
  outcome: 'created' | 'merged' | 'unchanged' | 'orphan';
  talentId: string | null;
  reason: string | null;
  filled: string[];
};

export type ImportReport = {
  counts: { created: number; merged: number; unchanged: number; orphan: number };
  rows: ImportReportRow[];
};

export type ClientRecord = {
  id: string;
  slug: string;
  company: string;
  contactName: string;
  contactEmail: string;
  timeZone: string;
};

export type OfficeRecord = {
  id: OfficeId;
  city: string;
  timeZone: string;
  closures: string[];
};

export type ApiErrorBody = {
  error: string;
  errors?: Record<string, string>;
  [key: string]: unknown;
};
