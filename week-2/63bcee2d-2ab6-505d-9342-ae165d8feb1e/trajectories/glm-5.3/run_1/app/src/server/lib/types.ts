// Domain roles and shared shapes.

export type Role = 'director' | 'project_lead' | 'designer' | 'finance' | 'client_approver' | 'contractor';
export const STUDIO_ROLES: Role[] = ['director', 'project_lead', 'designer', 'finance'];
export type StageKey = 'groundwork' | 'scheme' | 'detailing' | 'tender_award' | 'build' | 'handover' | 'aftercare';

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  brandId: string | null;
  companyId: string | null;
  status: 'active' | 'removed';
  approvalHkd: number | null;
  approvalSgd: number | null;
  version: number;
}

export interface ProjectRow {
  id: string;
  reference: string;
  name: string;
  brandId: string;
  region: 'HK' | 'SG' | 'MO';
  currency: 'HKD' | 'SGD';
  refSeq: number;
  defectsPeriodMonths: number;
  practicalCompletionOn: string | null;
  defectsEndOn: string | null;
  contractCompany: string | null;
  contractSumCents: number | null;
  contractAwardedAt: Date | null;
}

export interface StoreRow {
  id: string;
  projectId: string;
  code: string;
  name: string;
  weight: number;
}

export interface SessionedRequestContext {
  member: Member;
}
