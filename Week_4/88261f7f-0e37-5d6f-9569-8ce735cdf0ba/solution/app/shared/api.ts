import type { IsoDate } from "./dates";

export type Role = "owner" | "front_desk" | "housekeeper";
export type RoomStatus = "dirty" | "clean" | "inspected" | "out_of_order";
export type StayStatus = "booked" | "in_house" | "checked_out" | "cancelled" | "no_show";
export type LinkState = "not_sent" | "sent" | "ended";
type MailState = "not_sent" | "sent";
type EntryKind = "charge" | "payment";

export interface User { id: string; email: string; name: string; role: Role; hotelId: string }

export interface Entry {
  id: string;
  kind: EntryKind;
  date: IsoDate;
  description: string;
  amountCents: number;
  roomNumber: string | null;
  reversesEntryId: string | null;
  splitOfEntryId: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  state: "issued";
  mailState: MailState;
  billToName: string;
  payerEmail: string;
  pdfUrl: string;
}

export interface Folio {
  id: string;
  name: string;
  payerName: string;
  payerEmail: string;
  state: "open" | "closed";
  balanceCents: number;
  entries: Entry[];
  invoice: Invoice | null;
}

export interface Night {
  date: IsoDate;
  roomNumber: string;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
  totalCents: number;
  posted: boolean;
}

export interface Cancellation { state: "free" | "late"; feeCents: number; text: string }

export interface Segment { roomId: string; roomNumber: string; firstNight: IsoDate; nights: number }

export interface Stay {
  id: string;
  version: number;
  status: StayStatus;
  guest: { id: string; name: string; email: string; phone: string };
  ratePlanId: string;
  guests: number;
  arrival: IsoDate;
  departure: IsoDate;
  segments: Segment[];
  checkedInOnline: boolean;
  onlineCheckIn: { fullName: string; phone: string } | null;
  checkinLinkState: LinkState;
  checkInNight: IsoDate | null;
  idPhoto: "none" | "received";
  nightly: Night[];
  totalCents: number;
  cancellation: Cancellation | null;
  folios: Folio[];
}

export interface Quote { nightly: Night[]; totalCents: number }

export interface Hotel { id: string; name: string; timeZone: string; businessDate: IsoDate }

export interface ReportFigures {
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
  occupancy: string;
  averageDailyRate: string;
  revenuePerAvailableRoom: string;
}

export interface CloseRow { roomId: string; roomNumber: string; stayId: string; postedCents: number }

export interface CloseResult {
  businessDate: IsoDate;
  newBusinessDate: IsoDate;
  roomsCharged: number;
  noShows: number;
  figures: ReportFigures;
  rows: CloseRow[];
}

export interface DeskView { hotel: Hotel; freeRoomsText: string; lastClose: CloseResult | null }

export interface TimelineRoom { id: string; number: string; type: string; status: RoomStatus }

export interface TimelineBlock {
  stayId: string;
  roomId: string;
  firstNight: IsoDate;
  nights: number;
  status: StayStatus;
  guestName: string;
  checkedInOnline: boolean;
  version: number;
}

export interface Timeline {
  businessDate: IsoDate;
  dates: IsoDate[];
  rooms: TimelineRoom[];
  blocks: TimelineBlock[];
  stamps: { date: IsoDate; roomId: string; stamp: string }[];
}

export interface BoardRoom {
  roomId: string;
  number: string;
  status: RoomStatus;
  arrival: IsoDate | null;
  departure: IsoDate | null;
}

export interface Board { businessDate: IsoDate; rooms: BoardRoom[] }

export interface Report extends ReportFigures {
  from: IsoDate;
  to: IsoDate;
  nights: (ReportFigures & { date: IsoDate })[];
}

export interface RatePlan { id: string; name: string; weeknightCents: number; weekendCents: number }
export interface TaxRate { id: string; percent: string; startDate: IsoDate | null }

export interface Guest { id: string; name: string; email: string; phone: string; company: string; address: string }

export interface GuestDetail extends Guest { stayIds: string[]; folioIds: string[] }

export interface GuestPage {
  hotelName: string;
  arrival: IsoDate;
  departure: IsoDate;
  roomType: string;
  photo: "none" | "received";
}

type LiveType = "stay" | "room" | "close" | "checkin" | "merge" | "report";

export interface StaffLiveEvent {
  type: LiveType;
  notice: string | null;
  stayId?: string;
  roomId?: string;
  businessDate?: IsoDate;
}

export interface BoardLiveEvent {
  type: "room";
  roomId: string;
  number: string;
  status: RoomStatus;
  arrival: IsoDate | null;
  departure: IsoDate | null;
  notice: string | null;
}

export interface ApiFailure { error?: string; errors?: Record<string, string>; blockers?: { roomId: string; roomNumber: string; text: string }[] }
