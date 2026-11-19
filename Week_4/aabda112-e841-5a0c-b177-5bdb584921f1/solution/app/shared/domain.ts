/** Vocabulary shared by the server and the browser. Rules live on the server; these are labels and shapes only. */
export const ROLES = ['front-desk', 'nurse', 'vet', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  'front-desk': 'Front desk',
  nurse: 'Nurse',
  vet: 'Vet',
  manager: 'Manager',
};

export const APPOINTMENT_STATUS_LABEL = {
  booked: 'Booked',
  'checked-in': 'Checked in',
  'in-consult': 'In consult',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS_LABEL;

export const APPOINTMENT_REASONS = ['Consult', 'Vaccination', 'Surgery'] as const;
export type AppointmentReason = (typeof APPOINTMENT_REASONS)[number];

export const SPECIES = ['dog', 'cat', 'rabbit', 'other'] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_LABEL: Record<Species, string> = { dog: 'Dog', cat: 'Cat', rabbit: 'Rabbit', other: 'Other' };

export const FILE_KINDS = ['xray', 'wound', 'lab', 'consent', 'profile'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  xray: 'X-ray',
  wound: 'Wound photo',
  lab: 'Lab report',
  consent: 'Consent form',
  profile: 'Profile photo',
};

export const PUBLIC_REASONS = ['Check-up', 'Vaccination', 'Limping or injury', 'Off their food'] as const;
export type PublicReason = (typeof PUBLIC_REASONS)[number];

export const STOCK_REASON_LABEL = {
  receive: 'Received',
  expired: 'Expired',
  'invoice-line': 'Invoice line',
  return: 'Returned',
} as const;
export type StockReason = keyof typeof STOCK_REASON_LABEL;

export const INVOICE_STATUS_LABEL = {
  draft: 'Draft',
  issued: 'Unpaid',
  'part-paid': 'Part paid',
  paid: 'Paid',
  voided: 'Voided',
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS_LABEL;

export type TreatmentStatus = 'upcoming' | 'due' | 'overdue' | 'given' | 'skipped';

export const KENNELS = Array.from({ length: 12 }, (_, i) => `K${i + 1}`);

/** What each role may do (brief: Permissions). The one table; both sides read it. */
export type Permission =
  | 'appointments.write'
  | 'consult.run'
  | 'ward.act'
  | 'files.write'
  | 'invoices.read'
  | 'invoices.write'
  | 'payments.take'
  | 'stock.write'
  | 'staff.manage';

const PERMISSIONS: Record<Permission, readonly Role[]> = {
  'appointments.write': ['front-desk', 'vet', 'manager'],
  'consult.run': ['vet', 'manager'],
  'ward.act': ['nurse', 'vet', 'manager'],
  'files.write': ['vet', 'nurse', 'manager'],
  'invoices.read': ['front-desk', 'vet', 'manager'],
  'invoices.write': ['vet', 'manager'],
  'payments.take': ['front-desk', 'manager'],
  'stock.write': ['manager'],
  'staff.manage': ['manager'],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(role);
}

/** Events the live feed carries. The browser refetches the named resource; payloads only carry what refetching cannot. */
export type LiveEvent =
  | { t: 'calendar' }
  | { t: 'queue' }
  | { t: 'ward' }
  | { t: 'overdue'; total: number; patient: string; treatment: string; due: string }
  | { t: 'stock' }
  | { t: 'low'; item: string; usable: number }
  | { t: 'note'; appointmentId: string }
  | { t: 'invoices' }
  | { t: 'patients' }
  | { t: 'staff' }
  | { t: 'role'; userId: string }
  | { t: 'removed'; userId: string }
  | { t: 'bookings' };
