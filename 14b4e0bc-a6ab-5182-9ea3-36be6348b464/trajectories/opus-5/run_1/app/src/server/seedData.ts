import type { AssetKind, Role, Tag, Transform } from '../shared/domain.ts';

export const SEED_PASSWORD = 'strata-seed-2026';

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const SEED_USERS: readonly SeedUser[] = [
  { id: 'u-morgan', name: 'Morgan Ellery', email: 'morgan.ellery@lakeshore-health.test', role: 'Admin' },
  { id: 'u-dana', name: 'Dana Okafor', email: 'dana.okafor@lakeshore-health.test', role: 'Steward' },
  { id: 'u-rui', name: 'Rui Takahashi', email: 'rui.takahashi@lakeshore-health.test', role: 'Steward' },
  { id: 'u-lena', name: 'Lena Marsh', email: 'lena.marsh@lakeshore-health.test', role: 'Analyst' },
  { id: 'u-omar', name: 'Omar Haddad', email: 'omar.haddad@lakeshore-health.test', role: 'Analyst' },
  { id: 'u-sam', name: 'Sam Whitlock', email: 'sam.whitlock@lakeshore-health.test', role: 'Viewer' },
];

export interface SeedTerm {
  id: string;
  name: string;
  definition: string;
}

export const SEED_TERMS: readonly SeedTerm[] = [
  { id: 't-claim', name: 'Claim', definition: 'A request for payment for a covered service.' },
  {
    id: 't-eligibility-span',
    name: 'Eligibility span',
    definition: 'A continuous period of coverage for one member.',
  },
  { id: 't-member', name: 'Member', definition: 'A person enrolled in a Lakeshore health plan.' },
  { id: 't-paid-amount', name: 'Paid amount', definition: 'Dollars paid on a claim after adjustments.' },
  { id: 't-provider', name: 'Provider', definition: 'A clinician or facility that bills the plan.' },
  {
    id: 't-risk-score',
    name: 'Risk score',
    definition: 'Modelled likelihood of high-cost care in the next 12 months.',
  },
];

export interface SeedColumn {
  name: string;
  dataType: string;
  directTags: Tag[];
  samples: string[];
}

export interface SeedAsset {
  id: string;
  kind: AssetKind;
  ownerId: string;
  termIds: string[];
  description: string;
  columns: SeedColumn[];
}

export const SEED_ASSETS: readonly SeedAsset[] = [
  {
    id: 'src.members',
    kind: 'table',
    ownerId: 'u-dana',
    termIds: ['t-member'],
    description: 'Enrolled members, one row per member.',
    columns: [
      { name: 'member_id', dataType: 'integer', directTags: [], samples: ['100231', '100232', '100233'] },
      {
        name: 'ssn',
        dataType: 'text',
        directTags: ['PII'],
        samples: ['900-11-2041', '900-11-3378', '900-11-4402'],
      },
      {
        name: 'full_name',
        dataType: 'text',
        directTags: ['PII'],
        samples: ['Avery Quill', 'Jordan Pike', 'Rowan Vale'],
      },
      {
        name: 'date_of_birth',
        dataType: 'date',
        directTags: ['PII'],
        samples: ['1961-04-12', '1978-09-30', '1990-01-17'],
      },
      {
        name: 'zip_code',
        dataType: 'text',
        directTags: ['Confidential'],
        samples: ['53202', '53704', '54301'],
      },
    ],
  },
  {
    id: 'src.claims_legacy',
    kind: 'table',
    ownerId: 'u-dana',
    termIds: ['t-claim'],
    description: 'Extract from the retired claims system.',
    columns: [
      {
        name: 'claim_id',
        dataType: 'text',
        directTags: [],
        samples: ['CL-0007781', 'CL-0007782', 'CL-0007783'],
      },
      {
        name: 'member_ssn',
        dataType: 'text',
        directTags: ['PII'],
        samples: ['900-11-2041', '900-11-3378', '900-11-4402'],
      },
      {
        name: 'diagnosis_code',
        dataType: 'text',
        directTags: ['Confidential'],
        samples: ['E11.9', 'I10', 'J45.909'],
      },
      { name: 'paid_amount', dataType: 'numeric', directTags: [], samples: ['412.50', '1280.00', '96.75'] },
      {
        name: 'service_date',
        dataType: 'date',
        directTags: [],
        samples: ['2026-03-02', '2026-03-09', '2026-03-15'],
      },
    ],
  },
  {
    id: 'stg.member_claims',
    kind: 'table',
    ownerId: 'u-rui',
    termIds: ['t-claim', 't-member'],
    description: 'Claims joined to members for modelling.',
    columns: [
      {
        name: 'claim_id',
        dataType: 'text',
        directTags: [],
        samples: ['CL-0007781', 'CL-0007782', 'CL-0007783'],
      },
      {
        name: 'member_ssn',
        dataType: 'text',
        directTags: [],
        samples: ['900-11-2041', '900-11-3378', '900-11-4402'],
      },
      { name: 'diagnosis_code', dataType: 'text', directTags: [], samples: ['E11.9', 'I10', 'J45.909'] },
      { name: 'paid_amount', dataType: 'numeric', directTags: [], samples: ['412.50', '1280.00', '96.75'] },
      { name: 'zip_code', dataType: 'text', directTags: [], samples: ['53202', '53704', '54301'] },
      { name: 'risk_score', dataType: 'numeric', directTags: [], samples: ['0.82', '0.41', '0.67'] },
    ],
  },
  {
    id: 'scr.risk_scores',
    kind: 'table',
    ownerId: 'u-rui',
    termIds: ['t-risk-score'],
    description: 'Member risk scores from the outreach model.',
    columns: [
      {
        name: 'member_key',
        dataType: 'text',
        directTags: [],
        samples: ['9f2c41d07ab3', '4e81aa0c55d2', 'c03b7f19e6a4'],
      },
      {
        name: 'risk_score',
        dataType: 'numeric',
        directTags: ['Confidential'],
        samples: ['0.82', '0.41', '0.67'],
      },
    ],
  },
  {
    id: 'mart.claims_by_region',
    kind: 'table',
    ownerId: 'u-lena',
    termIds: ['t-paid-amount'],
    description: 'Paid claims rolled up by 3-digit ZIP prefix.',
    columns: [
      { name: 'region_zip', dataType: 'text', directTags: [], samples: ['532', '537', '543'] },
      {
        name: 'total_paid',
        dataType: 'numeric',
        directTags: [],
        samples: ['18240.25', '9310.00', '4402.75'],
      },
      { name: 'claim_count', dataType: 'integer', directTags: [], samples: ['212', '118', '57'] },
    ],
  },
  {
    id: 'mart.member_risk',
    kind: 'table',
    ownerId: 'u-lena',
    termIds: ['t-member', 't-risk-score'],
    description: 'Members ranked by risk for outreach.',
    columns: [
      {
        name: 'member_key',
        dataType: 'text',
        directTags: [],
        samples: ['9f2c41d07ab3', '4e81aa0c55d2', 'c03b7f19e6a4'],
      },
      {
        name: 'member_ssn',
        dataType: 'text',
        directTags: [],
        samples: ['900-11-2041', '900-11-3378', '900-11-4402'],
      },
      { name: 'risk_score', dataType: 'numeric', directTags: [], samples: ['0.82', '0.41', '0.67'] },
    ],
  },
  {
    id: 'dash.claims_overview',
    kind: 'dashboard',
    ownerId: 'u-omar',
    termIds: ['t-paid-amount'],
    description: 'Regional paid-claims dashboard.',
    columns: [
      { name: 'region', dataType: 'text', directTags: [], samples: ['532', '537', '543'] },
      {
        name: 'total_paid',
        dataType: 'numeric',
        directTags: [],
        samples: ['18240.25', '9310.00', '4402.75'],
      },
    ],
  },
  {
    id: 'dash.risk_outreach',
    kind: 'dashboard',
    ownerId: 'u-omar',
    termIds: ['t-risk-score'],
    description: 'Outreach worklist dashboard.',
    columns: [
      {
        name: 'member_ssn',
        dataType: 'text',
        directTags: [],
        samples: ['900-11-2041', '900-11-3378', '900-11-4402'],
      },
      { name: 'risk_score', dataType: 'numeric', directTags: [], samples: ['0.82', '0.41', '0.67'] },
    ],
  },
  {
    id: 'src.eligibility_2019',
    kind: 'table',
    ownerId: 'u-morgan',
    termIds: ['t-eligibility-span'],
    description: 'Eligibility spans from the 2019 feed.',
    columns: [
      { name: 'member_id', dataType: 'integer', directTags: [], samples: ['100231', '100232', '100233'] },
      {
        name: 'plan_code',
        dataType: 'text',
        directTags: [],
        samples: ['HMO-GOLD', 'PPO-SILVER', 'HMO-BRONZE'],
      },
      {
        name: 'coverage_start',
        dataType: 'date',
        directTags: [],
        samples: ['2019-01-01', '2019-04-01', '2019-07-01'],
      },
    ],
  },
  {
    id: 'stg.eligibility_spans',
    kind: 'table',
    ownerId: 'u-rui',
    termIds: ['t-eligibility-span'],
    description: 'Cleaned eligibility spans.',
    columns: [
      { name: 'member_id', dataType: 'integer', directTags: [], samples: ['100231', '100232', '100233'] },
      { name: 'plan', dataType: 'text', directTags: [], samples: ['HMO-GOLD', 'PPO-SILVER', 'HMO-BRONZE'] },
      {
        name: 'coverage_start',
        dataType: 'date',
        directTags: [],
        samples: ['2019-01-01', '2019-04-01', '2019-07-01'],
      },
    ],
  },
  {
    id: 'ref.providers',
    kind: 'table',
    ownerId: 'u-dana',
    termIds: ['t-provider'],
    description: 'Contracted providers.',
    columns: [
      {
        name: 'npi',
        dataType: 'text',
        directTags: [],
        samples: ['1003000126', '1003000134', '1003000142'],
      },
      {
        name: 'provider_name',
        dataType: 'text',
        directTags: [],
        samples: ['Northgate Family Clinic', 'Harbor Street Pediatrics', 'Linden Cardiology'],
      },
    ],
  },
];

export interface SeedEdge {
  from: string;
  to: string;
  transform: Transform;
}

export const SEED_EDGES: readonly SeedEdge[] = [
  { from: 'src.claims_legacy.claim_id', to: 'stg.member_claims.claim_id', transform: 'copy' },
  { from: 'src.members.ssn', to: 'stg.member_claims.member_ssn', transform: 'join' },
  { from: 'src.claims_legacy.member_ssn', to: 'stg.member_claims.member_ssn', transform: 'copy' },
  { from: 'src.claims_legacy.diagnosis_code', to: 'stg.member_claims.diagnosis_code', transform: 'copy' },
  { from: 'src.claims_legacy.paid_amount', to: 'stg.member_claims.paid_amount', transform: 'cast' },
  { from: 'src.members.zip_code', to: 'stg.member_claims.zip_code', transform: 'join' },
  { from: 'scr.risk_scores.risk_score', to: 'stg.member_claims.risk_score', transform: 'copy' },
  { from: 'stg.member_claims.member_ssn', to: 'scr.risk_scores.member_key', transform: 'hash' },
  { from: 'stg.member_claims.paid_amount', to: 'scr.risk_scores.risk_score', transform: 'aggregate' },
  { from: 'stg.member_claims.risk_score', to: 'scr.risk_scores.risk_score', transform: 'copy' },
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
  {
    from: 'src.eligibility_2019.coverage_start',
    to: 'stg.eligibility_spans.coverage_start',
    transform: 'cast',
  },
];

export const SEED_DEPRECATED_ASSET = {
  assetId: 'src.eligibility_2019',
  actorId: 'u-morgan',
  reason: 'Replaced by the 2024 eligibility feed.',
};
