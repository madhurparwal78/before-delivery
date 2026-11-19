export type Role = 'owner' | 'front_desk' | 'housekeeper';
export type RoomStatus = 'dirty' | 'clean' | 'inspected' | 'out_of_order';
export type StayStatus = 'booked' | 'in_house' | 'checked_out' | 'cancelled' | 'no_show';
export type EntryKind = 'charge' | 'payment';
export type FolioState = 'open' | 'closed';
export type InvoiceMailState = 'not_sent' | 'sent';
export type CheckinLinkState = 'not_sent' | 'sent' | 'ended';
export type ClosePhase = 'idle' | 'night' | 'stamping' | 'slide';

export interface Night {
  date: string;
  roomNumber: string;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
  totalCents: number;
  posted: boolean;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  date: string;
  description: string;
  amountCents: number;
  roomNumber: string | null;
  reversesEntryId: string | null;
  splitOfEntryId: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  state: 'issued';
  mailState: InvoiceMailState;
  billToName: string;
  payerEmail: string;
  pdfUrl: string;
}

export interface Folio {
  id: string;
  name: string;
  payerName: string;
  payerEmail: string;
  state: FolioState;
  balanceCents: number;
  entries: Entry[];
  invoice: Invoice | null;
}

export interface StaySegment {
  roomId: string;
  roomNumber: string;
  firstNight: string;
  nights: number;
}

export interface Cancellation {
  state: 'free' | 'late';
  feeCents: number;
  text: string;
}

export interface GuestRef {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Stay {
  id: string;
  version: number;
  status: StayStatus;
  guest: GuestRef;
  ratePlanId: string;
  guests: number;
  arrival: string;
  departure: string;
  segments: StaySegment[];
  checkedInOnline: boolean;
  onlineCheckIn: { fullName: string; phone: string } | null;
  checkinLinkState: CheckinLinkState;
  checkInNight: string | null;
  idPhoto: 'none' | 'received';
  nightly: Night[];
  totalCents: number;
  cancellation: Cancellation | null;
  folios: Folio[];
}

export interface CloseResultRow {
  roomId: string;
  roomNumber: string;
  stayId: string;
  postedCents: number;
}

export interface ReportFigures {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
  occupancy: string;
  averageDailyRate: string;
  revenuePerAvailableRoom: string;
}

export interface NightFigures extends ReportFigures {
  date: string;
}

export interface CloseResult {
  businessDate: string;
  newBusinessDate: string;
  roomsCharged: number;
  noShows: number;
  figures: ReportFigures;
  rows: CloseResultRow[];
}
