/**
 * Every published copy string in Boltrope lives here, and nowhere else.
 * Shared by the server and the browser bundle.
 */

export const ERROR_COPY = {
  unauthenticated: 'Sign in to continue.',
  bad_credentials: 'That email and password do not match an account.',
  not_found: 'Not found.',
  forbidden: 'Your role cannot do that.',
  no_cutting_authority: 'You hold no cutting authority right now.',
  no_authority_on_claim_date: 'You held no cutting authority when this length was claimed.',
  role_change_forbidden: 'Roles cannot be changed from the console.',
  precondition_required: 'Reload before saving.',
  stale_revision: 'Someone saved this first. Reload to see their change.',
  sealed: 'This drawing is sealed. Revise it to change anything.',
  wrong_state: 'That cannot be done in the current state.',
  remeasure_required: 'Remeasure the flagged dimensions before drawing this sail.',
  not_nested: 'Lay every panel before confirming a cut.',
  claim_empty: 'Lay a panel on this hold before cutting it.',
  claim_lapsed: 'This hold has lapsed. Claim the length again before cutting.',
  claim_closed: 'This hold is already closed.',
  already_cut: 'This length has already been cut.',
  idempotency_key_reused: 'That confirmation key belongs to another request.',
  already_issued: 'This cut sheet has already been issued.',
  already_revised: 'This drawing already has a revision.',
  already_decided: 'This submission has already been decided.',
  not_accepted: 'Only an accepted submission can be reversed.',
  account_in_use: 'This account still owns boats.',
  email_taken: 'An account already uses that email.',
  photo_exists: 'This measurement already has its tape photo.',
  exceeds_balance: 'That is more than the balance left on this sail.',
  invalid: 'Check the highlighted fields.',
  too_large: 'That is larger than the loft accepts.',
  unsupported_media: 'That content type is not accepted here.',
} as const;

export type SimpleErrorCode = keyof typeof ERROR_COPY;

export const claimConflictCopy = (winnerDisplayName: string): string =>
  `${winnerDisplayName} claimed this length first. Choose another roll or offcut.`;

export const layOverlapCopy = (panel: number, other: number): string =>
  `Panel ${panel} overlaps panel ${other}. Nothing was laid.`;

export const panelLaidCopy = (panel: number): string => `Panel ${panel} is already laid.`;

export const rateLimitedCopy = (seconds: number): string =>
  `Too many requests from this account. Try again in ${seconds} seconds.`;

export const OUTAGE_COPY = {
  issuing: 'The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.',
  ownerSheet: 'The cut-sheet store is not answering. Try again in a few minutes.',
  photo: 'The cut-sheet store is not answering. The tape photo was not saved.',
  identity: 'Sign-in is not answering. Try again in a minute.',
  database: 'The loft records are not answering. Try again in a minute.',
} as const;

export const FIELD_COPY = {
  required: 'Required.',
  lengthRange: 'Enter whole millimetres from 1 to 60000.',
  inchesMalformed: `Enter inches above 0 with up to two decimals, or feet and inches as 38' 1 1/2".`,
  bothOrNeither: 'Enter the figure in mm or in inches, not both.',
  looksLikeInches: 'That looks like inches. Enter millimetres.',
  badDate: 'Enter a date as YYYY-MM-DD.',
  badInstant: 'Enter a future instant as YYYY-MM-DDTHH:MM:SSZ.',
  lot: 'Enter a lot of 1 to 20 characters.',
  clothMismatch: 'This cloth does not match the drawing.',
  lotMismatch: 'This lot does not match the cloth already on this sail.',
  reasonRequired: 'Give a reason.',
  countReasonRequired: 'Give a reason for the difference.',
  reasonTooLong: 'Keep the reason to 200 characters or fewer.',
  badRotation: 'Turn 0 or 180 only.',
  amount: 'Enter an amount in pounds above 0 with up to two decimals.',
  cursorOtherFilter: 'This page belongs to another filter.',
  cursorInvalid: 'That page marker is not valid.',
  email: 'Enter an email address.',
  password: 'Enter a password of 12 to 128 characters.',
  positionTogether: 'Send x_mm, y_mm and rotation together, or none of them.',
  dimension: 'Choose one of I, J, P, E, LL and LP.',
  sail: 'Choose mainsail or headsail.',
  cloth: 'Choose a cloth from the list.',
  role: 'Choose yacht-owner or loft-hand.',
  ownerEmail: 'Choose an owner account.',
  loftHandEmail: 'Choose a loft hand account.',
  boat: 'Choose a boat from the list.',
  stock: 'Choose a roll or offcut from the list.',
  drawing: 'Choose a drawing from the list.',
  panelNumber: 'Choose a panel of this drawing.',
  decision: 'Choose accept or reject.',
} as const;

export const claimTooLongCopy = (stockCode: string): string => `Longer than the cloth left on ${stockCode}.`;
export const panelOffClothCopy = (panel: number): string => `Panel ${panel} runs off the cloth. Nothing was laid.`;
export const textLengthCopy = (min: number, max: number): string => `Enter ${min} to ${max} characters.`;
export const wholeNumberCopy = (min: number, max: number): string => `Enter a whole number from ${min} to ${max}.`;

export const BULK_REFUSAL_COPY = {
  already_decided: 'Already decided.',
  not_found: 'No such submission.',
  reason_required: 'Give a reason.',
  invalid_decision: 'Choose accept or reject.',
} as const;

export const PENDING_COPY = {
  claim: 'Claiming length...',
  cut: 'Confirming cut...',
  issue: 'Issuing cut sheet...',
  submission: 'Sending to the loft...',
  save: 'Saving...',
} as const;

export const layingPanelCopy = (panel: number): string => `Laying panel ${panel}...`;

export const EMPTY_COPY = {
  ledger: 'No cloth has moved on this stock yet.',
  ownerSheets: 'No cut sheet has been shared with you yet.',
  ownerBoats: 'No boat is on your account yet.',
  pendingSubmissions: 'Every submission has been decided.',
  floor: 'Nothing is assigned to you on the cutting floor.',
  draw: 'This sail has not been drawn yet.',
} as const;

export const OWNER_VIEWER_REFUSAL = 'That cut sheet is not shared with you.';
export const supersededBannerCopy = (code: string): string => `Superseded by ${code}.`;
export const SESSION_ENDED = 'Your session ended. Sign in to carry on.';
export const DELETED_ACCOUNT_NAME = 'Former account';
export const NOT_FOUND_HEADING = 'That page is not in the loft.';

export const STATUS_CHIP_LABELS = {
  measuring: 'Measuring',
  remeasure: 'Remeasure',
  drawn: 'Drawn',
  nested: 'Nested',
  cutting: 'Cutting',
  cut: 'Cut',
  pending_store: 'Pending store',
  issued: 'Issued',
  lapsed: 'Lapsed',
  measured: 'Measured',
} as const;

export const STANDING_CHIPS = {
  true_tape: 'True tape',
  steady_tape: 'Steady tape',
  new_tape: 'New tape',
} as const;

export const LANDING = {
  headline: 'BOLTROPE',
  action: 'Open the loft',
  label: 'A loft workbench for one sailmaker',
  area: '42.60 m² · 458.54 ft²',
  statement: 'The figure that ruins a sail is the one you misread.',
} as const;

export const stepCopy = (step: 'Measure' | 'Draw' | 'Nest'): string => `Finish the ${step} step first.`;

export const SUCCESS = {
  measurementSaved: 'Measurement saved.',
  measurementSavedRemeasure: (dimension: string, due: string): string =>
    `Measurement saved. ${dimension} needs remeasuring by ${due}.`,
  submissionSent: 'Submission sent to the loft.',
  drawn: (count: number): string => `Sail drawn: ${count} panels.`,
  claim: (mm: string, code: string, hhmm: string): string => `Holding ${mm} mm on ${code} until ${hhmm} UTC.`,
  lay: (panel: number, kind: string, code: string, mm: string, inches: string): string =>
    `Panel ${panel} laid on ${kind} ${code}. ${mm} mm (${inches} in) remaining.`,
  undo: (panel: number, kind: string, code: string): string => `Panel ${panel} lifted from ${kind} ${code}.`,
  turn: (panel: number, rotation: number): string => `Panel ${panel} turned to ${rotation}°.`,
  release: (code: string): string => `Hold released on ${code}.`,
  oneMinute: (code: string): string => `One minute left on the hold on ${code}.`,
  cut: (kind: string, code: string, mm: string, inches: string): string =>
    `Cut confirmed on ${kind} ${code}. ${mm} mm (${inches} in) remaining.`,
  cutOffcut: (code: string): string => ` Offcut ${code} added to the shelf.`,
  issued: 'Cut sheet issued.',
  grant: (owner: string): string => `Sight granted to ${owner}.`,
  withdraw: (owner: string): string => `Sight withdrawn from ${owner}.`,
  payment: (amount: string, balance: string): string => `Payment of £${amount} recorded. Balance £${balance}.`,
  creditNote: (amount: string, balance: string): string => `Credit note of £${amount} recorded. Balance £${balance}.`,
  countMatched: 'Count recorded. The ledger matches the shelf.',
  countAdjusted: (signed: string): string => `Count recorded with an adjustment of ${signed} mm².`,
  bulk: (applied: number, refused: number): string => `${applied} applied, ${refused} refused.`,
  accepted: (id: string): string => `Submission ${id} accepted.`,
  rejected: (id: string): string => `Submission ${id} rejected.`,
  reversed: (id: string): string => `Submission ${id} reversed.`,
  received: (code: string): string => `Roll ${code} received.`,
  accountCreated: (email: string): string => `Account created for ${email}.`,
  rulesetSaved: (version: number): string => `Rule set v${version} saved.`,
  standingLoad: (n: number, season: number): string =>
    n === 1 ? `1 owner in season ${season}.` : `${n} owners in season ${season}.`,
  queueAssignment: (code: string): string => `${code} is on your cutting floor.`,
  saved: 'Saved.',
} as const;

export const SAIL_ACCOUNT_LINES = [
  'Cloth charge',
  'Tax at 20%',
  'Total',
  'Deposit',
  'Paid',
  'Credit notes',
  'Balance',
] as const;

export const SAIL_ACCOUNT_CHIPS = {
  deposit_due: 'Deposit due',
  balance_due: 'Balance due',
  settled: 'Settled',
} as const;
