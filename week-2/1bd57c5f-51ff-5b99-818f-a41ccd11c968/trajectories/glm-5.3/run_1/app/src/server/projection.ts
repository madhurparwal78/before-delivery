/** Role-scoped field projection and item visibility. Every response shape for
 *  jobs, items, notes, members and events is built here, so no endpoint can
 *  leak a field a role must not see. */

import type { Role, TradeKey } from "../shared/types.js";
import type { JobCtx, Membership } from "./context.js";
import { Errors } from "./errors.js";

export type DbItem = {
  id: string;
  number: number;
  title: string;
  room_id: string;
  trade: TradeKey | null;
  status: "open" | "in_progress" | "ready_for_check" | "verified";
  pin_x: string | null;
  pin_y: string | null;
  pin_status: "placed" | "unpinned" | "needs_review";
  cost_note: string | null;
  quantity: string | null;
  unit_cost: string | null;
  sent_back_reason: string | null;
  created_by_name: string;
  created_by_role: Role;
  created_by_person: string;
  deleted_at: Date | null;
  updated_at: Date;
};

export type DbPhoto = {
  id: string;
  kind: "defect" | "completion";
  content_type: string;
  bytes: number;
  uploaded_by_name: string;
  uploaded_by_role: Role;
  created_at: Date;
};

export type DbNote = {
  id: string;
  item_id: string;
  parent_id: string | null;
  body: string;
  audience: "crew" | "everyone";
  author_name: string;
  author_role: Role;
  rev: number;
  created_at: Date;
};

export type DbConflict = {
  field: string;
  server_value: unknown;
  server_by: string;
  phone_value: unknown;
  phone_by: string;
};

/** A role sees an item when it lies in its scope: trades see their own trade's
 *  items, everyone else sees the whole job. */
export function canSeeItem(membership: Membership, item: { trade: TradeKey | null }): boolean {
  if (membership.role === "trade") return membership.trade !== null && item.trade === membership.trade;
  return true;
}

export function canSeeNote(membership: Membership, note: { audience: "crew" | "everyone"; item_trade: TradeKey | null }): boolean {
  if (note.audience === "everyone") return true;
  if (membership.role === "owner" || membership.role === "lead") return true;
  return membership.role === "trade" && membership.trade !== null && note.item_trade === membership.trade;
}

export function checkItemVisible(ctx: JobCtx, item: { trade: TradeKey | null; deleted_at: Date | null }): void {
  if (item.deleted_at !== null) throw Errors.notFound();
  if (!canSeeItem(ctx.membership, item)) throw Errors.notFound();
}

export function projectPhoto(jobId: string, photo: DbPhoto): Record<string, unknown> {
  return {
    id: photo.id,
    kind: photo.kind,
    content_type: photo.content_type,
    bytes: photo.bytes,
    url: `/api/jobs/${jobId}/photos/${photo.id}`,
    uploaded_by: { name: photo.uploaded_by_name, role: photo.uploaded_by_role },
    created_at: photo.created_at.toISOString(),
  };
}

export function projectNote(note: DbNote): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: note.id,
    body: note.body,
    audience: note.audience,
    author: { name: note.author_name, role: note.author_role },
    rev: note.rev,
    created_at: note.created_at.toISOString(),
  };
  if (note.parent_id === null) out.replies = [];
  return out;
}

export type ItemExtras = {
  photos: DbPhoto[];
  notes: DbNote[];
  conflicts: DbConflict[];
  lineTotal: string;
  blockedBy: number[];
};

export function projectItem(ctx: JobCtx, jobId: string, item: DbItem, extras: ItemExtras): Record<string, unknown> {
  const role = ctx.membership.role;
  const out: Record<string, unknown> = {
    id: item.id,
    number: item.number,
    title: item.title,
    room_id: item.room_id,
    trade: item.trade,
    status: item.status,
    pin: item.pin_x === null ? null : { x: Number(item.pin_x), y: Number(item.pin_y) },
    pin_status: item.pin_status,
    blocked_by: extras.blockedBy,
    photos: extras.photos.map((p) => projectPhoto(jobId, p)),
    notes: extras.notes.map((n) => projectNote(n)),
    created_by: { name: item.created_by_name, role: item.created_by_role },
    updated_at: item.updated_at.toISOString(),
  };
  if (role !== "owner" && role !== "lead") return out;
  out.cost_note = item.cost_note;
  out.quantity = item.quantity;
  out.unit_cost = item.unit_cost;
  out.line_total = extras.lineTotal;
  out.sent_back_reason = item.sent_back_reason;
  out.conflicts = extras.conflicts.map((c) => ({
    field: c.field,
    server_value: c.server_value,
    server_by: c.server_by,
    phone_value: c.phone_value,
    phone_by: c.phone_by,
  }));
  return out;
}

export function projectMember(
  viewer: Membership,
  target: { id: string; name: string; role: Role; trade: TradeKey | null; email: string; phone: string | null },
): Record<string, unknown> {
  const full =
    viewer.role === "owner" || viewer.role === "lead" ||
    target.id === viewer.id || target.role === "owner" || target.role === "lead";
  if (full) return { id: target.id, name: target.name, role: target.role, trade: target.trade, email: target.email, phone: target.phone };
  return { id: target.id, name: target.name, role: target.role, trade: target.trade };
}

export type JobProjectionInput = {
  id: string;
  name: string;
  address: string;
  time_zone: string;
  status: "active" | "walkthrough" | "closed_out";
  plan_url: string | null;
  plan_revision: number | null;
  access_codes_available: boolean;
  next_visit: { starts_at: string; ends_at: string } | null;
};

export function projectJob(ctx: JobCtx, job: JobProjectionInput, progress: { verified: number; total: number }): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    address: job.address,
    time_zone: job.time_zone,
    status: job.status,
    progress: {
      verified: progress.verified,
      total: progress.total,
      percent: progress.total === 0 ? 0 : Math.floor((progress.verified / progress.total) * 100),
    },
    my_role: ctx.membership.role,
    my_trade: ctx.membership.trade,
    plan_url: job.plan_url,
    plan_revision: job.plan_revision,
    access_codes_available: job.access_codes_available,
    next_visit: job.next_visit,
  };
}
