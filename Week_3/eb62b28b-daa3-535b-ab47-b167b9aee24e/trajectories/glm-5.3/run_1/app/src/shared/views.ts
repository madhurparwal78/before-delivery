import type { Cadence, TimeZoneKey } from "./enums.js";

export type Address = {
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
};

export type MembershipView = {
  state: "free" | "pending" | "active" | "cancelled";
  cadence: Cadence | null;
  renewalDate: string | null;
  plusUntil: string | null;
  pendingCadence: Cadence | null;
  pendingFrom: string | null;
};

export type MemberSelfView = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  sex: "female" | "male" | null;
  state: string | null;
  timeZone: TimeZoneKey | null;
  address: Address | null;
  gateNotes: string | null;
  accountState: "active" | "closing" | "erasing" | "erased";
  erasesAt: string | null;
  membership: MembershipView;
};

export type StaffMemberView = MemberSelfView & { membership: MembershipView };

export type BillingMemberView = {
  id: string;
  name: string | null;
  email: string | null;
  accountState: "active" | "closing" | "erasing" | "erased";
  membership: MembershipView;
};

export type VisitPageView = {
  state: "live" | "ended" | "none";
  endsAt: string | null;
};

export type DrawView = {
  id: string;
  memberId: string;
  memberName?: string;
  phlebotomistId: string;
  phlebotomistName: string;
  state: "booked" | "collected" | "ready" | "released" | "cancelled";
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: TimeZoneKey;
  collectedAt: string | null;
  kitCodes: string[];
  hasResults: boolean;
  changesCloseAt: string | null;
  visitPage: VisitPageView;
};

export type MemberDrawView = Omit<DrawView, "memberName">;

export type ReceiptListItem = {
  id: string;
  number: string;
  memberName: string | null;
  paidAt: string;
  paidDate: string;
  amountCents: number;
  currency: string;
};

export type ReceiptView = ReceiptListItem & {
  invoiceId: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
  practice: { name: string; address: string; taxNumber: string };
};
