import { PlainDate } from '../shared/dates';

export type Role = 'owner' | 'front_desk' | 'housekeeper';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  hotelId: string;
}

export interface Figures {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
  occupancy: string;
  averageDailyRate: string;
  revenuePerAvailableRoom: string;
}

export interface CloseRow {
  roomId: string;
  roomNumber: string;
  stayId: string;
  postedCents: number;
}

export interface CloseResult {
  businessDate: PlainDate;
  newBusinessDate: PlainDate;
  roomsCharged: number;
  noShows: number;
  figures: Figures;
  rows: CloseRow[];
}

export interface DeskSummary {
  hotel: { id: string; name: string; timeZone: string; businessDate: PlainDate };
  freeRoomsText: string;
  lastClose: CloseResult | null;
}

export interface TimelineRoom {
  id: string;
  number: string;
  type: string;
  status: string;
}

export interface TimelineBlock {
  stayId: string;
  roomId: string;
  firstNight: PlainDate;
  nights: number;
  status: string;
  guestName: string;
  checkedInOnline: boolean;
  version: number;
}

export interface Timeline {
  businessDate: PlainDate;
  dates: PlainDate[];
  rooms: TimelineRoom[];
  blocks: TimelineBlock[];
  stamps: Array<{ date: PlainDate; roomId: string; stamp: string }>;
}

export interface Night {
  date: PlainDate;
  roomNumber: string;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
  totalCents: number;
  posted: boolean;
}

export interface Entry {
  id: string;
  kind: 'charge' | 'payment';
  date: PlainDate;
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
  mailState: 'not_sent' | 'sent';
  billToName: string;
  payerEmail: string;
  pdfUrl: string;
}

export interface Folio {
  id: string;
  name: string;
  payerName: string;
  payerEmail: string;
  state: 'open' | 'closed';
  balanceCents: number;
  entries: Entry[];
  invoice: Invoice | null;
}

export interface Cancellation {
  state: 'free' | 'late';
  feeCents: number;
  text: string;
}

export interface Segment {
  roomId: string;
  roomNumber: string;
  firstNight: PlainDate;
  nights: number;
}

export interface Stay {
  id: string;
  version: number;
  status: 'booked' | 'in_house' | 'checked_out' | 'cancelled' | 'no_show';
  guest: { id: string; name: string; email: string; phone: string };
  ratePlanId: string;
  guests: number;
  arrival: PlainDate;
  departure: PlainDate;
  segments: Segment[];
  checkedInOnline: boolean;
  onlineCheckIn: { fullName: string; phone: string } | null;
  checkinLinkState: 'not_sent' | 'sent' | 'ended';
  checkInNight: PlainDate | null;
  idPhoto: 'none' | 'received';
  nightly: Night[];
  totalCents: number;
  cancellation: Cancellation | null;
  folios: Folio[];
}

export interface Quote {
  nightly: Night[];
  totalCents: number;
}

export interface RatePlan {
  id: string;
  name: string;
  weeknightCents: number;
  weekendCents: number;
}

export interface TaxRate {
  id: string;
  percent: string;
  startDate: PlainDate | null;
}

export interface BoardRoom {
  roomId: string;
  number: string;
  status: string;
  arrival: PlainDate | null;
  departure: PlainDate | null;
}

export interface Board {
  businessDate: PlainDate;
  rooms: BoardRoom[];
}

export interface Guest {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

export interface NightlyFigures extends Figures {
  date: PlainDate;
}

export interface Report extends Figures {
  from: PlainDate;
  to: PlainDate;
  nights: NightlyFigures[];
}

export interface CheckinPage {
  hotelName: string;
  arrival: PlainDate;
  departure: PlainDate;
  roomType: string;
  photo: 'none' | 'received';
}

export interface Blocker {
  roomId: string;
  roomNumber: string;
  text: string;
}
