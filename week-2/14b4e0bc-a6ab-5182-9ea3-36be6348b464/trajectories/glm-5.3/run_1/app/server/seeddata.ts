import type { Transform } from '../shared/domain';

/**
 * The fixed first-run seed (DP-90), shared by the seeder and by the
 * point-in-time replay, which starts every as-of view from this state.
 */
export interface SeedUser { id: string; name: string; email: string; role: string }
export interface SeedTerm { id: string; name: string; definition: string }
export interface SeedAsset { id: string; kind: string; owner: string; terms: string[]; description: string }
export interface SeedColumn { id: string; type: string; samples: string[] }
export interface SeedEdge { from: string; to: string; transform: Transform }
export interface SeedTag { column: string; tag: string }

export const SEED_PASSWORD = 'strata-seed-2026';

export const SEED_USERS: SeedUser[] = [
  { id: 'u-morgan', name: 'Morgan Ellery', email: 'morgan.ellery@lakeshore-health.test', role: 'Admin' },
  { id: 'u-dana', name: 'Dana Okafor', email: 'dana.okafor@lakeshore-health.test', role: 'Steward' },
  { id: 'u-rui', name: 'Rui Takahashi', email: 'rui.takahashI@lakeshore-health.test'.toLowerCase(), role: 'Steward' },
  { id: 'u-lena', name: 'Lena Marsh', email: 'lena.marsh@lakeshore-health.test', role: 'Analyst' },
  { id: 'u-omar', name: 'Omar Haddad', email: 'omar.haddad@lakeshore-health.test', role: 'Analyst' },
  { id: 'u-sam', name: 'Sam Whitlock', email: 'sam.whitlock@lakeshore-health.test', role: 'Viewer' },
];

export const SEED_TERMS: SeedTerm[] = [
  { id: 't-claim', name: 'Claim', definition: 'A request for payment for a covered service.' },
  { id: 't-eligibility-span', name: 'Eligibility span', definition: 'A continuous period of coverage for one member.' },
  { id: 't-member', name: 'Member', definition: 'A person enrolled in a Lakeshore health plan.' },
  { id: 't-paid-amount', name: 'Paid amount', definition: 'Dollars paid on a claim after adjustments.' },
  { id: 't-provider', name: 'Provider', definition: 'A clinician or facility that bills the plan.' },
  { id: 't-risk-score', name: 'Risk score', definition: 'Modelled likelihood of high-cost care in the next 12 months.' },
];

export const SEED_ASSETS: SeedAsset[] = [
  { id: 'src.members', kind: 'table', owner: 'u-dana', terms: ['t-member'], description: 'Enrolled members, one row per member.' },
  { id: 'src.claims_legacy', kind: 'table', owner: 'u-dana', terms: ['t-claim'], description: 'Extract from the retired claims system.' },
  { id: 'stg.member_claims', kind: 'table', owner: 'u-rui', terms: ['t-claim', 't-member'], description: 'Claims joined to members for modelling.' },
  { id: 'scr.risk_scores', kind: 'table', owner: 'u-rui', terms: ['t-risk-score'], description: 'Member risk scores from the outreach model.' },
  { id: 'mart.claims_by_region', kind: 'table', owner: 'u-lena', terms: ['t-paid-amount'], description: 'Paid claims rolled up by 3-digit ZIP prefix.' },
  { id: 'mart.member_risk', kind: 'table', owner: 'u-lena', terms: ['t-member', 't-risk-score'], description: 'Members ranked by risk for outreach.' },
  { id: 'dash.claims_overview', kind: 'dashboard', owner: 'u-omar', terms: ['t-paid-amount'], description: 'Regional paid-claims dashboard.' },
  { id: 'dash.risk_outreach', kind: 'dashboard', owner: 'u-omar', terms: ['t-risk-score'], description: 'Outreach worklist dashboard.' },
  { id: 'src.eligibility_2019', kind: 'table', owner: 'u-morgan', terms: ['t-eligibility-span'], description: 'Eligibility spans from the 2019 feed.' },
  { id: 'stg.eligibility_spans', kind: 'table', owner: 'u-rui', terms: ['t-eligibility-span'], description: 'Cleaned eligibility spans.' },
  { id: 'ref.providers', kind: 'table', owner: 'u-dana', terms: ['t-provider'], description: 'Contracted providers.' },
];

export const SEED_COLUMNS: SeedColumn[] = [
  { id: 'src.members.member_id', type: 'integer', samples: ['100231', '100232', '100233'] },
  { id: 'src.members.ssn', type: 'text', samples: ['900-11-2041', '900-11-3378', '900-11-4402'] },
  { id: 'src.members.full_name', type: 'text', samples: ['Avery Quill', 'Jordan Pike', 'Rowan Vale'] },
  { id: 'src.members.date_of_birth', type: 'date', samples: ['1961-04-12', '1978-09-30', '1990-01-17'] },
  { id: 'src.members.zip_code', type: 'text', samples: ['53202', '53704', '54301'] },
  { id: 'src.claims_legacy.claim_id', type: 'text', samples: ['CL-0007781', 'CL-0007782', 'CL-0007783'] },
  { id: 'src.claims_legacy.member_ssn', type: 'text', samples: ['900-11-2041', '900-11-3378', '900-11-4402'] },
  { id: 'src.claims_legacy.diagnosis_code', type: 'text', samples: ['E11.9', 'I10', 'J45.909'] },
  { id: 'src.claims_legacy.paid_amount', type: 'numeric', samples: ['412.50', '1280.00', '96.75'] },
  { id: 'src.claims_legacy.service_date', type: 'date', samples: ['2026-03-02', '2026-03-09', '2026-03-15'] },
  { id: 'stg.member_claims.claim_id', type: 'text', samples: ['CL-0007781', 'CL-0007782', 'CL-0007783'] },
  { id: 'stg.member_claims.member_ssn', type: 'text', samples: ['900-11-2041', '900-11-3378', '900-11-4402'] },
  { id: 'stg.member_claims.diagnosis_code', type: 'text', samples: ['E11.9', 'I10', 'J45.909'] },
  { id: 'stg.member_claims.paid_amount', type: 'numeric', samples: ['412.50', '1280.00', '96.75'] },
  { id: 'stg.member_claims.zip_code', type: 'text', samples: ['53202', '53704', '54301'] },
  { id: 'stg.member_claims.risk_score', type: 'numeric', samples: ['0.82', '0.41', '0.67'] },
  { id: 'scr.risk_scores.member_key', type: 'text', samples: ['9f2c41d07ab3', '4e81aa0c55d2', 'c03b7f19e6a4'] },
  { id: 'scr.risk_scores.risk_score', type: 'numeric', samples: ['0.82', '0.41', '0.67'] },
  { id: 'mart.claims_by_region.region_zip', type: 'text', samples: ['532', '537', '543'] },
  { id: 'mart.claims_by_region.total_paid', type: 'numeric', samples: ['18240.25', '9310.00', '4402.75'] },
  { id: 'mart.claims_by_region.claim_count', type: 'integer', samples: ['212', '118', '57'] },
  { id: 'mart.member_risk.member_key', type: 'text', samples: ['9f2c41d07ab3', '4e81aa0c55d2', 'c03b7f19e6a4'] },
  { id: 'mart.member_risk.member_ssn', type: 'text', samples: ['900-11-2041', '900-11-3378', '900-11-4402'] },
  { id: 'mart.member_risk.risk_score', type: 'numeric', samples: ['0.82', '0.41', '0.67'] },
  { id: 'dash.claims_overview.region', type: 'text', samples: ['532', '537', '543'] },
  { id: 'dash.claims_overview.total_paid', type: 'numeric', samples: ['18240.25', '9310.00', '4402.75'] },
  { id: 'dash.risk_outreach.member_ssn', type: 'text', samples: ['900-11-2041', '900-11-3378', '900-11-4402'] },
  { id: 'dash.risk_outreach.risk_score', type: 'numeric', samples: ['0.82', '0.41', '0.67'] },
  { id: 'src.eligibility_2019.member_id', type: 'integer', samples: ['100231', '100232', '100233'] },
  { id: 'src.eligibility_2019.plan_code', type: 'text', samples: ['HMO-GOLD', 'PPO-SILVER', 'HMO-BRONZE'] },
  { id: 'src.eligibility_2019.coverage_start', type: 'date', samples: ['2019-01-01', '2019-04-01', '2019-07-01'] },
  { id: 'stg.eligibility_spans.member_id', type: 'integer', samples: ['100231', '100232', '100233'] },
  { id: 'stg.eligibility_spans.plan', type: 'text', samples: ['HMO-GOLD', 'PPO-SILVER', 'HMO-BRONZE'] },
  { id: 'stg.eligibility_spans.coverage_start', type: 'date', samples: ['2019-01-01', '2019-04-01', '2019-07-01'] },
  { id: 'ref.providers.npi', type: 'text', samples: ['1003000126', '1003000134', '1003000142'] },
  { id: 'ref.providers.provider_name', type: 'text', samples: ['Northgate Family Clinic', 'Harbor Street Pediatrics', 'Linden Cardiology'] },
];

export const SEED_EDGES: SeedEdge[] = [
  { from: 'src.claims_legacy.claim_id', to: 'stg.member_claims.claim_id', transform: 'copy' },
  { from: 'src.members.ssn', to: 'stg.member_claims.member_ssn', transform: 'join' },
  { from: 'src.claims_legacy.member_ssn', to: 'stg.member_claims.member_ssn', transform: 'copy' },
  { from: 'src.claims_legacy.diagnosis_code', to: 'stg.member_claims.diagnosis_code', transform: 'copy' },
  { from: 'src.claims_legacy.paid_amount', to: 'stg.member_claims.paid_amount', transform: 'cast' },
  { from: 'src.members.zip_code', to: 'stg.member_claims.zip_code', transform: 'join' },
  { from: 'stg.member_claims.risk_score', to: 'scr.risk_scores.risk_score', transform: 'copy' },
  { from: 'scr.risk_scores.risk_score', to: 'stg.member_claims.risk_score', transform: 'copy' },
  { from: 'stg.member_claims.member_ssn', to: 'scr.risk_scores.member_key', transform: 'hash' },
  { from: 'stg.member_claims.paid_amount', to: 'scr.risk_scores.risk_score', transform: 'aggregate' },
  { from: 'stg.member_claims.zip_code', to: 'mart.claims_by_region.region_zip', transform: 'cast' },
  { from: 'stg.member_claims.paid_amount', to: 'mart.claims_by_region.total_paid', transform: 'aggregate' },
  { from: 'stg.member_claims.claim_id', to: 'mart.claims_by_region.claim_count', transform: 'aggregate' },
  { from: 'scr.risk_scores.member_key', to: 'mart.member_risk.member_key', transform: 'copy' },
  { from: 'stg.member_claims.member_ssn', to: 'mart.member_risk.member_ssn', transform: 'copy' },
  { from: 'scr.risk_scores.risk_score', to: 'mart.member_risk.risk_score', transform: 'copy' },
  { from: 'mart.claims_by_region.region_zip', to: 'dash.claims_overview.region', transform: 'rename' },
  { from: 'mart.claims_by_region.total_paid', to: 'dash.claims_overview.total_paid', transform: 'copy' },
  { from: 'mart.member_risk.member_ssn', to: 'dash.risk_outreach.member_ssn', transform: 'copy' },
  { from: 'mart.member_risk.risk_score', to: 'dash.risk_outreach.risk_score', transform: 'copy' },
  { from: 'src.eligibility_2019.member_id', to: 'stg.eligibility_spans.member_id', transform: 'copy' },
  { from: 'src.eligibility_2019.plan_code', to: 'stg.eligibility_spans.plan', transform: 'rename' },
  { from: 'src.eligibility_2019.coverage_start', to: 'stg.eligibility_spans.coverage_start', transform: 'cast' },
];

export const SEED_DIRECT_TAGS: SeedTag[] = [
  { column: 'src.members.ssn', tag: 'PII' },
  { column: 'src.members.full_name', tag: 'PII' },
  { column: 'src.members.date_of_birth', tag: 'PII' },
  { column: 'src.members.zip_code', tag: 'Confidential' },
  { column: 'src.claims_legacy.member_ssn', tag: 'PII' },
  { column: 'src.claims_legacy.diagnosis_code', tag: 'Confidential' },
  { column: 'scr.risk_scores.risk_score', tag: 'Confidential' },
];

/** The one seeded deprecation, with no notices and no audit row. */
export const SEED_DEPRECATED = 'src.eligibility_2019';
export const SEED_DEPRECATION_REASON = 'Replaced by the 2024 eligibility feed.';
