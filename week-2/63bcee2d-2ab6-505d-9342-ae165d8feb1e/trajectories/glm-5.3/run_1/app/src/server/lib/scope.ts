// Scope: which projects a member can see, and member projection per role.

import { one } from './db.js';
import { notFound } from './errors.js';
import { STUDIO_ROLES, type Member, type ProjectRow, type Role } from './types.js';
import type { AuthedRequest } from './auth.js';

export interface ProjectRecord extends ProjectRow {
  brandName: string;
}

export async function projectById(id: string): Promise<ProjectRecord | null> {
  // pg returns snake_case columns; map them once to the domain's camelCase.
  const row = await one<{
    id: string; reference: string; name: string; brand_id: string; region: 'HK' | 'SG' | 'MO';
    currency: 'HKD' | 'SGD'; ref_seq: number; defects_period_months: number;
    practical_completion_on: string | null; defects_end_on: string | null;
    contract_company: string | null; contract_sum_cents: string | null; contract_awarded_at: Date | null;
    brand_name: string;
  }>(
    'SELECT p.*, b.name AS brand_name FROM projects p JOIN brands b ON b.id = p.brand_id WHERE p.id = $1',
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    brandId: row.brand_id,
    brandName: row.brand_name,
    region: row.region,
    currency: row.currency,
    refSeq: row.ref_seq,
    defectsPeriodMonths: row.defects_period_months,
    practicalCompletionOn: row.practical_completion_on,
    defectsEndOn: row.defects_end_on,
    contractCompany: row.contract_company,
    contractSumCents: row.contract_sum_cents === null ? null : parseInt(row.contract_sum_cents, 10),
    contractAwardedAt: row.contract_awarded_at,
  };
}

export function canSeeProject(member: Member, project: ProjectRecord): boolean {
  if (STUDIO_ROLES.includes(member.role)) return true;
  if (member.role === 'client_approver') return member.brandId === project.brandId;
  if (member.role === 'contractor') return member.companyId === project.contractCompany;
  return false;
}

/** Project scoped to the caller, or 404 exactly like an unknown id. */
export async function scopedProject(req: AuthedRequest, id: string): Promise<ProjectRecord> {
  const project = await projectById(id);
  if (!project || !canSeeProject(req.member!, project)) throw notFound();
  return project;
}


export interface MemberRowFull {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  brand_id: string | null;
  company_id: string | null;
  status: string;
  approval_hkd: string | null;
  approval_sgd: string | null;
  version: number;
  brand_name?: string | null;
  company_name?: string | null;
}

export async function memberRow(id: string): Promise<MemberRowFull | null> {
  const row = await one<MemberRowFull>(
    `SELECT m.*, b.name AS brand_name, c.name AS company_name
     FROM members m LEFT JOIN brands b ON b.id = m.brand_id LEFT JOIN companies c ON c.id = m.company_id
     WHERE m.id = $1`,
    [id],
  );
  return row;
}

/** Member projection for the directory, shaped by the caller's role. */
export function projectMemberFor(caller: Member, row: MemberRowFull): Record<string, unknown> {
  if (STUDIO_ROLES.includes(caller.role)) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      organisation:
        row.role === 'client_approver' ? row.brand_name ?? '' : row.role === 'contractor' ? row.company_name ?? '' : 'Marrow Hall Interiors',
      status: row.status,
      approvalLimits:
        row.role === 'project_lead'
          ? { HKD: row.approval_hkd === null ? null : parseInt(row.approval_hkd, 10), SGD: row.approval_sgd === null ? null : parseInt(row.approval_sgd, 10) }
          : null,
      version: row.version,
    };
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    organisation:
      row.role === 'client_approver' ? row.brand_name ?? '' : row.role === 'contractor' ? row.company_name ?? '' : 'Marrow Hall Interiors',
  };
}
