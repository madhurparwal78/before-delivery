// Domain value types used across the server and client.

export type Role = 'member' | 'kitchen_manager' | 'finance_lead';
export type BookingStatus =
  | 'held'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'no_show'
  | 'cancelled'
  | 'expired';
export type StationKind = 'oven' | 'mixer' | 'blast_chiller' | 'prep_table';
export type DocumentStatus = 'pending' | 'verified' | 'rejected';
export type DocumentType =
  | 'certificate_of_insurance'
  | 'food_handler_certificate'
  | 'business_licence';
export type ServiceKind =
  | 'potable_water'
  | 'grey_water'
  | 'grease'
  | 'food_storage'
  | 'cleaning'
  | 'restock';
export type LedgerAccount =
  | 'available'
  | 'committed'
  | 'expired'
  | 'pack_sales'
  | 'opening_balance'
  | 'used'
  | 'forfeited';
export type MovementKind =
  | 'opening_balance'
  | 'pack_purchase'
  | 'booking_debit'
  | 'hold_release'
  | 'cancel_refund'
  | 'forfeit'
  | 'usage'
  | 'late_checkout'
  | 'pack_expiry';
export type AuditOutcome =
  | 'allowed'
  | 'refused_session'
  | 'refused_csrf'
  | 'refused_rate'
  | 'refused_role'
  | 'refused_scope'
  | 'refused_validation'
  | 'refused_conflict'
  | 'failed_dependency';
export type RateState = 'current' | 'upcoming' | 'past';
export type LinkState = 'live' | 'expired' | 'revoked';
export type SectorKind =
  | 'booked'
  | 'buffer'
  | 'own_held'
  | 'own_confirmed'
  | 'nonexistent';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ActorSummary {
  user_id: string;
  name: string;
}

export interface ActorWithRole extends ActorSummary {
  role: Role;
}
