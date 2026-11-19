// Shared wire shapes: exactly the published fields at every depth.

import type { ActorSummary, ActorWithRole, BookingStatus, DocumentStatus, DocumentType, Json, LinkState, MovementKind, RateState, ServiceKind } from './types.js';

export interface BookingOverage {
  quarter_hours: number;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  killbill_invoice_id: string | null;
}

export interface Booking {
  id: string;
  reference: string;
  site_id: string;
  station_id: string;
  station_name: string;
  member_id: string;
  business_name: string;
  date: string;
  start: string;
  end: string;
  start_at: string;
  end_at: string;
  hours: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  series_id: string | null;
  refunded_hours: number | null;
  forfeited_hours: number | null;
  cancelled_by: ActorSummary | null;
  cancellation_reason: string | null;
  checked_in_at: string | null;
  checked_in_by: ActorSummary | null;
  no_show_by: ActorSummary | null;
  checked_out_at: string | null;
  checked_out_by: ActorSummary | null;
  late_quarter_hours: number | null;
  pack_hours_applied: number | null;
  overage: BookingOverage | null;
  created_at: string;
}

export interface Lot {
  purchase_id: string | null;
  pack_name: string;
  hours: number;
  valid_through: string | null;
  expiring_soon: boolean;
}

export interface Balances {
  available_hours: number;
  committed_hours: number;
  lots: Lot[];
}

export interface LedgerMovement {
  id: number;
  kind: MovementKind;
  booking_id: string | null;
  purchase_id: string | null;
  hours: number;
  created_at: string;
  actor: ActorWithRole | null;
  lots: Array<{ purchase_id: string | null; hours: number }>;
  entries: Array<{ account: string; hours: number }>;
}

export interface DocumentRecord {
  id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  rejection_reason: string | null;
  created_at: string;
}

export interface VisitRecord {
  id: string;
  truck_id: string;
  site_id: string;
  arrived_at: string;
  departed_at: string | null;
  services: ServiceKind[];
  operator_signature: string;
  manager_name: string;
  gap_hours: number | null;
  gap_flagged: boolean;
}

export interface InspectorLink {
  id: string;
  truck_id: string;
  inspector_email: string;
  url: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  state: LinkState;
}

export interface RateRecord {
  id: string;
  effective_from: string;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  state: RateState;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  actor: ActorWithRole | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcomeWire;
  address_prefix: string | null;
}
export type AuditOutcomeWire =
  | 'allowed'
  | 'refused_session'
  | 'refused_csrf'
  | 'refused_rate'
  | 'refused_role'
  | 'refused_scope'
  | 'refused_validation'
  | 'refused_conflict'
  | 'failed_dependency';

export interface Sector {
  kind: 'booked' | 'buffer' | 'own_held' | 'own_confirmed' | 'nonexistent';
  start: string;
  end: string;
  booking_id: string | null;
}

export interface AvailabilityStation {
  id: string;
  name: string;
  kind: 'oven' | 'mixer' | 'blast_chiller' | 'prep_table';
  sectors: Sector[];
}

export interface TenantSummaryWire {
  id: string;
  name: string;
  legal_name: string;
}
export interface MeMember {
  id: string;
  business_name: string;
  home_site_id: string;
  available_hours: number;
  committed_hours: number;
  valid_through: Record<DocumentType, string | null>;
  truck: { id: string; name: string; permit_number: string } | null;
}
export interface MeBody {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'member' | 'kitchen_manager' | 'finance_lead';
    tenant: TenantSummaryWire;
    site_id: string | null;
  };
  member: MeMember | null;
}

export type Wire = Json;
