import type { QueuedEmail } from '../data/outbox.js';

export interface ReceiptInput {
  readonly to: string;
  readonly nurseName: string;
  readonly courseTitle: string;
  readonly cohortName: string | null;
  readonly learnerShare: string;
  readonly enrolmentId: string;
}

export function enrolmentReceipt(input: ReceiptInput): QueuedEmail {
  const lines = [
    `Hello ${input.nurseName},`,
    '',
    `Your enrolment in ${input.courseTitle} is confirmed.`,
  ];
  if (input.cohortName !== null) lines.push(`Cohort: ${input.cohortName}`);
  lines.push(`You paid $${input.learnerShare}`, `Enrolment id: ${input.enrolmentId}`, '', 'Sorrel & Pike Learning');
  return {
    kind: 'enrolment_receipt',
    dedupeKey: `enrolment_receipt:${input.enrolmentId}`,
    to: input.to,
    subject: `Credwell receipt: ${input.courseTitle}`,
    body: lines.join('\n'),
  };
}

export interface SeatInvitationInput {
  readonly to: string;
  readonly hospitalName: string;
  readonly courseTitle: string;
  readonly courseUrl: string;
  readonly assignmentId: string;
}

export function seatInvitation(input: SeatInvitationInput): QueuedEmail {
  return {
    kind: 'seat_invitation',
    dedupeKey: `seat_invitation:${input.assignmentId}`,
    to: input.to,
    subject: `Your Credwell seat: ${input.courseTitle}`,
    body: [
      `${input.hospitalName} has given you a seat in ${input.courseTitle}.`,
      '',
      `Start the course here: ${input.courseUrl}`,
      '',
      'Sorrel & Pike Learning',
    ].join('\n'),
  };
}

export interface CertificateEmailInput {
  readonly to: string;
  readonly nurseName: string;
  readonly courseTitle: string;
  readonly contactHours: string;
  readonly serial: string;
  readonly issuedOn: string;
  readonly downloadUrl: string;
  readonly certificateId: string;
  readonly version: number;
}

/** Certificate emails carry only the fields on the certificate-copy allow-list. */
export function certificateIssued(input: CertificateEmailInput): QueuedEmail {
  return {
    kind: 'certificate_issued',
    dedupeKey: `certificate_issued:${input.certificateId}`,
    to: input.to,
    subject: `Your Credwell certificate: ${input.courseTitle}`,
    body: [
      `Hello ${input.nurseName},`,
      '',
      `Your contact-hour certificate for ${input.courseTitle} is sealed.`,
      `Contact hours: ${input.contactHours}`,
      `Serial: ${input.serial}`,
      `Issued: ${input.issuedOn}`,
      '',
      `Download your certificate: ${input.downloadUrl}`,
      '',
      'Sorrel & Pike Learning',
    ].join('\n'),
  };
}

export function certificateReissued(input: CertificateEmailInput): QueuedEmail {
  return {
    kind: 'certificate_reissued',
    dedupeKey: `certificate_reissued:${input.certificateId}:${input.version}`,
    to: input.to,
    subject: `Your reissued Credwell certificate: ${input.courseTitle}`,
    body: [
      `Hello ${input.nurseName},`,
      '',
      `Your contact-hour certificate for ${input.courseTitle} has been reissued.`,
      `Contact hours: ${input.contactHours}`,
      `Serial: ${input.serial}`,
      `Issued: ${input.issuedOn}`,
      `Certificate version: ${input.version}`,
      '',
      `Download your certificate: ${input.downloadUrl}`,
      '',
      'Sorrel & Pike Learning',
    ].join('\n'),
  };
}
