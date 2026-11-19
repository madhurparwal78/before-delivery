import { config } from "../config";
import type { ReturnView } from "../../shared/types";
import type { Lead } from "../domain/reminders";

export interface Message { subject: string; body: string }

const name = (r: ReturnView): string => `${r.client.name} ${r.state} ${r.period_label}`;
const link = (r: ReturnView): string => `${config.publicUrl}/returns/${r.id}`;
const figures = (r: ReturnView): string => `Gross sales ${r.gross_sales}\nTax due ${r.tax_due}`;

export const reminderMessage = (r: ReturnView, lead: Lead): Message => ({
  subject: `${name(r)} due in ${lead === 1 ? "1 day" : "7 days"}`,
  body: `The return for ${name(r)} is not filed yet.\n\n${r.due_line}\n\nOpen it: ${link(r)}\n`,
});

export const approvalRequest = (r: ReturnView, owner: string, bookkeeper: string): Message => ({
  subject: `Please approve ${name(r)}`,
  body: `Hello ${owner},\n\n${bookkeeper} prepared these figures for ${name(r)}.\n\n${figures(r)}\n${r.due_line}\n\nReview and approve: ${link(r)}\n`,
});

export const approvedNotice = (r: ReturnView, owner: string): Message => ({
  subject: `${r.client.name} approved ${r.state} ${r.period_label}`,
  body: `${owner} approved ${name(r)}.\n\n${figures(r)}\n${r.due_line}\n\nOpen it: ${link(r)}\n`,
});

export const sentBackNotice = (r: ReturnView, owner: string, reason: string): Message => ({
  subject: `${r.client.name} sent back ${r.state} ${r.period_label}`,
  body: `${owner} sent back ${name(r)}.\n\nReason: ${reason}\n\nOpen it: ${link(r)}\n`,
});

export const filedNotice = (r: ReturnView): Message => ({
  subject: `${name(r)} was filed`,
  body: `${name(r)} was filed.\n\n${r.due_line}\n${figures(r)}\n\nOpen it: ${link(r)}\n`,
});
