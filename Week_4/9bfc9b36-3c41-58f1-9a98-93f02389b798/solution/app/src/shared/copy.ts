/** Every published string lives here, once. */

export const REFUSALS = {
  unauthenticated: { status: 401, message: "Sign in to continue." },
  bad_credentials: { status: 401, message: "That email and password do not match an account." },
  not_found: { status: 404, message: "Not found." },
  forbidden: { status: 403, message: "Your role cannot do that." },
  no_cutting_authority: { status: 403, message: "You hold no cutting authority right now." },
  no_authority_on_claim_date: { status: 403, message: "You held no cutting authority when this length was claimed." },
  role_change_forbidden: { status: 403, message: "Roles cannot be changed from the console." },
  precondition_required: { status: 428, message: "Reload before saving." },
  stale_revision: { status: 412, message: "Someone saved this first. Reload to see their change." },
  sealed: { status: 409, message: "This drawing is sealed. Revise it to change anything." },
  wrong_state: { status: 409, message: "That cannot be done in the current state." },
  remeasure_required: { status: 409, message: "Remeasure the flagged dimensions before drawing this sail." },
  not_nested: { status: 409, message: "Lay every panel before confirming a cut." },
  claim_empty: { status: 409, message: "Lay a panel on this hold before cutting it." },
  claim_lapsed: { status: 409, message: "This hold has lapsed. Claim the length again before cutting." },
  claim_closed: { status: 409, message: "This hold is already closed." },
  already_cut: { status: 409, message: "This length has already been cut." },
  idempotency_key_reused: { status: 409, message: "That confirmation key belongs to another request." },
  already_issued: { status: 409, message: "This cut sheet has already been issued." },
  already_revised: { status: 409, message: "This drawing already has a revision." },
  already_decided: { status: 409, message: "This submission has already been decided." },
  not_accepted: { status: 409, message: "Only an accepted submission can be reversed." },
  account_in_use: { status: 409, message: "This account still owns boats." },
  email_taken: { status: 409, message: "An account already uses that email." },
  photo_exists: { status: 409, message: "This measurement already has its tape photo." },
  exceeds_balance: { status: 409, message: "That is more than the balance left on this sail." },
  invalid: { status: 422, message: "Check the highlighted fields." },
  too_large: { status: 413, message: "That is larger than the loft accepts." },
  unsupported_media: { status: 415, message: "That content type is not accepted here." },
  server_error: { status: 500, message: "Something went wrong on our side." },
} as const;

export type RefusalCode = keyof typeof REFUSALS;

/** Refusals whose copy carries a figure or a name, so the caller supplies the message. */
export const COMPOSED_STATUS = {
  claim_conflict: 409,
  lay_overlap: 409,
  panel_laid: 409,
  rate_limited: 429,
  store_unavailable: 503,
  identity_unavailable: 503,
  database_unavailable: 503,
} as const;

export type ComposedCode = keyof typeof COMPOSED_STATUS;

export const OUTAGES = {
  issuing: "The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.",
  sheet: "The cut-sheet store is not answering. Try again in a few minutes.",
  photo: "The cut-sheet store is not answering. The tape photo was not saved.",
  identity: "Sign-in is not answering. Try again in a minute.",
  database: "The loft records are not answering. Try again in a minute.",
} as const;

export const claimConflictCopy = (winner: string) => `${winner} claimed this length first. Choose another roll or offcut.`;
export const layOverlapCopy = (panel: number, other: number) => `Panel ${panel} overlaps panel ${other}. Nothing was laid.`;
export const panelLaidCopy = (panel: number) => `Panel ${panel} is already laid.`;
export const rateLimitedCopy = (seconds: number) => `Too many requests from this account. Try again in ${seconds} seconds.`;

export const FIELD = {
  required: "Required.",
  lengthRange: "Enter whole millimetres from 1 to 60000.",
  inches: "Enter inches above 0 with up to two decimals, or feet and inches as 38' 1 1/2\".",
  notBoth: "Enter the figure in mm or in inches, not both.",
  looksLikeInches: "That looks like inches. Enter millimetres.",
  date: "Enter a date as YYYY-MM-DD.",
  instant: "Enter a future instant as YYYY-MM-DDTHH:MM:SSZ.",
  lot: "Enter a lot of 1 to 20 characters.",
  clothMismatch: "This cloth does not match the drawing.",
  lotMismatch: "This lot does not match the cloth already on this sail.",
  reason: "Give a reason.",
  countReason: "Give a reason for the difference.",
  reasonLong: "Keep the reason to 200 characters or fewer.",
  rotation: "Turn 0 or 180 only.",
  amount: "Enter an amount in pounds above 0 with up to two decimals.",
  cursorOtherFilter: "This page belongs to another filter.",
  cursorInvalid: "That page marker is not valid.",
  email: "Enter an email address.",
  password: "Enter a password of 12 to 128 characters.",
  position: "Send x_mm, y_mm and rotation together, or none of them.",
  dimension: "Choose one of I, J, P, E, LL and LP.",
  sail: "Choose mainsail or headsail.",
  cloth: "Choose a cloth from the list.",
  role: "Choose yacht-owner or loft-hand.",
  ownerAccount: "Choose an owner account.",
  loftHandAccount: "Choose a loft hand account.",
  boat: "Choose a boat from the list.",
  stock: "Choose a roll or offcut from the list.",
  drawing: "Choose a drawing from the list.",
  panel: "Choose a panel of this drawing.",
  decision: "Choose accept or reject.",
} as const;

export const claimTooLongCopy = (code: string) => `Longer than the cloth left on ${code}.`;
export const offClothCopy = (panel: number) => `Panel ${panel} runs off the cloth. Nothing was laid.`;
export const textLengthCopy = (min: number, max: number) => `Enter ${min} to ${max} characters.`;
export const wholeNumberCopy = (min: number, max: number) => `Enter a whole number from ${min} to ${max}.`;

export const DELETED_ACCOUNT_NAME = "Former account";

export const PENDING = {
  claim: "Claiming length...",
  lay: (panel: number) => `Laying panel ${panel}...`,
  cut: "Confirming cut...",
  issue: "Issuing cut sheet...",
  submission: "Sending to the loft...",
  save: "Saving...",
} as const;

export const SUCCESS = {
  measurement: "Measurement saved.",
  measurementFlag: (dimension: string, due: string) => `Measurement saved. ${dimension} needs remeasuring by ${due}.`,
  submission: "Submission sent to the loft.",
  draw: (count: number) => `Sail drawn: ${count} panels.`,
  claim: (mm: string, code: string, until: string) => `Holding ${mm} mm on ${code} until ${until} UTC.`,
  lay: (panel: number, kind: string, code: string, remaining: string) => `Panel ${panel} laid on ${kind} ${code}. ${remaining} remaining.`,
  undo: (panel: number, kind: string, code: string) => `Panel ${panel} lifted from ${kind} ${code}.`,
  turn: (panel: number, rotation: number) => `Panel ${panel} turned to ${rotation}°.`,
  release: (code: string) => `Hold released on ${code}.`,
  oneMinute: (code: string) => `One minute left on the hold on ${code}.`,
  cut: (kind: string, code: string, remaining: string, offcut: string | null) =>
    `Cut confirmed on ${kind} ${code}. ${remaining} remaining.${offcut ? ` Offcut ${offcut} added to the shelf.` : ""}`,
  issued: "Cut sheet issued.",
  grant: (owner: string) => `Sight granted to ${owner}.`,
  withdraw: (owner: string) => `Sight withdrawn from ${owner}.`,
  payment: (amount: string, balance: string) => `Payment of £${amount} recorded. Balance £${balance}.`,
  creditNote: (amount: string, balance: string) => `Credit note of £${amount} recorded. Balance £${balance}.`,
  countMatches: "Count recorded. The ledger matches the shelf.",
  countAdjusted: (signed: string) => `Count recorded with an adjustment of ${signed} mm².`,
  bulk: (applied: number, refused: number) => `${applied} applied, ${refused} refused.`,
  decision: (id: string, verdict: "accepted" | "rejected") => `Submission ${id} ${verdict}.`,
  reverse: (id: string) => `Submission ${id} reversed.`,
  receive: (code: string) => `Roll ${code} received.`,
  account: (email: string) => `Account created for ${email}.`,
  ruleSet: (version: number) => `Rule set v${version} saved.`,
  standing: (count: number, season: string) => (count === 1 ? `1 owner in season ${season}.` : `${count} owners in season ${season}.`),
  newAssignment: (code: string) => `${code} is on your cutting floor.`,
  sessionEnded: "Your session ended. Sign in to carry on.",
  saved: "Saved.",
} as const;

export const stepCopy = (step: string) => `Finish the ${step} step first.`;

export const BULK_REFUSALS = {
  already_decided: "Already decided.",
  not_found: "No such submission.",
  reason_required: "Give a reason.",
  invalid_decision: "Choose accept or reject.",
} as const;

export const ACCOUNT_LINES = ["Cloth charge", "Tax at 20%", "Total", "Deposit", "Paid", "Credit notes", "Balance"] as const;
export const ACCOUNT_CHIPS = { deposit_due: "Deposit due", balance_due: "Balance due", settled: "Settled" } as const;

export const EMPTY = {
  ledger: "No cloth has moved on this stock yet.",
  sheets: "No cut sheet has been shared with you yet.",
  boats: "No boat is on your account yet.",
  console: "Every submission has been decided.",
  floor: "Nothing is assigned to you on the cutting floor.",
  draw: "This sail has not been drawn yet.",
} as const;

export const VIEWER_REFUSAL = "That cut sheet is not shared with you.";
export const supersededCopy = (code: string) => `Superseded by ${code}.`;

export const STATUS_LABELS = {
  measuring: "Measuring",
  remeasure: "Remeasure",
  drawn: "Drawn",
  nested: "Nested",
  cutting: "Cutting",
  cut: "Cut",
  pending_store: "Pending store",
  issued: "Issued",
} as const;

export const STANDING_CHIPS = { newTape: "New tape", steadyTape: "Steady tape", trueTape: "True tape" } as const;

export const ROLE_TABLE = [
  { ability: "manage accounts", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "record measurements", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "submit measurements", sailmaker: "no", "loft-hand": "no", "yacht-owner": "own boats" },
  { ability: "decide submissions", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "draw and issue sails", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "claim, lay and cut", sailmaker: "yes", "loft-hand": "assigned drawings with authority", "yacht-owner": "no" },
  { ability: "manage stock and ledger", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "record payments", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "no" },
  { ability: "view cut sheets", sailmaker: "yes", "loft-hand": "no", "yacht-owner": "while sight is granted" },
] as const;
