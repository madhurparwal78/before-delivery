import type { DocumentStatus, RecipientStatus, Role } from './types.ts';

export const STATUS_WORD: Record<DocumentStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  sealing: 'Sealing',
  completed: 'Completed',
  declined: 'Declined',
  voided: 'Voided',
};

export const ROW_WORD_SENT: Record<RecipientStatus, string> = {
  waiting: 'Waiting',
  invited: 'Invited',
  viewed: 'Viewed',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Link expired',
};

export const ROW_WORD_HELD = 'Not delivered yet';

export const ROLE_WORD: Record<Role, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
};

export const UPLOAD_REFUSAL: Record<string, string> = {
  not_a_pdf: 'That file is not a PDF.',
  pdf_encrypted: "Password-protected PDFs can't be uploaded.",
  pdf_has_scripts: "PDFs with scripts can't be uploaded.",
  pdf_rotated: "Rotated pages aren't supported. Upload a PDF with upright pages.",
  too_many_pages: 'This PDF has more than 60 pages.',
  too_large: 'This PDF is larger than 25 MB.',
  storage_unavailable: 'File storage is unavailable. Your PDF was not uploaded.',
};

export const VALIDATION = {
  title: 'Enter a title of 1 to 120 characters.',
  timeZone: 'Choose a valid time zone.',
  file: 'Choose a PDF to upload.',
  name: 'Enter a name.',
  emailInvalid: 'Enter a valid email address.',
  emailDuplicate: 'This email is already a signer on this document.',
  recipients: 'A document can have at most 10 signers.',
  kind: 'Choose signature, initials, date or text.',
  label: 'Enter a label of 1 to 40 characters.',
  geometry: 'Fields must lie inside the page and be at least 0.02 by 0.02.',
  value: 'Text can be at most 200 characters.',
  typed: 'Enter 1 to 100 characters.',
  strokes: 'Draw at least one stroke of at most 5,000 points.',
  reasonVoidEmpty: 'Enter a reason for voiding.',
  reasonDeclineEmpty: 'Enter a reason for declining.',
  reasonTooLong: 'Reason can be at most 500 characters.',
  signers: 'Enter a name and a valid email address for every signer.',
} as const;

export const GENERIC_ERROR = 'Something went wrong. Try again.';
export const SIGN_IN_ERROR = 'Email or password is incorrect.';
export const LAST_OWNER_ERROR = 'A team needs at least one owner.';
export const REMINDER_MAIL_ERROR = 'Email is unavailable. Try the reminder again later.';

export const MAIL_NOTICE = 'Email is unavailable. Invitations are held and sent when email recovers.';
export const STORAGE_NOTICE =
  'File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.';

export const PAGES_UNAVAILABLE_HEADING = "Pages can't be shown right now";
export const PAGES_UNAVAILABLE_BODY =
  'File storage is unavailable. Your document and its fields are safe.';

export const NOT_FOUND_HEADING = 'Document not found';
export const NOT_FOUND_BODY = 'Check the link, or ask your team owner.';

export const PENDING = {
  upload: (fileName: string) => `Uploading ${fileName}...`,
  send: 'Sending...',
  remind: 'Sending reminder...',
  newLink: 'Issuing a new link...',
  void: 'Voiding...',
  finish: 'Signing...',
  decline: 'Declining...',
} as const;

export const ANNOUNCE = {
  documentUpdate: (title: string, statusWord: string) => `${title}: ${statusWord}`,
  fieldPosition: (
    label: string,
    page: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string =>
    `${label}: page ${page}, x ${x.toFixed(3)}, y ${y.toFixed(3)}, width ${w.toFixed(3)}, height ${h.toFixed(3)}`,
  reordered: (name: string, k: number, n: number) => `${name} is now signer ${k} of ${n}`,
  sent: (name: string) => `Sent for signing. ${name} has the first turn.`,
  newLink: (name: string) => `New link issued for ${name}.`,
  reminderSent: (name: string) => `Reminder sent to ${name}.`,
  requiredField: (i: number, n: number, label: string, page: number) =>
    `Field ${i} of ${n}: ${label}, page ${page}`,
  optionalField: (label: string, page: number) => `Optional field: ${label}, page ${page}`,
  roleChanged: (roleWord: string) => `Your role is now ${roleWord}.`,
} as const;

export const BANNER = {
  declined: (name: string, reason: string) => `${name} declined: ${reason}`,
  voided: (voiderName: string, reason: string) => `Voided by ${voiderName}: ${reason}`,
} as const;

export const COUNTER = {
  text: (n: number) => `${n} of 200 characters`,
  reason: (n: number) => `${n} of 500 characters`,
} as const;

export const MISSING_SIGNATURE_FIELDS = (names: string[]): string =>
  `Every signer needs a signature field. Missing: ${names.join(', ')}`;

export const INCOMPLETE_FIELDS = (n: number): string => `Complete ${n} required fields first.`;

export const NEXT_REMINDER = (stamp: string, timeZone: string): string =>
  `Next reminder after ${stamp} ${timeZone}`;

export interface LinkPageCopy {
  heading: string;
  body: string[];
}

export const SIGN_PAGE = {
  signedWaiting: (title: string, name: string, k: number, n: number): LinkPageCopy => ({
    heading: `You signed ${title}`,
    body: [`Waiting for ${name} (signer ${k} of ${n}).`],
  }),
  sealing: (title: string): LinkPageCopy => ({
    heading: `You signed ${title}`,
    body: ['Your signature is recorded. The completed PDF will be emailed once it is sealed.'],
  }),
  completed: (title: string): LinkPageCopy => ({
    heading: `${title} is complete`,
    body: ['Everyone has signed.'],
  }),
  declined: (name: string, isDecliner: boolean): LinkPageCopy => ({
    heading: isDecliner ? 'You declined this document' : 'This document was declined',
    body: [`${name} declined to sign. No further signatures are needed.`],
  }),
  voided: (senderName: string, reason: string): LinkPageCopy => ({
    heading: 'This document was voided',
    body: [`${senderName} voided it: ${reason}`],
  }),
  expired: (senderName: string): LinkPageCopy => ({
    heading: 'This link has expired',
    body: [`Ask ${senderName} to send a new link.`],
  }),
  unknown: (): LinkPageCopy => ({
    heading: 'This link is not valid',
    body: ['Check that you copied the whole link.'],
  }),
} as const;

export const FILTER_TAB_LABEL: Array<{ id: import('./types.ts').DocumentFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'closed', label: 'Declined or voided' },
];

export const KIND_WORD: Record<import('./types.ts').FieldKind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date',
  text: 'Text',
};
