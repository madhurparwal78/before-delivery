const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates arrive as calendar dates already in the provider's time zone. */
export function formatProviderDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (year === undefined || month === undefined || day === undefined) return date;
  const monthName = MONTHS[Number.parseInt(month, 10) - 1] ?? month;
  return `${monthName} ${Number.parseInt(day, 10)}, ${year}`;
}

export function closeLine(closeDate: string): string {
  return `Enrolment closes ${formatProviderDate(closeDate)} at 11:59 PM CT`;
}

export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  if (year === undefined || index === undefined) return month;
  return `${MONTHS[Number.parseInt(index, 10) - 1] ?? index} ${year}`;
}

const PROVIDER_TIME_ZONE = 'America/Chicago';

const calendarDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROVIDER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the provider's time zone, for the coverage effective-from default. */
export function providerToday(): string {
  return calendarDate.format(new Date());
}

/** The provider-time calendar date of an instant, never the UTC one. */
export function providerDateOf(instant: string): string {
  return calendarDate.format(new Date(instant));
}

export function formatInstantDate(instant: string): string {
  return formatProviderDate(providerDateOf(instant));
}

export function fundingLabel(funding: string, sponsorName: string | null): string {
  if (funding === 'seat') return `${sponsorName ?? 'Hospital'} seat`;
  if (funding === 'co_pay') return `Card + ${sponsorName ?? 'hospital'}`;
  return 'Your card';
}

export const COURSE_STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

export const ENROLMENT_STATE_LABELS: Record<string, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  completed: 'Completed',
  certified: 'Certified',
  refunded: 'Refunded',
  withdrawn: 'Withdrawn',
};

export const CERTIFICATE_STATE_LABELS: Record<string, string> = {
  sealing: 'Pending',
  sealed: 'Sealed',
  revoked: 'Revoked',
};
