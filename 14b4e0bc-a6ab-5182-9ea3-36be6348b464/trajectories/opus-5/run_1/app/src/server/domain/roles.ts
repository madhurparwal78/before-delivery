import type { Role } from '../../shared/domain.ts';

export type Capability =
  | 'tag.write'
  | 'certification.write'
  | 'certification.reinstate'
  | 'ingestion.write'
  | 'glossary.write'
  | 'evidence.download'
  | 'admin';

const CAPABILITIES: Record<Capability, readonly Role[]> = {
  'tag.write': ['Steward', 'Admin'],
  'certification.write': ['Steward', 'Admin'],
  'certification.reinstate': ['Admin'],
  'ingestion.write': ['Steward', 'Admin'],
  'glossary.write': ['Steward', 'Admin'],
  'evidence.download': ['Admin', 'Steward', 'Analyst'],
  admin: ['Admin'],
};

export function allows(role: Role, capability: Capability): boolean {
  return CAPABILITIES[capability].includes(role);
}
