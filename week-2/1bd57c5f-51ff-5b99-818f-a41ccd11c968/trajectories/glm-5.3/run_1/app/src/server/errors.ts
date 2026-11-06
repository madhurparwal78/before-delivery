export type FieldMessage = string;

export class ApiError extends Error {
  status: number;
  code: string;
  override message: string;
  fields?: Record<string, FieldMessage>;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields?: Record<string, FieldMessage>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    if (fields !== undefined) this.fields = fields;
    if (extra !== undefined) this.extra = extra;
  }
}

export type ErrorBody = Record<string, unknown>;

export function errorBody(e: ApiError): ErrorBody {
  const body: ErrorBody = { error: e.code, message: e.message };
  if (e.fields !== undefined) body.fields = e.fields;
  if (e.extra !== undefined) for (const [k, v] of Object.entries(e.extra)) body[k] = v;
  return body;
}

type Fields = Record<string, FieldMessage>;

export const Errors = {
  tooLarge: () => new ApiError(413, "too_large", "That request is too large."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Requests must come from Snaglight itself."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "That email and password don't match."),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  forbidden: () => new ApiError(403, "forbidden", "You can't do that on this job."),
  roleEnded: () => new ApiError(403, "role_ended", "Your access to this job has ended."),
  outsideSiteVisit: () => new ApiError(403, "outside_site_visit", "Access codes show from 30 minutes before your next site visit."),
  invalidTransition: () => new ApiError(409, "invalid_transition", "That step isn't allowed from here."),
  blocked: (waitingOn: number[]) => new ApiError(409, "blocked", "Finish the items this one is waiting on first.", undefined, { waiting_on: waitingOn }),
  awaitingTrade: () => new ApiError(409, "awaiting_trade", "Waiting on the trade's completion photo."),
  completionPhotoRequired: () => new ApiError(409, "completion_photo_required", "Add a completion photo before marking this done."),
  bulkFailed: (failures: { number: number; error: string; message: string }[]) =>
    new ApiError(409, "bulk_failed", "None of the items changed.", undefined, { failures }),
  itemsNotVerified: (unverified: number) => new ApiError(409, "items_not_verified", "Every item must be verified before close-out.", undefined, { unverified }),
  jobClosed: () => new ApiError(409, "job_closed", "This job is closed out."),
  alreadyMember: () => new ApiError(409, "already_member", "That person already has a role on this job."),
  noConflict: () => new ApiError(409, "no_conflict", "That field has no conflict to resolve."),
  visitOverlap: (date: string) => new ApiError(409, "visit_overlap", "That person already has a visit then.", undefined, { occurrence_date: date }),
  nothingToUndo: () => new ApiError(409, "nothing_to_undo", "You have no edit to undo on this note."),
  nothingToRedo: () => new ApiError(409, "nothing_to_redo", "You have no undone edit to redo on this note."),
  validation: (fields: Fields) => new ApiError(422, "validation", "Check the highlighted fields.", fields),
  photoTooLarge: () => new ApiError(413, "photo_too_large", "Images must be 10,000,000 bytes or smaller."),
  unsupportedImage: () => new ApiError(415, "unsupported_image", "Use a JPEG, PNG or WebP image."),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "Storage is unreachable; nothing was saved. Try again shortly."),
};

export const FIELD_MESSAGES = {
  pin: "Drop the pin inside a room on the plan.",
  newPassword: "New password must be at least 10 characters.",
  outlineOverlap: "Rooms can't overlap.",
  itemIdsCycle: "Items can't wait on each other in a circle.",
  referencePointsCollinear: "Pick three reference points that are not in a line.",
};

export function fieldError(fields: Record<string, FieldMessage>): ApiError {
  return Errors.validation(fields);
}
