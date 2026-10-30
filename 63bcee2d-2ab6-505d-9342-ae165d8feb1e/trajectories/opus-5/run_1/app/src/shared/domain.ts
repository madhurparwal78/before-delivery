/** Vocabulary shared by the server and the browser. */

export type Role =
  | 'director'
  | 'project_lead'
  | 'designer'
  | 'finance'
  | 'client_approver'
  | 'contractor';

export const ROLES: readonly Role[] = [
  'director',
  'project_lead',
  'designer',
  'finance',
  'client_approver',
  'contractor',
];

export const STUDIO_ROLES: readonly Role[] = ['director', 'project_lead', 'designer', 'finance'];

export const ROLE_LABELS: Record<Role, string> = {
  director: 'Studio director',
  project_lead: 'Project lead',
  designer: 'Designer',
  finance: 'Studio finance',
  client_approver: 'Client approver',
  contractor: 'Contractor',
};

export type StageKey =
  | 'groundwork'
  | 'scheme'
  | 'detailing'
  | 'tender_award'
  | 'build'
  | 'handover'
  | 'aftercare';

export const STAGE_KEYS: readonly StageKey[] = [
  'groundwork',
  'scheme',
  'detailing',
  'tender_award',
  'build',
  'handover',
  'aftercare',
];

/** The six fee-bearing stages, in gate order. */
export const FEE_STAGE_KEYS: readonly StageKey[] = [
  'groundwork',
  'scheme',
  'detailing',
  'tender_award',
  'build',
  'handover',
];

export const STAGE_NAMES: Record<StageKey, string> = {
  groundwork: 'Groundwork',
  scheme: 'Scheme',
  detailing: 'Detailing',
  tender_award: 'Tender & Award',
  build: 'Build',
  handover: 'Handover',
  aftercare: 'Aftercare',
};

export type StageState = 'not_started' | 'requested' | 'signed_off' | 'returned';

export const STAGE_STATE_LABELS: Record<StageState, string> = {
  not_started: 'Not started',
  requested: 'Requested',
  signed_off: 'Signed off',
  returned: 'Returned',
};

export type Region = 'HK' | 'SG' | 'MO';
export type Currency = 'HKD' | 'SGD';

export const REGION_LABELS: Record<Region, string> = {
  HK: 'Hong Kong',
  SG: 'Singapore',
  MO: 'Macao',
};

export const HK_ZONE = 'Asia/Hong_Kong';
export const SG_ZONE = 'Asia/Singapore';

export type TimeZoneName = typeof HK_ZONE | typeof SG_ZONE;

export function regionCurrency(region: Region): Currency {
  return region === 'SG' ? 'SGD' : 'HKD';
}

export function regionZone(region: Region): TimeZoneName {
  return region === 'SG' ? SG_ZONE : HK_ZONE;
}

export function zoneLabel(zone: TimeZoneName): 'HKT' | 'SGT' {
  return zone === SG_ZONE ? 'SGT' : 'HKT';
}

export type TenderStatus = 'draft' | 'open' | 'closed' | 'opened' | 'awarded';

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  opened: 'Opened',
  awarded: 'Awarded',
};

export type VariationState = 'raised' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

export const VARIATION_STATE_WORDS: Record<VariationState, string> = {
  raised: 'raised',
  under_review: 'under review',
  approved: 'approved',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

export type VariationAction = 'start_review' | 'approve' | 'reject' | 'withdraw';

export const VARIATION_ACTION_PAST: Record<VariationAction, string> = {
  start_review: 'put under review',
  approve: 'approved',
  reject: 'rejected',
  withdraw: 'withdrawn',
};

export type SnagState = 'open' | 'fixed' | 'closed' | 'reopened';

export const SNAG_STATE_LABELS: Record<SnagState, string> = {
  open: 'Open',
  fixed: 'Fixed',
  closed: 'Closed',
  reopened: 'Reopened',
};

export type ShapeName = 'ring' | 'square' | 'diamond' | 'triangle' | 'circle' | 'cross' | 'clock';

export const SNAG_STATE_SHAPES: Record<SnagState, ShapeName> = {
  open: 'ring',
  fixed: 'square',
  closed: 'diamond',
  reopened: 'triangle',
};

export type SnagAction = 'fix' | 'close' | 'reopen';

export type ReviewCode = 1 | 2 | 3 | 4;

export const REVIEW_CODE_LABELS: Record<ReviewCode, string> = {
  1: 'Code 1 Proceed',
  2: 'Code 2 Proceed with comments',
  3: 'Code 3 Revise and resubmit',
  4: 'Code 4 Rejected',
};

export const REVIEW_CODE_SHAPES: Record<ReviewCode, ShapeName> = {
  1: 'circle',
  2: 'ring',
  3: 'triangle',
  4: 'cross',
};

export type ShopDrawingStatus = 'received' | 'returned';

export type Sector = 'retail' | 'workplace' | 'food_beverage';

export const SECTORS: readonly Sector[] = ['retail', 'workplace', 'food_beverage'];

export const SECTOR_LABELS: Record<Sector, string> = {
  retail: 'Retail',
  workplace: 'Workplace',
  food_beverage: 'Food & beverage',
};

export type CaseStudyState =
  | 'draft'
  | 'preview_sent'
  | 'client_approved'
  | 'published'
  | 'withdrawn';

export const CASE_STUDY_STATE_LABELS: Record<CaseStudyState, string> = {
  draft: 'Draft',
  preview_sent: 'Preview sent',
  client_approved: 'Client approved',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

export type TransmittalPurpose = 'for_construction' | 'for_tender' | 'for_information';

export const TRANSMITTAL_PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  for_construction: 'For construction',
  for_tender: 'For tender',
  for_information: 'For information',
};

export type CertificateKind = 'interim' | 'retention_release_half' | 'retention_release_final';

export const FINISH_CATEGORIES: readonly string[] = [
  'Paint',
  'Tile',
  'Laminate',
  'Stone',
  'Timber',
  'Metal',
  'Fabric',
  'Glass',
  'Lighting',
  'Other',
];

export type ProjectSection =
  | 'stages'
  | 'drawings'
  | 'tenders'
  | 'variations'
  | 'certificates'
  | 'shop-drawings'
  | 'site-walk'
  | 'finishes';

export const PROJECT_SECTIONS: readonly ProjectSection[] = [
  'stages',
  'drawings',
  'tenders',
  'variations',
  'certificates',
  'shop-drawings',
  'site-walk',
  'finishes',
];

export const PROJECT_SECTION_LABELS: Record<ProjectSection, string> = {
  stages: 'Stages',
  drawings: 'Drawings',
  tenders: 'Tenders',
  variations: 'Variations',
  certificates: 'Certificates',
  'shop-drawings': 'Shop drawings',
  'site-walk': 'Site walk',
  finishes: 'Finishes',
};

/** Title-block sheet code per project panel. */
export const PANEL_SHEET_CODES: Record<ProjectSection, string> = {
  stages: 'PL-01',
  drawings: 'PL-02',
  tenders: 'PL-03',
  variations: 'PL-04',
  certificates: 'PL-05',
  'shop-drawings': 'PL-06',
  'site-walk': 'PL-07',
  finishes: 'PL-08',
};

/** Sections each role may open, in tab order. */
export function visibleSections(role: Role): ProjectSection[] {
  switch (role) {
    case 'director':
    case 'project_lead':
    case 'designer':
      return [...PROJECT_SECTIONS];
    case 'finance':
      return ['stages', 'drawings', 'tenders', 'variations', 'certificates', 'finishes'];
    case 'client_approver':
      return ['stages', 'drawings', 'certificates'];
    case 'contractor':
      return ['drawings', 'tenders', 'variations', 'certificates', 'shop-drawings', 'site-walk'];
  }
}

export function isStudioRole(role: Role): boolean {
  return STUDIO_ROLES.includes(role);
}

export const STUDIO_ORGANISATION = 'Marrow Hall Interiors';
