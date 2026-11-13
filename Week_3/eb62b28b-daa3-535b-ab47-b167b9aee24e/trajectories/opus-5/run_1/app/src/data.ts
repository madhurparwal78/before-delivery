import { query, queryOne } from './db';
import { Role } from './http/sessions';
import { TimeZoneId } from './shared/time';
import { Cadence } from './shared/money';

export interface MemberRow {
  id: string;
  name: string | null;
  email: string | null;
  password_hash: string | null;
  date_of_birth: string | null;
  sex: 'female' | 'male' | null;
  state: string;
  time_zone: TimeZoneId;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  gate_notes: string | null;
  account_state: 'active' | 'closing' | 'erasing' | 'erased';
  closing_at: Date | null;
  erases_at: Date | null;
  killbill_account_id: string | null;
  seq: string;
}

export interface MembershipRow {
  member_id: string;
  state: 'free' | 'pending' | 'active' | 'cancelled';
  cadence: Cadence | null;
  renewal_date: string | null;
  plus_until: string | null;
  pending_cadence: Cadence | null;
  pending_from: string | null;
  subscription_id: string | null;
  cancelled_before_closure: boolean;
}

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  removed_at: Date | null;
}

export interface PhlebotomistRow {
  id: string;
  name: string;
  email: string;
  states: string[];
  seq: number;
}

export interface DrawRow {
  id: string;
  member_id: string;
  phlebotomist_id: string;
  state: 'booked' | 'collected' | 'ready' | 'released' | 'cancelled';
  starts_at: Date;
  local_date: string;
  local_time: string;
  time_zone: TimeZoneId;
  collected_at: Date | null;
  booked_by_kind: 'staff' | 'member';
  booked_by_name: string;
  created_at: Date;
}

export interface ResultRow {
  id: string;
  draw_id: string;
  marker: string;
  value: string;
  note: string | null;
  corrected_by: string | null;
  corrected_at: Date | null;
  created_at: Date;
}

export interface VisitPageRow {
  id: string;
  draw_id: string;
  token: string;
  sent_at: Date;
  ends_at: Date;
  ended_at: Date | null;
}

export interface PlanRow {
  id: string;
  member_id: string;
  state: 'draft' | 'published';
  based_on_plan_id: string | null;
  nutrition: string;
  movement: string;
  sleep: string;
  supplements: string;
  published_at: Date | null;
  published_by: string | null;
  blend_id: string | null;
  updated_at: Date;
  created_at: Date;
}

export interface BlendRow {
  id: string;
  member_id: string;
  items: { ingredient: string; capsulesPerDay: number; morning: number; evening: number }[];
  morning_capsules: number;
  evening_capsules: number;
  list_price_cents: number;
  member_price_cents: number;
  saved_by: string;
  saved_at: Date;
}

export interface MessageRow {
  id: string;
  member_id: string;
  from_role: Role;
  from_name: string;
  body: string;
  attachment_id: string | null;
  sent_at: Date;
}

export interface AttachmentRow {
  id: string;
  member_id: string;
  kind: 'pdf' | 'jpeg' | 'png';
  byte_size: number;
  original_key: string;
  clean_key: string | null;
  created_at: Date;
}

export interface ReceiptRow {
  id: string;
  member_id: string;
  number_seq: number;
  invoice_id: string;
  paid_at: Date;
  paid_date: string;
  amount_cents: number;
  currency: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
  created_at: Date;
}

export interface RangeChangeRow {
  id: string;
  marker: string;
  effective_from: string;
  created_by: string;
  created_at: Date;
}

export interface RangeRowRecord {
  change_id: string;
  sex: 'female' | 'male';
  age_band: 'age18To39' | 'age40To59' | 'age60Plus';
  low: string;
  high: string;
  optimal_low: string;
  optimal_high: string;
}

export const findMember = (id: string): Promise<MemberRow | null> =>
  queryOne<MemberRow>('select * from members where id = $1', [id]);

export const findMembership = (memberId: string): Promise<MembershipRow | null> =>
  queryOne<MembershipRow>('select * from memberships where member_id = $1', [memberId]);

export const findStaff = (id: string): Promise<StaffRow | null> =>
  queryOne<StaffRow>('select * from staff where id = $1 and removed_at is null', [id]);

export const findPhlebotomist = (id: string): Promise<PhlebotomistRow | null> =>
  queryOne<PhlebotomistRow>('select * from phlebotomists where id = $1', [id]);

export const listPhlebotomists = (): Promise<PhlebotomistRow[]> =>
  query<PhlebotomistRow>('select * from phlebotomists order by seq');

export const findDraw = (id: string): Promise<DrawRow | null> =>
  queryOne<DrawRow>('select * from draws where id = $1', [id]);

export const listDrawKitCodes = async (drawId: string): Promise<string[]> => {
  const rows = await query<{ kit_code: string }>(
    'select kit_code from draw_kit_codes where draw_id = $1 order by added_at, kit_code',
    [drawId],
  );
  return rows.map((row) => row.kit_code);
};

export const liveVisitPage = (drawId: string): Promise<VisitPageRow | null> =>
  queryOne<VisitPageRow>(
    `select * from visit_pages where draw_id = $1 and ended_at is null
     order by sent_at desc limit 1`,
    [drawId],
  );

export const latestVisitPage = (drawId: string): Promise<VisitPageRow | null> =>
  queryOne<VisitPageRow>(
    'select * from visit_pages where draw_id = $1 order by sent_at desc limit 1',
    [drawId],
  );

export const listResults = (drawId: string): Promise<ResultRow[]> =>
  query<ResultRow>('select * from results where draw_id = $1', [drawId]);

export const findResult = (id: string): Promise<ResultRow | null> =>
  queryOne<ResultRow>('select * from results where id = $1', [id]);

export const findReport = (drawId: string): Promise<{
  draw_id: string;
  object_key: string;
  byte_size: number;
  digest: string;
  stored_at: Date;
} | null> =>
  queryOne('select * from reports where draw_id = $1', [drawId]);

export const findPlan = (id: string): Promise<PlanRow | null> =>
  queryOne<PlanRow>('select * from plans where id = $1', [id]);

export const latestPublishedPlan = (memberId: string): Promise<PlanRow | null> =>
  queryOne<PlanRow>(
    `select * from plans where member_id = $1 and state = 'published'
     order by published_at desc limit 1`,
    [memberId],
  );

export const currentBlend = (memberId: string): Promise<BlendRow | null> =>
  queryOne<BlendRow>(
    'select * from blends where member_id = $1 order by saved_at desc, id desc limit 1',
    [memberId],
  );

export const findBlend = (id: string): Promise<BlendRow | null> =>
  queryOne<BlendRow>('select * from blends where id = $1', [id]);

export const findAttachment = (id: string): Promise<AttachmentRow | null> =>
  queryOne<AttachmentRow>('select * from attachments where id = $1', [id]);

export const findReceipt = (id: string): Promise<ReceiptRow | null> =>
  queryOne<ReceiptRow>('select * from receipts where id = $1', [id]);
