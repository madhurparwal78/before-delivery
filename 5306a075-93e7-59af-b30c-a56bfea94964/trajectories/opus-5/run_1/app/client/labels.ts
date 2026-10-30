import type { FeatureStatus, Importance, NoteSource, Role } from '../shared/types';

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  candidate: 'Candidate',
  planned: 'Planned',
  in_progress: 'In progress',
  released: 'Released',
  archived: 'Archived',
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  nice_to_have: 'Nice to have',
  important: 'Important',
  critical: 'Critical',
};

export const SOURCE_LABELS: Record<NoteSource, string> = {
  support_ticket: 'Support ticket',
  sales_call: 'Sales call',
  email: 'Email',
  csv_import: 'CSV import',
};

export const ROLE_LABELS: Record<Role, string> = {
  head_of_product: 'Head of product',
  product_manager: 'Product manager',
  customer_success: 'Customer success',
};

export const RELEASE_STATUS_LABELS = { open: 'Open', frozen: 'Frozen', shipped: 'Shipped' } as const;
