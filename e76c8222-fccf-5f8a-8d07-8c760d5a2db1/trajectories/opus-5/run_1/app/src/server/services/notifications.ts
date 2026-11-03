import { formatCents, formatQuarterHours } from '../../shared/money';
import { Quote } from '../../shared/types';
import { agencyClock, agencyDateOf, agencyDayHeading } from '../../shared/time';
import { config } from '../env';
import { RequestRow } from '../domain/requests';
import { OutboxMessage } from './mail';

type Composed = Omit<OutboxMessage, 'dedupeKey'>;

function whenLine(request: RequestRow): string {
  return `Times: ${agencyClock(request.start_at)}-${agencyClock(request.end_at)} Eastern Time`;
}

function requestLines(request: RequestRow): string[] {
  return [
    `Request: ${request.ref} - ${request.title}`,
    `Organisation: ${request.org_name}`,
    `Setting: ${request.setting}`,
    `Date: ${agencyDayHeading(request.start_at)} (${agencyDateOf(request.start_at)})`,
    whenLine(request),
    `Location: ${request.location}`,
  ];
}

export function offerEmail(input: {
  request: RequestRow;
  seatPosition: number;
  seatTotal: number;
  interpreterName: string;
  interpreterEmail: string;
  expiresAt: Date;
  token: string;
}): Composed {
  const { request } = input;
  const body = [
    `Hello ${input.interpreterName},`,
    '',
    'Fernhollow Access Dispatch has an interpreting offer for you.',
    '',
    ...requestLines(request),
    `Seat: ${input.seatPosition} of ${input.seatTotal}`,
    `Offer expires: ${agencyDateOf(input.expiresAt)} ${agencyClock(input.expiresAt)} Eastern Time`,
    '',
    'Accept or decline here:',
    `${config.publicUrl}/offers/${input.token}`,
    '',
    'Fernhollow Access Dispatch',
  ].join('\n');
  return {
    toEmail: input.interpreterEmail,
    toName: input.interpreterName,
    subject: `Offer for ${request.ref} on ${agencyDateOf(request.start_at)}`,
    body,
  };
}

export function staffedEmail(input: {
  request: RequestRow;
  requesterName: string;
  requesterEmail: string;
  seatedNames: readonly string[];
}): Composed {
  const body = [
    `Hello ${input.requesterName},`,
    '',
    `${input.request.ref} is fully staffed.`,
    '',
    ...requestLines(input.request),
    '',
    'Interpreters:',
    ...input.seatedNames.map((name) => `- ${name}`),
    '',
    'Fernhollow Access Dispatch',
  ].join('\n');
  return {
    toEmail: input.requesterEmail,
    toName: input.requesterName,
    subject: `Staffed: ${input.request.ref} on ${agencyDateOf(input.request.start_at)}`,
    body,
  };
}

export function cancellationEmail(input: {
  request: RequestRow;
  interpreterName: string;
  interpreterEmail: string;
  quote: Quote;
}): Composed {
  const chargeLine = input.quote.late
    ? `Late cancellation. Charge per interpreter: $${input.quote.fee_per_interpreter}`
    : 'On-time cancellation. No charge.';
  const body = [
    `Hello ${input.interpreterName},`,
    '',
    `${input.request.ref} has been cancelled.`,
    '',
    ...requestLines(input.request),
    '',
    chargeLine,
    '',
    'Fernhollow Access Dispatch',
  ].join('\n');
  return {
    toEmail: input.interpreterEmail,
    toName: input.interpreterName,
    subject: `Cancelled: ${input.request.ref} on ${agencyDateOf(input.request.start_at)}`,
    body,
  };
}

export function credentialWarningEmail(input: {
  interpreterName: string;
  interpreterEmail: string;
  type: string;
  number: string;
  expiresOn: string;
}): Composed {
  const body = [
    `Hello ${input.interpreterName},`,
    '',
    `Your ${input.type} credential ${input.number} expires on ${input.expiresOn}.`,
    'Dispatch cannot offer you assignments that end after that date until you renew it.',
    '',
    'Fernhollow Access Dispatch',
  ].join('\n');
  return {
    toEmail: input.interpreterEmail,
    toName: input.interpreterName,
    subject: `Credential expiring: ${input.type} on ${input.expiresOn}`,
    body,
  };
}

export function timesheetApprovedEmail(input: {
  request: RequestRow;
  requesterName: string;
  requesterEmail: string;
  interpreterName: string;
  billedQuarters: number;
  amountCents: number;
}): Composed {
  const body = [
    `Hello ${input.requesterName},`,
    '',
    `The timesheet for ${input.request.ref} has been approved.`,
    '',
    ...requestLines(input.request),
    `Interpreter: ${input.interpreterName}`,
    `Billed hours: ${formatQuarterHours(input.billedQuarters)}`,
    `Amount: $${formatCents(input.amountCents)}`,
    '',
    'Fernhollow Access Dispatch',
  ].join('\n');
  return {
    toEmail: input.requesterEmail,
    toName: input.requesterName,
    subject: `Timesheet approved: ${input.request.ref}`,
    body,
  };
}
