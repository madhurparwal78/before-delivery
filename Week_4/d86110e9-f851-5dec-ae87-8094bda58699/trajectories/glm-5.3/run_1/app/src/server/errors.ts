// One error type and one place that builds every refusal message the API
// answers. Handlers throw ApiError; the response layer turns it into the
// {"error":...} envelope with the extra keys the route names.

export class ApiError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra ?? {};
  }
}

type Extra = Record<string, unknown> | undefined;

export const Errors = {
  notFound: (): ApiError => new ApiError(404, "Not found"),
  signRequired: (): ApiError => new ApiError(401, "Sign in required"),
  viewerForbidden: (): ApiError => new ApiError(403, "Viewers cannot change this workspace"),
  ownerForbidden: (): ApiError => new ApiError(403, "Only owners can do this"),
  crossOrigin: (): ApiError => new ApiError(403, "Cross-origin request refused"),
  methodNotAllowed: (): ApiError => new ApiError(405, "Method not allowed"),
  bodyTooLarge: (): ApiError => new ApiError(413, "Body is larger than 65536 bytes"),
  wrongContentType: (): ApiError => new ApiError(415, "Content type must be application/json"),
  invalidJson: (): ApiError => new ApiError(422, "Body is not valid JSON"),
  notJsonObject: (): ApiError => new ApiError(422, "Body must be a JSON object"),
  nestedTooDeep: (): ApiError => new ApiError(422, "JSON is nested more than 20 levels"),
  nameTooLong: (): ApiError => new ApiError(422, "Name must be 60 characters or fewer"),
  emailTaken: (): ApiError => new ApiError(409, "That email already has an account"),
  alreadyMember: (): ApiError => new ApiError(409, "That person is already a member"),
  emailUnavailable: (): ApiError => new ApiError(503, "Email is unavailable"),
  storageUnavailable: (): ApiError => new ApiError(503, "Storage is unavailable"),
  publishBeforeRun: (): ApiError => new ApiError(409, "Publish a version before running"),
  onlyManual: (): ApiError => new ApiError(409, "Only manual automations can be run by hand"),
  runInputObject: (): ApiError => new ApiError(422, "Run input must be a JSON object"),
  alreadyFinished: (n: number): ApiError => new ApiError(409, `Run #${n} has already finished`),
  notFailedRun: (): ApiError => new ApiError(409, "Only a failed run can be replayed"),
  replayAfterFailed: (): ApiError => new ApiError(422, "Replay must start at or before the failed step"),
  replayInLoop: (): ApiError => new ApiError(422, "Replay cannot start inside a loop"),
  cellTaken: (): ApiError => new ApiError(409, "That cell is already taken"),
  cellOutside: (): ApiError => new ApiError(422, "That cell is outside the grid"),
  noChanges: (n: number): ApiError => new ApiError(409, `The draft has no changes since version ${n}`),
  sampleObject: (): ApiError => new ApiError(422, "Sample data must be a JSON object"),
  triggerUndeletable: (): ApiError => new ApiError(422, "The trigger cannot be deleted"),
  wrongPassword: (): ApiError => new ApiError(401, "Email or password is wrong"),
  confirmFirst: (): ApiError => new ApiError(403, "Confirm your email first"),
  unknownNodeKind: (k: string): ApiError => new ApiError(422, `Unknown node kind: ${k}`),
  unknownStep: (id: string): ApiError => new ApiError(422, `Unknown step: ${id}`),
  unknownStatus: (v: string): ApiError => new ApiError(422, `Unknown status: ${v}`),
  importTooLarge: (): ApiError => new ApiError(413, "Body is larger than 262144 bytes"),
  importNotJson: (): ApiError => new ApiError(422, "Import is not valid JSON"),
  importNotSwitchyard: (): ApiError => new ApiError(422, "Import is not a Switchyard automation"),
  gradingKey: (): ApiError => new ApiError(404, "Not found"),
  clockBody: (): ApiError => new ApiError(422, "Send advance_seconds or set"),
};
