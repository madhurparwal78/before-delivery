export interface EditionJson {
  effective_date: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
}

export interface ReminderJson {
  lead_days: number;
  scheduled_for: string;
  sent_at: string | null;
  status: 'pending' | 'sent';
}

export interface ApprovalJson {
  action: 'approved' | 'sent_back';
  by: string;
  at: string;
  reason: string | null;
}

export interface AmendmentJson {
  at: string;
  by: string;
  note: string | null;
  original: { gross_sales: string; tax_due: string };
  amended: { gross_sales: string; tax_due: string };
}

export interface ReturnJson {
  id: string;
  client: { id: string; name: string };
  registration_id: string;
  state: string;
  state_name: string;
  zone: string;
  zone_label: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  period: string;
  period_label: string;
  status: string;
  status_label: string;
  overdue: boolean;
  awaiting_approval: boolean;
  version: number;
  gross_sales: string | null;
  tax_due: string | null;
  nominal_due_date: string;
  due_date: string;
  carried_from: string | null;
  due_at: string;
  due_line: string;
  local_deadline_label: string;
  practice_deadline_label: string;
  offset_hours: number;
  edition: EditionJson;
  approvals: ApprovalJson[];
  extension: {
    granted_at: string;
    extension_days: number;
    due_date_before: string;
    due_at_before: string;
  } | null;
  amendments: AmendmentJson[];
  filed_at: string | null;
  packet: 'none' | 'pending' | 'ready';
  packet_revisions: number;
  changed_by: string;
}

export interface UserJson {
  id: string;
  display_name: string;
  email: string;
  role: 'bookkeeper' | 'owner';
  client_id: string | null;
}

export interface MeJson {
  user: UserJson;
  practice_id: string;
  now: string;
  practice_zone: string;
  reminder_hour: number;
}

export interface StateJson {
  code: string;
  name: string;
  zone: string;
  zone_label: string;
  holidays: string[];
  editions: EditionJson[];
}

export interface RegistrationJson {
  id: string;
  state: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  first_period: string;
}

export interface ClientJson {
  id: string;
  name: string;
  owner: { id: string; display_name: string; email: string };
  registrations: RegistrationJson[];
}

export interface ReturnsEnvelope {
  returns: ReturnJson[];
  counts: { total: number; overdue: number; awaiting_approval: number };
}
