// The one table of published copy (brief: Feedback states, Messages M01 to M86).
// Placeholders are filled by the small functions below; nothing else in the app spells these sentences.

export const M01 = 'There is a problem with your answers';
export const M02 = (n: number): string => `There is a problem with your answers. ${n} to fix.`;
export const M03 = 'Error: ';
export const M04 = (n: number, m: number): string => `Page ${n} of ${m}`;
export const M05 = (n: number, m: number, title: string): string => `Page ${n} of ${m}: ${title}`;
export const M06 = '1 answer no longer applies and will not be sent.';
export const M07 = (n: number): string => `${n} answers no longer apply and will not be sent.`;
export const M08 = '1 earlier answer applies again.';
export const M09 = (n: number): string => `${n} earlier answers apply again.`;
export const M10 = '(not answered yet)';
export const M11 = 'Not calculated yet';
export const M12 = (label: string, text: string): string => `${label}: ${text}`;
export const M13 = (email: string, expiry: string): string => `We sent a link to ${email}. It works until ${expiry}.`;
export const M14 = 'Your answers are saved; the email will follow.';
export const M15 = (saved: string): string => `Welcome back. Your answers were saved on ${saved}.`;
export const M16 = (label: string): string =>
  `This form changed since you saved. 1 of your answers no longer applies: ${label}.`;
export const M17 = (n: number, labels: string): string =>
  `This form changed since you saved. ${n} of your answers no longer apply: ${labels}.`;
export const M18 = 'This form changed since you saved. All your answers still apply.';
export const M19 = 'This link has expired.';
export const M20 = 'This response has already been sent.';
export const M21 = 'This response was continued on another device. Open your emailed link to carry on.';
export const M22 = 'This form is closed';
export const M23 = (closes: string, zone: string): string => `This form closed at ${closes} (${zone}).`;
export const M24 = (n: number): string => `This form has reached its limit of ${n} responses.`;
export const M25 = 'This form is not taking responses.';
export const M26 = 'Your answers were not sent.';
export const M27 = 'Thank you. Your response was sent.';
export const M28 = (reference: string): string => `Reference: ${reference}`;
export const M29 = '(no answer)';
export const M30 = (name: string): string => `Uploading ${name}`;
export const M31 = (name: string, size: string): string => `Attached: ${name} (${size})`;
export const M32 = (label: string, types: string): string => `${label}: attach a ${types} file.`;
export const M33 = (label: string, n: string): string => `${label}: the file must be ${n} MB or smaller.`;
export const M34 = (name: string): string => `We could not store ${name}. Your other answers are safe. Try again.`;
export const M35 = (label: string): string => `Question added: ${label}.`;
export const M36 = (label: string): string => `Question removed: ${label}.`;
export const M37 = 'That key is already used.';
export const M38 = (item: string, n: number, m: number): string => `${item} moved to position ${n} of ${m}.`;
export const M39 = (option: string, n: number, m: number): string => `${option} picked up, position ${n} of ${m}.`;
export const M40 = (option: string, n: number, m: number): string => `${option} dropped at position ${n} of ${m}.`;
export const M41 = (option: string, n: number, m: number): string =>
  `Move cancelled. ${option} is back at position ${n} of ${m}.`;
export const M42 = (n: number): string => `Edition ${n} is live.`;
export const M43_44 = (n: number): string => (n === 1 ? 'Fix 1 problem before publishing.' : `Fix ${n} problems before publishing.`);
export const M45 = (lit: number, all: number, label: string, text: string): string =>
  `Path: ${lit} of ${all} pages shown, ${label} ${text}`;
export const M46 = (lit: number, all: number): string => `Path: ${lit} of ${all} pages shown`;
export const M47 = (rule: string): string => `Skipped by: ${rule}`;
export const M48 = 'Settings saved.';
export const M49 = 'The form is now closed.';
export const M50 = (email: string): string => `Invitation sent to ${email}.`;
export const M51 = (names: string): string => `Also editing: ${names}`;
export const M52 = (name: string, field: string, key: string): string =>
  `${name} changed ${field} on ${key} at the same time. Their version is kept.`;
export const M53 = 'Live editing is paused. Save to keep your changes.';
export const M54 = 'Changes saved.';
const M55 = '1 response';
const M56 = (n: number): string => `${n} responses`;
export const M55_56 = (n: number): string => (n === 1 ? M55 : M56(n));
export const M57 = (a: string, n: string): string => `Answered: ${a} of ${n}`;
export const M58_MEAN = (x: string): string => `Mean ${x}`;
export const M58_LOWEST = (x: string): string => `Lowest ${x}`;
export const M58_HIGHEST = (x: string): string => `Highest ${x}`;
export const M59 = 'Live updates are paused. Reload for the latest numbers.';
const M60 = 'Export ready: 1 response.';
const M61 = (n: number): string => `Export ready: ${n} responses.`;
export const M60_61 = (n: number): string => (n === 1 ? M60 : M61(n));
export const M62 = 'The export could not be stored. Try again.';
export const M63 = 'Response deleted.';
export const M64 = 'Email or password is wrong.';
export const M65 = 'Not found.';
export const M66 = 'Too many requests. Try again later.';
export const M67 = 'Sign in to continue.';
export const M68 = 'Check the highlighted fields.';
export const M69 = 'This request was already used with different answers.';
export const M70 = 'That answer does not fit this question.';
export const M71 = 'The request is too large.';
export const M72 = 'This form is already open.';
export const M73 = 'Publish the form first.';
export const M74 = 'Enter your name.';
export const M75 = 'Enter an email address like name@example.com.';
export const M76 = 'Use at least 8 characters.';
export const M77 = 'An account with this email already exists.';
export const M78 = 'Enter a form title.';
export const M79 = 'Enter the closing time as YYYY-MM-DD HH:MM.';
export const M80 = 'Enter a whole number of 1 or more.';
export const M81 = 'Choose an email question.';
export const M82 = 'Use lower-case letters, digits and underscores, starting with a letter.';
export const M83 = 'No forms yet. Start one with New form.';
export const M84 = 'No responses yet.';
export const M85 = 'That question was removed by another editor.';
export const M86 = 'Send an Idempotency-Key header.';

// Field checks (brief: Checks). The label is the question's label with insertions filled.
export const CHECK = {
  requiredText: (label: string): string => `${label}: answer this question.`,
  requiredChoice: (label: string): string => `${label}: choose an option.`,
  requiredCheckbox: (label: string): string => `${label}: tick at least one option.`,
  requiredGrid: (label: string): string => `${label}: choose an option in every row.`,
  requiredRanking: (label: string): string => `${label}: move at least one option to set your order.`,
  requiredDate: (label: string): string => `${label}: enter a date.`,
  requiredFile: (label: string): string => `${label}: attach a file.`,
  numberFormat: (label: string): string => `${label}: enter a number.`,
  dateFormat: (label: string): string => `${label}: enter a real date as YYYY-MM-DD.`,
  minLength: (label: string, n: number): string => `${label}: use at least ${n} characters.`,
  maxLength: (label: string, n: number): string => `${label}: use at most ${n} characters.`,
  decimals: (label: string, n: number): string => `${label}: use at most ${n} decimal places.`,
  wholeNumber: (label: string): string => `${label}: enter a whole number.`,
  numberRange: (label: string, min: string, max: string): string => `${label}: enter a number from ${min} to ${max}.`,
  numberMin: (label: string, min: string): string => `${label}: enter a number from ${min} or more.`,
  numberMax: (label: string, max: string): string => `${label}: enter a number up to ${max}.`,
  dateRange: (label: string, min: string, max: string): string => `${label}: enter a date from ${min} to ${max}.`,
  dateMin: (label: string, min: string): string => `${label}: enter a date from ${min} or later.`,
  dateMax: (label: string, max: string): string => `${label}: enter a date up to ${max}.`,
  ticksRange: (label: string, min: number, max: number): string => `${label}: tick from ${min} to ${max} options.`,
  ticksMin: (label: string, min: number): string => `${label}: tick at least ${min} options.`,
  ticksMax: (label: string, max: number): string => `${label}: tick at most ${max} options.`,
  email: (label: string): string => `${label}: enter an email address like name@example.com.`,
  phone: (label: string): string => `${label}: enter digits, spaces and an optional leading +.`,
  digits: (label: string): string => `${label}: use digits only.`,
  letters: (label: string): string => `${label}: use letters only.`,
};

// Error codes of the one error shape (brief: API).
export type ErrorCode =
  | 'BODY_TOO_LARGE' | 'SIGN_IN_REQUIRED' | 'NOT_FOUND' | 'LINK_EXPIRED' | 'ALREADY_SENT' | 'RATE_LIMITED'
  | 'FORM_CLOSED' | 'DRAFT_MOVED' | 'ALREADY_SUBMITTED' | 'IDEMPOTENCY_CONFLICT' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'FORM_OPEN' | 'FORM_DRAFT' | 'VALIDATION_FAILED' | 'SIGN_IN_FAILED' | 'ANSWER_INVALID' | 'ANSWERS_INVALID'
  | 'CHANGE_INVALID' | 'DUPLICATE_KEY' | 'FORMULA_INVALID' | 'FORMULA_PROBLEMS' | 'SEED_INVALID'
  | 'FILE_TYPE' | 'FILE_TOO_LARGE' | 'UPLOAD_FAILED' | 'EXPORT_FAILED' | 'INTERNAL_ERROR';
