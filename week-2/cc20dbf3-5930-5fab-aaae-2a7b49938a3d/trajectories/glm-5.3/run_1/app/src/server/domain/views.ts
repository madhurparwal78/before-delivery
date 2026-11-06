import { PoolClient } from "pg";
import { nextOpenDay, LibraryCalendar } from "../calendar";
import { formatIso } from "../time";
import { BusySpanRecord } from "./spans";
import { SessionUser, Role } from "../http";

export interface SpanView {
  start_date: string;
  end_date: string;
  status: "held" | "out" | "overdue";
  back_on: string | null;
  mine: boolean;
  borrower?: { name: string };
  record?: { type: "hold" | "loan"; id: string };
}

export function isStaff(role: Role): boolean {
  return role === "volunteer" || role === "founder";
}

export function buildSpanViews(
  spans: readonly BusySpanRecord[],
  viewer: SessionUser,
  calendar: LibraryCalendar,
): SpanView[] {
  return spans.map((span) => {
    const view: SpanView = {
      start_date: span.start_date,
      end_date: span.end_date,
      status: span.status,
      back_on: span.status === "overdue" ? null : nextOpenDay(calendar, span.end_date),
      mine: span.member_id === viewer.id,
    };
    if (isStaff(viewer.role)) {
      view.borrower = { name: span.member_name };
      view.record = { type: span.record_type, id: span.record_id };
    }
    return view;
  });
}

export interface HoldRow {
  id: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  status: "requested" | "ready" | "collected" | "expired" | "cancelled";
  start_date: string;
  end_date: string;
  ready_at: Date | null;
  pickup_deadline: Date | null;
  created_at: Date;
}

export interface HoldView {
  id: string;
  item: { id: string; name: string };
  unit: { id: string; label: string; lane_index: number };
  member: { id: string; name: string };
  status: HoldRow["status"];
  start_date: string;
  end_date: string;
  ready_at: string | null;
  pickup_deadline: string | null;
  created_at: string;
}

export function holdView(hold: HoldRow): HoldView {
  return {
    id: hold.id,
    item: { id: hold.item_id, name: hold.item_name },
    unit: { id: hold.unit_id, label: hold.unit_label, lane_index: hold.lane_index },
    member: { id: hold.member_id, name: hold.member_name },
    status: hold.status,
    start_date: hold.start_date,
    end_date: hold.end_date,
    ready_at: hold.ready_at === null ? null : formatIso(hold.ready_at),
    pickup_deadline: hold.pickup_deadline === null ? null : formatIso(hold.pickup_deadline),
    created_at: formatIso(hold.created_at),
  };
}

export type LoanStatus = "out" | "overdue" | "returned" | "inspected" | "settled";

export interface LoanRow {
  id: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  member_email: string;
  hold_id: string | null;
  status: "out" | "returned" | "inspected" | "settled";
  checked_out_at: Date;
  due_date: string;
  due_at: Date;
  renewed_at: Date | null;
  returned_at: Date | null;
  on_time: boolean | null;
  late_days: number | null;
  deposit_cents: number;
  replacement_cents: number;
  inspection: { outcome: "ok" | "damaged"; note: string; inspected_at: string } | null;
  settlement: SettlementView | null;
  photos: PhotoView[];
}

export interface SettlementView {
  loan_id: string;
  deposit_cents: number;
  released_cents: number;
  damage_cents: number;
  damage_from_deposit_cents: number;
  extra_damage_cents: number;
  late_days: number;
  late_fee_cents: number;
  total_charged_cents: number;
  settled_at: string;
}

export interface PhotoView {
  id: string;
  stage: "checkout" | "return";
  content_type: string;
  size_bytes: number;
  url: string;
}

export function loanStatus(row: Pick<LoanRow, "status" | "due_at" | "returned_at">, now: Date): LoanStatus {
  if (row.status !== "out") return row.status;
  return now.getTime() > row.due_at.getTime() ? "overdue" : "out";
}

export function loanView(row: LoanRow, now: Date): Record<string, unknown> {
  const status = loanStatus(row, now);
  return {
    id: row.id,
    item: { id: row.item_id, name: row.item_name },
    unit: { id: row.unit_id, label: row.unit_label, lane_index: row.lane_index },
    member: { id: row.member_id, name: row.member_name },
    hold_id: row.hold_id,
    status,
    checked_out_at: formatIso(row.checked_out_at),
    due_date: row.due_date,
    due_at: formatIso(row.due_at),
    renewed_at: row.renewed_at === null ? null : formatIso(row.renewed_at),
    returned_at: row.returned_at === null ? null : formatIso(row.returned_at),
    on_time: row.on_time,
    late_days: row.late_days,
    deposit_cents: row.deposit_cents,
    replacement_cents: row.replacement_cents,
    inspection: row.inspection,
    settlement: row.settlement,
    photos: row.photos,
  };
}

export interface ItemRow {
  id: string;
  name: string;
  category: string;
  deposit_cents: number;
  replacement_cents: number;
}

export function itemView(row: ItemRow, unitCount: number, unitsFreeToday: number): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    deposit_cents: row.deposit_cents,
    replacement_cents: row.replacement_cents,
    unit_count: unitCount,
    units_free_today: unitsFreeToday,
  };
}
