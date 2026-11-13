import {
  AttachmentRow,
  BlendRow,
  DrawRow,
  MemberRow,
  MembershipRow,
  MessageRow,
  PlanRow,
  ReceiptRow,
  VisitPageRow,
  listDrawKitCodes,
  latestVisitPage,
  listResults,
} from '../data';
import { changesCloseAt } from '../domain/draws';
import { copy } from '../shared/copy';
import { instantToIso } from '../shared/time';

export interface MembershipView {
  state: MembershipRow['state'];
  cadence: MembershipRow['cadence'];
  renewalDate: string | null;
  plusUntil: string | null;
  pendingCadence: MembershipRow['pending_cadence'];
  pendingFrom: string | null;
}

export function membershipView(membership: MembershipRow): MembershipView {
  return {
    state: membership.state,
    cadence: membership.cadence,
    renewalDate: membership.renewal_date,
    plusUntil: membership.plus_until,
    pendingCadence: membership.pending_cadence,
    pendingFrom: membership.pending_from,
  };
}

export interface MemberView {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  state: string | null;
  timeZone: string | null;
  address: { line1: string; line2: string; city: string; postalCode: string } | null;
  gateNotes: string | null;
  accountState: MemberRow['account_state'];
  erasesAt: string | null;
  membership: MembershipView;
}

export function memberView(member: MemberRow, membership: MembershipRow): MemberView {
  if (member.account_state === 'erased') {
    return {
      id: member.id,
      name: copy.erasedMember,
      email: null,
      phone: null,
      dateOfBirth: null,
      sex: null,
      state: null,
      timeZone: null,
      address: null,
      gateNotes: null,
      accountState: 'erased',
      erasesAt: null,
      membership: membershipView(membership),
    };
  }
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    dateOfBirth: member.date_of_birth,
    sex: member.sex,
    state: member.state,
    timeZone: member.time_zone,
    address: member.address_line1
      ? {
          line1: member.address_line1,
          line2: member.address_line2 ?? '',
          city: member.city ?? '',
          postalCode: member.postal_code ?? '',
        }
      : null,
    gateNotes: member.gate_notes,
    accountState: member.account_state,
    erasesAt: member.erases_at ? instantToIso(member.erases_at) : null,
    membership: membershipView(membership),
  };
}

export function billingMemberView(
  member: MemberRow,
  membership: MembershipRow,
): Pick<MemberView, 'id' | 'name' | 'email' | 'accountState' | 'membership'> {
  const full = memberView(member, membership);
  return {
    id: full.id,
    name: full.name,
    email: full.email,
    accountState: full.accountState,
    membership: full.membership,
  };
}

export interface DrawView {
  id: string;
  memberId: string;
  memberName?: string;
  phlebotomistId: string;
  phlebotomistName: string;
  state: DrawRow['state'];
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  collectedAt: string | null;
  kitCodes: string[];
  hasResults: boolean;
  changesCloseAt: string;
  visitPage: { state: 'live' | 'ended' | 'none'; endsAt: string | null };
}

export function visitPageState(
  page: VisitPageRow | null,
  now: Date,
): { state: 'live' | 'ended' | 'none'; endsAt: string | null } {
  if (!page) return { state: 'none', endsAt: null };
  const ended = page.ended_at !== null || page.ends_at.getTime() <= now.getTime();
  return { state: ended ? 'ended' : 'live', endsAt: instantToIso(page.ends_at) };
}

export async function drawView(
  draw: DrawRow,
  options: { memberName: string | null; phlebotomistName: string; now: Date },
): Promise<DrawView> {
  const kitCodes = await listDrawKitCodes(draw.id);
  const results = await listResults(draw.id);
  const page = await latestVisitPage(draw.id);
  const view: DrawView = {
    id: draw.id,
    memberId: draw.member_id,
    phlebotomistId: draw.phlebotomist_id,
    phlebotomistName: options.phlebotomistName,
    state: draw.state,
    startsAt: instantToIso(draw.starts_at),
    localDate: draw.local_date,
    localTime: draw.local_time,
    timeZone: draw.time_zone,
    collectedAt: draw.collected_at ? instantToIso(draw.collected_at) : null,
    kitCodes,
    hasResults: results.length > 0,
    changesCloseAt: instantToIso(changesCloseAt(draw.time_zone, draw.local_date)),
    visitPage: visitPageState(page, options.now),
  };
  if (options.memberName !== null) view.memberName = options.memberName;
  return view;
}

export interface BlendView {
  id?: string;
  memberId: string;
  items: { ingredient: string; capsulesPerDay: number; morning: number; evening: number }[];
  morningCapsules: number;
  eveningCapsules: number;
  listPriceCents: number;
  memberPriceCents: number;
  savedBy: string;
  savedAt: string;
}

export function blendView(blend: BlendRow): BlendView {
  return {
    id: blend.id,
    memberId: blend.member_id,
    items: blend.items,
    morningCapsules: blend.morning_capsules,
    eveningCapsules: blend.evening_capsules,
    listPriceCents: blend.list_price_cents,
    memberPriceCents: blend.member_price_cents,
    savedBy: blend.saved_by,
    savedAt: instantToIso(blend.saved_at),
  };
}

export interface PlanView {
  id: string;
  memberId: string;
  state: PlanRow['state'];
  basedOnPlanId: string | null;
  sections: { nutrition: string; movement: string; sleep: string; supplements: string };
  publishedAt: string | null;
  publishedBy: string | null;
  blend: BlendView | null;
  updatedAt: string;
}

export function planView(plan: PlanRow, blend: BlendRow | null): PlanView {
  return {
    id: plan.id,
    memberId: plan.member_id,
    state: plan.state,
    basedOnPlanId: plan.based_on_plan_id,
    sections: {
      nutrition: plan.nutrition,
      movement: plan.movement,
      sleep: plan.sleep,
      supplements: plan.supplements,
    },
    publishedAt: plan.published_at ? instantToIso(plan.published_at) : null,
    publishedBy: plan.published_by,
    blend: blend ? blendView(blend) : null,
    updatedAt: instantToIso(plan.updated_at),
  };
}

export interface MessageView {
  id: string;
  from: { role: string; name: string };
  body: string;
  attachment: { id: string; kind: string; bytes: number } | null;
  sentAt: string;
}

export function messageView(message: MessageRow, attachment: AttachmentRow | null): MessageView {
  return {
    id: message.id,
    from: { role: message.from_role, name: message.from_name },
    body: message.body,
    attachment: attachment
      ? { id: attachment.id, kind: attachment.kind, bytes: attachment.byte_size }
      : null,
    sentAt: instantToIso(message.sent_at),
  };
}

export const PRACTICE = {
  name: 'Ocotillo Longevity Club',
  address: '8820 E Desert Willow Way, Suite 140, Scottsdale, AZ 85258',
  taxNumber: '86-4172093',
};

export function receiptNumber(numberSeq: number): string {
  return `OLC-${String(numberSeq).padStart(6, '0')}`;
}

export interface ReceiptListItem {
  id: string;
  number: string;
  memberName: string;
  paidAt: string;
  paidDate: string;
  amountCents: number;
  currency: string;
}

export function receiptListItem(receipt: ReceiptRow, memberName: string | null): ReceiptListItem {
  return {
    id: receipt.id,
    number: receiptNumber(receipt.number_seq),
    memberName: memberName ?? copy.erasedMember,
    paidAt: instantToIso(receipt.paid_at),
    paidDate: receipt.paid_date,
    amountCents: receipt.amount_cents,
    currency: receipt.currency,
  };
}

export function receiptView(
  receipt: ReceiptRow,
  memberName: string | null,
): ReceiptListItem & {
  invoiceId: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
  practice: { name: string; address: string; taxNumber: string };
} {
  return {
    ...receiptListItem(receipt, memberName),
    invoiceId: receipt.invoice_id,
    items: receipt.items,
    practice: PRACTICE,
  };
}
