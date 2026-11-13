import type { InvoiceStatus } from '../../shared/domain.js';

/** `overdue_at` is the first failed attempt plus OVERDUE_AFTER_SECONDS. */
export const overdueAtFor = (firstFailedAt: Date, overdueAfterSeconds: number): Date =>
  new Date(firstFailedAt.getTime() + overdueAfterSeconds * 1000);

/** A payment_failed invoice becomes overdue strictly after `overdue_at`. */
export const dueForOverdue = (
  status: InvoiceStatus,
  overdueAt: Date | null,
  now: Date,
): boolean => status === 'payment_failed' && overdueAt !== null && now.getTime() > overdueAt.getTime();

export const isPayable = (status: InvoiceStatus): boolean =>
  status === 'issued' || status === 'payment_failed' || status === 'overdue';

export const isVoidable = (status: InvoiceStatus): boolean =>
  status === 'draft' || status === 'issued' || status === 'payment_failed' || status === 'overdue';
