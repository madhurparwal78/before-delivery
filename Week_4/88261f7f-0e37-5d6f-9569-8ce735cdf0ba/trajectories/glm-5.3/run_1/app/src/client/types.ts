export type Role = 'owner' | 'front_desk' | 'housekeeper';
export type RoomStatus = 'dirty' | 'clean' | 'inspected' | 'out_of_order';
export type StayStatus = 'booked' | 'in_house' | 'checked_out' | 'cancelled' | 'no_show';

export interface SessionUser { id: string; email: string; name: string; role: Role; hotelId: string }

export interface Night {
  date: string; roomNumber: string; roomCents: number; taxCents: number;
  cityTaxCents: number; totalCents: number; posted: boolean;
}
export interface Entry {
  id: string; kind: 'charge' | 'payment'; date: string; description: string;
  amountCents: number; roomNumber: string | null; reversesEntryId: string | null; splitOfEntryId: string | null;
}
export interface Invoice {
  id: string; number: string; state: string; mailState: 'not_sent' | 'sent';
  billToName: string; payerEmail: string; pdfUrl: string;
}
export interface Folio {
  id: string; name: string; payerName: string; payerEmail: string;
  state: 'open' | 'closed'; balanceCents: number; entries: Entry[]; invoice: Invoice | null;
}
export interface Cancellation { state: 'free' | 'late'; feeCents: number; text: string }
export interface Stay {
  id: string; version: number; status: StayStatus;
  guest: { id: string; name: string; email: string; phone: string };
  ratePlanId: string; guests: number; arrival: string; departure: string;
  segments: Array<{ roomId: string; roomNumber: string; firstNight: string; nights: number }>;
  checkedInOnline: boolean;
  onlineCheckIn: { fullName: string; phone: string } | null;
  checkinLinkState: 'not_sent' | 'sent' | 'ended';
  checkInNight: string | null;
  idPhoto: 'none' | 'received';
  nightly: Night[]; totalCents: number;
  cancellation: Cancellation | null;
  folios: Folio[];
}
export interface TimelineRoom { id: string; number: string; type: string; status: RoomStatus }
export interface TimelineBlock {
  stayId: string; roomId: string; firstNight: string; nights: number;
  status: StayStatus; guestName: string; checkedInOnline: boolean; version: number;
}
export interface TimelineData {
  businessDate: string; dates: string[]; rooms: TimelineRoom[];
  blocks: TimelineBlock[]; stamps: Array<{ roomId: string; date: string; stamp: string | null }>;
}
export interface DeskData {
  hotel: { id: string; name: string; timeZone: string; businessDate: string };
  freeRoomsText: string;
  lastClose: { businessDate: string } | null;
}
export interface RatePlan { id: string; name: string; weeknightCents: number; weekendCents: number }
export interface TaxRate { id: string; percent: string; startDate: string | null }
export interface GuestRecord { id: string; name: string; email: string; phone: string; company: string; address: string; stayIds?: string[]; folioIds?: string[] }
export interface BoardRoom { roomId: string; number: string; status: RoomStatus; arrival: string | null; departure: string | null }
export interface ReportFigures {
  roomsAvailable: number; roomsSold: number; roomRevenueCents: number;
  occupancy: string; averageDailyRate: string; revenuePerAvailableRoom: string;
}
export interface ReportData extends ReportFigures {
  from: string; to: string;
  nights: Array<ReportFigures & { date: string }>;
}
export interface CloseResult {
  businessDate: string; newBusinessDate: string; roomsCharged: number; noShows: number;
  figures: ReportFigures;
  rows: Array<{ roomId: string; roomNumber: string; stayId: string; postedCents: number }>;
  blockers?: Array<{ roomId: string; roomNumber: string; text: string }>;
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-$' : '$'}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const dt = new Date(date + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
