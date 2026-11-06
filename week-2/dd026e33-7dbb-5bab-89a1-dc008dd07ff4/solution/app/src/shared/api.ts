// API object shapes (brief: API › Objects). The server serialises exactly these; the browser reads them.
import type { Band, BayClass, FlagCode, ItemKind, LineKind, PanelId, Role } from "./domain.js";
import type { Units } from "./units.js";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Actor {
  id: string;
  name: string;
}

export interface Startup {
  scheduled: boolean;
  last_at: string | null;
  next_due: string | null;
  status: "ok" | "overdue" | "not_scheduled";
}

export interface BayBilling {
  status: "none" | "pending" | "active" | "ending";
  plan: string | null;
  monthly_price: string | null;
  charged_through_date: string | null;
  billing_end_date: string | null;
  cancel_requested: boolean;
}

export type CarStatus = "awaiting_intake" | "stored" | "released";

export interface Car {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  owner: Actor;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  status: CarStatus;
  bay: { id: string; code: string; class: BayClass } | null;
  startup: Startup;
  bay_billing: BayBilling;
  open_release: boolean;
}

export interface Item {
  id: string;
  kind: ItemKind;
  label: string;
  count_in: number;
}

export interface Movement {
  id: string;
  direction: "in" | "out";
  count: number;
  at: string;
  by: Actor;
}

export interface Report {
  id: string;
  car_id: string;
  sha256: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: Actor;
}

export interface Photo {
  id: string;
  car_id: string;
  kind: "intake" | "stage";
  job_id: string | null;
  content_type: string;
  size_bytes: number;
  attached: true;
  created_at: string;
}

export interface Tyres {
  fl: string;
  fr: string;
  rl: string;
  rr: string;
}

export interface Entry {
  id: string;
  at: string;
  by: Actor;
  started: boolean;
  battery_v: string | null;
  tyres_bar: Tyres | null;
  note: string;
  flags: FlagCode[];
}

export interface JobSummary {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
}

export interface CarDetail extends Car {
  belongings: Item[];
  condition_report: Report | null;
  photos: Photo[];
  care_entries: Entry[];
  jobs: JobSummary[];
  releases: Release[];
}

export interface Bay {
  id: string;
  code: string;
  class: BayClass;
  length_mm: number;
  width_mm: number;
  row: number;
  column: number;
  car: Actor | null;
  eligible?: boolean;
  reason?: "occupied" | "too_small" | "class_change" | null;
}

export interface Line {
  id: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
  net: string;
  vat: string;
}

export type JobStatus = "draft" | "sent" | "approved" | "declined" | "expired" | "in_progress" | "finished" | "invoiced" | "paid";

export interface StageSummary {
  id: string;
  index: number;
  name: string;
  logged_at: string;
  readings_count: number;
}

export interface Job {
  id: string;
  number: string;
  version: number;
  car: Actor;
  owner: Actor;
  title: string;
  status: JobStatus;
  lines: Line[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  currency: "CHF";
  sent_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  finished_at: string | null;
  stages: StageSummary[];
  invoice_id: string | null;
}

export interface Payment {
  killbill_payment_id?: string;
  amount: string;
  refunded: string;
  reference: string | null;
  at: string;
  recorded_by?: Actor | null;
}

export interface Invoice {
  id: string;
  number: string;
  job_id: string;
  car: Actor;
  owner: Actor;
  lines: Line[];
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
  currency: "CHF";
  balance: string;
  balance_live: boolean;
  status: "awaiting_payment" | "paid";
  issued_at: string;
  paid_at: string | null; // YYYY-MM-DD, the Zurich date of the payment that brought the balance to zero
  status_confirmed_at: string;
  payments: Payment[];
  killbill_invoice_id?: string;
}

export type ReleaseStatus = "requested" | "booked" | "staged" | "released" | "cancelled";

export interface Hold {
  id: string;
  number: string;
  balance: string;
}

export interface Release {
  id: string;
  car: Actor;
  owner: Actor;
  slot: string;
  slot_label: string;
  status: ReleaseStatus;
  bay_code: string | null;
  held_by: Hold[];
  events: { status: ReleaseStatus; at: string; by: Actor }[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  revoked_at: string | null;
  last_sign_in_at: string | null;
}

export interface Reading {
  id: string;
  stage: string;
  film_um: number;
  logged_at: string;
  logged_by: Actor;
}

export interface CoatStackPanel {
  panel: PanelId;
  film_um: number | null;
  band: Band | null;
  layers: { stage: string; um: number }[];
}

export interface CoatStack {
  job_id: string;
  panels: { id: PanelId; name: string; order: number }[];
  stages: { index: number; name: string; logged_at: string; panels: CoatStackPanel[] }[];
}

export interface CareRoundRow {
  car: Actor;
  bay_code: string;
  startup: Startup;
  last_entry: Entry | null;
}

export interface Board {
  occupancy: { occupied: number; total: number };
  bays: Bay[];
  overdue: { car: Actor; bay_code: string; startup: Startup }[];
  unpaid: { invoices: Invoice[]; total: string; live: boolean };
}

export interface Me {
  user: User;
  units: Units;
}

export interface ServiceStatus {
  storage: "up" | "down";
  billing: "up" | "down";
  mail: "up" | "down";
}

export type ErrorBody =
  | { error: string; items?: Item[]; invoices?: Hold[] }
  | { errors: Record<string, string> };
