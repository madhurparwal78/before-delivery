// Every string the brief publishes, character for character, in one place.

export const FIELD_COPY = {
  thousands: 'Write the number without thousands separators, for example 1200,5.',
  badNumber: 'Enter a number such as 1,8.',
  badUnit: 'Choose one of the listed units.',
  siteName: 'Give the site a name of 1 to 80 characters without hidden or line-break characters.',
  wallSize: 'The wall must be from 1 to 100 metres wide and from 1 to 40 metres high.',
  showTime: 'Enter a date and time as YYYY-MM-DDTHH:mm.',
  readingTime: 'Give the capture time as an instant with its offset.',
  cell: "That cell isn't on this wall.",
  belowZero: "A reading can't be below zero.",
  reflectance: 'Reflectance runs above 0 and up to 1.',
  recess: 'Recess runs from 0 to 2 metres.',
  firstDay: "The first day can't be before today in Brussels.",
  days: 'A hire runs for 1 to 7 days.',
  zoom: 'This lens zooms from <min> to <max> to 1.',
  shift: 'This lens shifts up to <max>% that way.',
  obliquity: 'That throw hits the wall at <angle> degrees; the limit is 25.',
  aimGrid: 'Aim on a half-metre step.',
  overlap: 'No cell can sit under more than two bodies.',
  lens: "isn't on the shelf or at this site.",
  hours: 'Show hours must be above 0 and up to 1000.',
  limit: 'Ask for 1 to 200 at a time.',
  pixel: 'That point is outside the photo.',
  pointCount: 'Set exactly four points and one check point.',
  live: 'Say true or false.',
  operations: 'Send 1 to 500 readings at a time.',
  required: 'This is required.',
} as const;

export const PROBLEM_COPY = {
  hire_desk_unavailable: "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.",
  hire_desk_pending: "The hire desk isn't answering. Your hold stands and the confirmation is still being checked.",
  hire_release_unavailable: "The hire desk isn't answering. Your hold stands until it lapses.",
  press_unavailable: "The rig sheet press isn't answering. Your layout is unchanged; nothing has been issued.",
  sheet_store_unavailable: "The sheet store isn't answering. Your layout is unchanged; nothing has been issued.",
  wall_store_unavailable: "The wall store isn't answering. Your readings and layouts still work; the photo was not kept.",
  no_stock: 'The hire desk has no body free for those dates.',
  hold_lapsed: 'This hold has lapsed. Bodies drawn on it need a body again.',
  hold_not_held: 'This hold is no longer held.',
  quote_required: 'Quote this hold before confirming it.',
  quote_total_mismatch: "The hire desk's total of <provider total> differs from ours of <computed total>. Nothing can be confirmed.",
  serial_already_in_kit: "The hire desk offered a serial that's already in your kit.",
  serial_not_there: "That serial isn't where this movement starts.",
  serial_unknown: "That serial isn't in your kit.",
  serial_exists: 'That serial is already in your kit.',
  hired_in_by_hold_only: 'A hired body arrives through a confirmed hold.',
  reversal_not_possible: "That serial has moved since, so this movement can't be reversed.",
  body_in_issued_rig: '<serial> is already in an issued rig.',
  body_not_available: "<serial> isn't on the shelf or at this site.",
  body_already_in_layout: '<serial> is already in this layout.',
  layout_needs_bodies: '<n> placements still need a confirmed body.',
  circuit_overloaded: 'Circuit <name> is overloaded: <load> W on <capacity> W.',
  sheet_already_issued: 'This layout already has an issued sheet.',
  sheet_withdrawn: 'This sheet has been withdrawn.',
  link_not_found: "This rig sheet link doesn't exist.",
  link_ended: 'This rig sheet link has ended. Ask the projection artist for a new one.',
  link_window_over: "This sheet's link window is over.",
  link_rate_limited: 'Too many requests on this link. Try again shortly.',
  photo_missing: 'Upload a wall photo first.',
  photo_not_image: "That file isn't a JPEG or PNG photo, whatever its name says.",
  photo_too_large: 'That photo is over the 40,000,000 byte limit.',
  residual_too_high: 'Those points disagree by <residual> m; the limit is 0.050 m.',
  points_degenerate: "Three of those points lie on one line, so they can't fix the wall.",
  job_finished: 'This mask job has already finished.',
  layout_changed: 'This layout changed in another window. Reload it to carry on.',
  precondition_required: "This change needs the layout's current version.",
  idempotency_key_required: 'This action needs an Idempotency-Key header.',
  idempotency_key_reused: 'That Idempotency-Key was already used for a different request.',
  origin_refused: 'This request came from another site.',
  unknown_field: 'Unknown field: <field>.',
  validation_failed: 'Some fields need fixing.',
  malformed_body: "That request body couldn't be read.",
  unsupported_media_type: 'This request must be JSON.',
  body_too_large: 'That request body is too large.',
  method_not_allowed: "That method isn't allowed here.",
  not_found: 'Nothing here.',
  database_unavailable: "The workspace can't reach its records right now. Try again shortly.",
  internal_error: 'Something went wrong on our side.',
} as const;

export const operation_id_reused = "This operation was already used for a different reading.";

export const PROBLEM_TITLES: { [code: string]: string } = {
  hire_desk_unavailable: 'Hire desk unavailable',
  hire_desk_pending: 'Hire desk pending',
  hire_release_unavailable: 'Hire desk unavailable',
  press_unavailable: 'Rig sheet press unavailable',
  sheet_store_unavailable: 'Sheet store unavailable',
  wall_store_unavailable: 'Wall store unavailable',
  no_stock: 'No stock',
  hold_lapsed: 'Hold lapsed',
  hold_not_held: 'Hold no longer held',
  quote_required: 'Quote required',
  quote_total_mismatch: 'Quote total mismatch',
  serial_already_in_kit: 'Serial already in kit',
  serial_not_there: 'Serial not there',
  serial_unknown: 'Serial unknown',
  serial_exists: 'Serial exists',
  hired_in_by_hold_only: 'Hired in by hold only',
  reversal_not_possible: 'Reversal not possible',
  body_in_issued_rig: 'Body already in an issued rig',
  body_not_available: 'Body not available',
  body_already_in_layout: 'Body already in this layout',
  layout_needs_bodies: 'Layout needs bodies',
  circuit_overloaded: 'Circuit overloaded',
  sheet_already_issued: 'Sheet already issued',
  sheet_withdrawn: 'Sheet withdrawn',
  link_not_found: 'Link not found',
  link_ended: 'Link ended',
  link_window_over: 'Link window over',
  link_rate_limited: 'Link rate limited',
  photo_missing: 'Photo missing',
  photo_not_image: 'Photo is not an image',
  photo_too_large: 'Photo too large',
  residual_too_high: 'Residual too high',
  points_degenerate: 'Points degenerate',
  job_finished: 'Job finished',
  layout_changed: 'Layout changed',
  precondition_required: 'Precondition required',
  idempotency_key_required: 'Idempotency key required',
  idempotency_key_reused: 'Idempotency key reused',
  origin_refused: 'Origin refused',
  unknown_field: 'Unknown field',
  validation_failed: 'Validation failed',
  malformed_body: 'Malformed body',
  unsupported_media_type: 'Unsupported media type',
  body_too_large: 'Body too large',
  method_not_allowed: 'Method not allowed',
  not_found: 'Not found',
  database_unavailable: 'Database unavailable',
  internal_error: 'Internal error',
};

export function problemDetail(
  code: string,
  params: { [key: string]: string } = {},
): string {
  const template = (PROBLEM_COPY as { [code: string]: string })[code] ?? code;
  return fillTemplate(template, params);
}

export function fillTemplate(template: string, params: { [key: string]: string }): string {
  return template.replace(/<([a-zA-Z ]+)>/g, (whole: string, name: string): string =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name]! : whole,
  );
}

export const STALE_SENTENCE = 'These readings are stale; street lighting and foliage change.';

export const BAND_COPY = {
  washedOut: 'Washed out',
  readsAsGraphics: 'Reads as graphics',
  readsAsImage: 'Reads as image',
  noReading: 'No reading',
} as const;

export const STATUS_COPY = {
  syncWaiting: 'Waiting to sync <n>',
  syncNeedsFixing: 'Needs fixing <n>',
  syncSending: 'Sending readings',
  rectifySuccess: 'Rectified to <residual> m.',
  kitSuccess: 'Movement recorded.',
  hirePending: 'Asking the hire desk',
  hireHeld: 'Held for <mm:ss>',
  hireAskedUnsettled: 'Asked; still checking with the hire desk',
  hireHired: 'Hired in. <serial> is on your shelf.',
  hireLapsed: 'This hold has lapsed. Bodies drawn on it need a body again.',
  hireReleased: 'Released.',
  hireQuote: 'Quote <total> including 21% VAT.',
  issuePending: 'Issuing the rig sheet',
  issueSuccess: 'Issued.',
  masksProgress: '<phase>: <done> of <total>',
  masksStoreDown: "The sheet store isn't answering. The mask bundle will carry on when it returns.",
  rigTick: '<circuit name> marked live.',
  rigUntick: '<circuit name> marked not live.',
  outOfStep: 'This sheet is out of step with the layout. Ask the artist before rigging.',
} as const;

export function statusCopy(key: keyof typeof STATUS_COPY, params: { [key: string]: string } = {}): string {
  return fillTemplate(STATUS_COPY[key], params);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '€ -' : '€ ';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${euros},${String(rem).padStart(2, '0')}`;
}

export function formatMmSS(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
