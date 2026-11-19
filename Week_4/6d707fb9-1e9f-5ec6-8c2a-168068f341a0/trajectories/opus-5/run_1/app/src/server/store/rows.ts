import type { CountryId, ModeId } from '../domain/factors';
import type { Language } from '../domain/numbers';
import type { Town } from '../domain/time';

export interface Tier {
  factory: string | null;
  town: string | null;
  country: CountryId | null;
}

export interface FibreShare {
  name: string;
  sharePercent: string;
}

export interface AssessorRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}

export interface LabelRow {
  id: string;
  assessor_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  state: 'open' | 'closed' | 'erased';
  closed_at: string | null;
  erase_at: string | null;
  sort_index: string;
}

export interface SupplierRow {
  id: string;
  label_id: string;
  name: string;
  town: Town;
  language: Language;
  contact_name: string | null;
  contact_email: string | null;
  first_sent_at: string;
}

export interface StyleRowRecord {
  id: string;
  assessor_id: string;
  label_id: string;
  style_code: string | null;
  name: string;
  season: string;
  gtin: string;
  garment: 'tshirt' | 'shirt' | 'jeans' | 'coat';
  washes: number;
  repair_service: boolean | null;
  range_size: number | null;
  notes: string | null;
  state: 'draft' | 'worked' | 'published' | 'archived';
  version: number;
  changed_at: string;
  changed_by: string | null;
  sort_index: string;
}

export interface LineRow {
  id: string;
  style_id: string;
  position: number;
  material_id: string;
  fabric_weight_gsm: string | null;
  area_m2: string | null;
  mass_grams: string;
  fibres: FibreShare[];
  tier1: Tier | null;
  tier2: Tier | null;
  tier3: Tier | null;
  answered_energy_mj: string | null;
  answered_water_litres: string | null;
  answered_origin: CountryId | null;
}

export interface LegRow {
  id: string;
  style_id: string;
  position: number;
  mode: ModeId;
  km: string;
}

export interface StoredAnswer {
  energyValue: string | null;
  energyUnit: string | null;
  energyMjPerKg: string | null;
  waterLitresPerKg: string | null;
  fibreOrigin: CountryId | null;
  evidenceIds: string[];
  answeredAt: string;
  state: 'answered';
}

export interface RequestRow {
  id: string;
  assessor_id: string;
  label_id: string;
  style_id: string;
  line_id: string;
  supplier_id: string;
  supplier_name: string;
  contact_name: string | null;
  contact_email: string | null;
  town: Town;
  language: Language;
  questions: ('energy' | 'water' | 'fibreOrigin')[];
  due_date: string;
  state: 'sent' | 'reminded' | 'answered' | 'ended';
  sent_at: string;
  ends_at: string;
  reminded_at: string | null;
  answered_at: string | null;
  token: string;
  token_ended: boolean;
  answer: StoredAnswer | null;
}

export interface VisitRow {
  id: string;
  assessor_id: string;
  label_id: string;
  factory_name: string;
  town: Town;
  local_date: string;
  local_time: string;
  at: string;
}

export interface ReadingRow {
  id: string;
  visit_id: string;
  meter: number;
  value: string;
  unit: string;
  taken_at: string;
  sort_index: string;
}

export interface ResultRow {
  id: string;
  style_id: string;
  edition: string;
  worked_out_at: string;
  data_quality_percent: number;
  data_quality_grade: 'A' | 'B' | 'C';
  measures: unknown;
  factor_rows: unknown;
  input: unknown;
  is_current: boolean;
  sort_index: string;
}

export interface ScoreRow {
  style_id: string;
  state: 'none' | 'current' | 'outdated' | 'busy';
  score: number | null;
  per100g: number | null;
  run_id: string | null;
  body_hash: string | null;
  worst_case: string[];
  busy_until: string | null;
  asked_at: string | null;
}

export interface PassportSnapshot {
  styleName: string;
  labelName: string;
  garment: 'tshirt' | 'shirt' | 'jeans' | 'coat';
  factorEdition: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  score: number;
  per100g: number;
  scoreShown: string;
  measures: { measure: string; totalShown: string }[];
}

export interface PassportRow {
  id: string;
  style_id: string;
  label_id: string;
  gtin: string;
  edition: number;
  state: 'published' | 'withdrawn';
  published_at: string;
  corrected_on: string | null;
  snapshot: PassportSnapshot;
}

export interface DossierRow {
  id: string;
  style_id: string;
  label_id: string;
  result_id: string;
  edition: string;
  state: 'making' | 'ready' | 'signedOff' | 'replaced';
  made_at: string;
  signed_off_by: string | null;
  signed_off_at: string | null;
  object_key: string | null;
  token: string | null;
  token_ends_at: string | null;
  token_ended: boolean;
}

export interface EvidenceRow {
  id: string;
  request_id: string;
  assessor_id: string;
  label_id: string;
  file_name: string;
  size_bytes: number;
  content_type: string;
  object_key: string;
}
