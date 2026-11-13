type ProblemCode =
  | 'hire_desk_unavailable'
  | 'hire_desk_pending'
  | 'hire_release_unavailable'
  | 'press_unavailable'
  | 'sheet_store_unavailable'
  | 'wall_store_unavailable'
  | 'no_stock'
  | 'hold_lapsed'
  | 'hold_not_held'
  | 'quote_required'
  | 'quote_total_mismatch'
  | 'serial_already_in_kit'
  | 'serial_not_there'
  | 'serial_unknown'
  | 'serial_exists'
  | 'hired_in_by_hold_only'
  | 'reversal_not_possible'
  | 'body_in_issued_rig'
  | 'body_not_available'
  | 'body_already_in_layout'
  | 'layout_needs_bodies'
  | 'circuit_overloaded'
  | 'sheet_already_issued'
  | 'sheet_withdrawn'
  | 'link_not_found'
  | 'link_ended'
  | 'link_window_over'
  | 'link_rate_limited'
  | 'photo_missing'
  | 'photo_not_image'
  | 'photo_too_large'
  | 'residual_too_high'
  | 'points_degenerate'
  | 'job_finished'
  | 'layout_changed'
  | 'precondition_required'
  | 'idempotency_key_required'
  | 'idempotency_key_reused'
  | 'origin_refused'
  | 'unknown_field'
  | 'validation_failed'
  | 'malformed_body'
  | 'unsupported_media_type'
  | 'body_too_large'
  | 'method_not_allowed'
  | 'not_found'
  | 'database_unavailable'
  | 'internal_error';

interface ProblemShape {
  readonly status: number;
  readonly title: string;
  readonly copy: string;
}

const problems: Record<ProblemCode, ProblemShape> = {
  hire_desk_unavailable: {
    status: 503,
    title: 'Hire desk unavailable',
    copy: "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.",
  },
  hire_desk_pending: {
    status: 503,
    title: 'Hire desk answer pending',
    copy: "The hire desk isn't answering. Your hold stands and the confirmation is still being checked.",
  },
  hire_release_unavailable: {
    status: 503,
    title: 'Hire desk unavailable',
    copy: "The hire desk isn't answering. Your hold stands until it lapses.",
  },
  press_unavailable: {
    status: 503,
    title: 'Rig sheet press unavailable',
    copy: "The rig sheet press isn't answering. Your layout is unchanged; nothing has been issued.",
  },
  sheet_store_unavailable: {
    status: 503,
    title: 'Sheet store unavailable',
    copy: "The sheet store isn't answering. Your layout is unchanged; nothing has been issued.",
  },
  wall_store_unavailable: {
    status: 503,
    title: 'Wall store unavailable',
    copy: "The wall store isn't answering. Your readings and layouts still work; the photo was not kept.",
  },
  no_stock: {
    status: 409,
    title: 'No stock',
    copy: 'The hire desk has no body free for those dates.',
  },
  hold_lapsed: {
    status: 409,
    title: 'Hold lapsed',
    copy: 'This hold has lapsed. Bodies drawn on it need a body again.',
  },
  hold_not_held: {
    status: 409,
    title: 'Hold not held',
    copy: 'This hold is no longer held.',
  },
  quote_required: {
    status: 409,
    title: 'Quote required',
    copy: 'Quote this hold before confirming it.',
  },
  quote_total_mismatch: {
    status: 409,
    title: 'Quote total mismatch',
    copy: "The hire desk's total of <provider total> differs from ours of <computed total>. Nothing can be confirmed.",
  },
  serial_already_in_kit: {
    status: 409,
    title: 'Serial already in kit',
    copy: "The hire desk offered a serial that's already in your kit.",
  },
  serial_not_there: {
    status: 409,
    title: 'Serial not there',
    copy: "That serial isn't where this movement starts.",
  },
  serial_unknown: {
    status: 422,
    title: 'Serial unknown',
    copy: "That serial isn't in your kit.",
  },
  serial_exists: {
    status: 409,
    title: 'Serial exists',
    copy: 'That serial is already in your kit.',
  },
  hired_in_by_hold_only: {
    status: 409,
    title: 'Hired in by hold only',
    copy: 'A hired body arrives through a confirmed hold.',
  },
  reversal_not_possible: {
    status: 409,
    title: 'Reversal not possible',
    copy: "That serial has moved since, so this movement can't be reversed.",
  },
  body_in_issued_rig: {
    status: 409,
    title: 'Body in an issued rig',
    copy: '<serial> is already in an issued rig.',
  },
  body_not_available: {
    status: 409,
    title: 'Body not available',
    copy: "<serial> isn't on the shelf or at this site.",
  },
  body_already_in_layout: {
    status: 409,
    title: 'Body already in this layout',
    copy: '<serial> is already in this layout.',
  },
  layout_needs_bodies: {
    status: 409,
    title: 'Layout needs bodies',
    copy: '<n> placements still need a confirmed body.',
  },
  circuit_overloaded: {
    status: 409,
    title: 'Circuit overloaded',
    copy: 'Circuit <name> is overloaded: <load> W on <capacity> W.',
  },
  sheet_already_issued: {
    status: 409,
    title: 'Sheet already issued',
    copy: 'This layout already has an issued sheet.',
  },
  sheet_withdrawn: {
    status: 409,
    title: 'Sheet withdrawn',
    copy: 'This sheet has been withdrawn.',
  },
  link_not_found: {
    status: 404,
    title: 'Link not found',
    copy: "This rig sheet link doesn't exist.",
  },
  link_ended: {
    status: 410,
    title: 'Link ended',
    copy: 'This rig sheet link has ended. Ask the projection artist for a new one.',
  },
  link_window_over: {
    status: 409,
    title: 'Link window over',
    copy: "This sheet's link window is over.",
  },
  link_rate_limited: {
    status: 429,
    title: 'Link rate limited',
    copy: 'Too many requests on this link. Try again shortly.',
  },
  photo_missing: {
    status: 409,
    title: 'Photo missing',
    copy: 'Upload a wall photo first.',
  },
  photo_not_image: {
    status: 415,
    title: 'Photo is not an image',
    copy: "That file isn't a JPEG or PNG photo, whatever its name says.",
  },
  photo_too_large: {
    status: 413,
    title: 'Photo too large',
    copy: 'That photo is over the 40,000,000 byte limit.',
  },
  residual_too_high: {
    status: 422,
    title: 'Residual too high',
    copy: 'Those points disagree by <residual> m; the limit is 0.050 m.',
  },
  points_degenerate: {
    status: 422,
    title: 'Points degenerate',
    copy: "Three of those points lie on one line, so they can't fix the wall.",
  },
  job_finished: {
    status: 409,
    title: 'Job finished',
    copy: 'This mask job has already finished.',
  },
  layout_changed: {
    status: 412,
    title: 'Layout changed',
    copy: 'This layout changed in another window. Reload it to carry on.',
  },
  precondition_required: {
    status: 428,
    title: 'Precondition required',
    copy: "This change needs the layout's current version.",
  },
  idempotency_key_required: {
    status: 400,
    title: 'Idempotency key required',
    copy: 'This action needs an Idempotency-Key header.',
  },
  idempotency_key_reused: {
    status: 409,
    title: 'Idempotency key reused',
    copy: 'That Idempotency-Key was already used for a different request.',
  },
  origin_refused: {
    status: 403,
    title: 'Origin refused',
    copy: 'This request came from another site.',
  },
  unknown_field: {
    status: 422,
    title: 'Unknown field',
    copy: 'Unknown field: <field>.',
  },
  validation_failed: {
    status: 422,
    title: 'Validation failed',
    copy: 'Some fields need fixing.',
  },
  malformed_body: {
    status: 400,
    title: 'Malformed body',
    copy: "That request body couldn't be read.",
  },
  unsupported_media_type: {
    status: 415,
    title: 'Unsupported media type',
    copy: 'This request must be JSON.',
  },
  body_too_large: {
    status: 413,
    title: 'Body too large',
    copy: 'That request body is too large.',
  },
  method_not_allowed: {
    status: 405,
    title: 'Method not allowed',
    copy: "That method isn't allowed here.",
  },
  not_found: {
    status: 404,
    title: 'Not found',
    copy: 'Nothing here.',
  },
  database_unavailable: {
    status: 503,
    title: 'Records unavailable',
    copy: "The workspace can't reach its records right now. Try again shortly.",
  },
  internal_error: {
    status: 500,
    title: 'Internal error',
    copy: 'Something went wrong on our side.',
  },
};

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: ProblemCode;
  readonly [extension: string]: unknown;
}

interface ProblemOptions {
  readonly placeholders?: Readonly<Record<string, string>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
}

export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly body: ProblemBody;
  readonly headers: Readonly<Record<string, string>>;

  constructor(code: ProblemCode, options: ProblemOptions = {}) {
    const shape = problems[code];
    let detail = shape.copy;
    for (const [name, value] of Object.entries(options.placeholders ?? {})) {
      detail = detail.split(`<${name}>`).join(value);
    }
    super(detail);
    this.code = code;
    this.status = shape.status;
    this.headers = options.headers ?? {};
    this.body = {
      type: `urn:gevelwerk:problem:${code}`,
      title: shape.title,
      status: shape.status,
      detail,
      code,
      ...(options.extensions ?? {}),
    };
  }
}

export function problem(code: ProblemCode, options: ProblemOptions = {}): ProblemError {
  return new ProblemError(code, options);
}
