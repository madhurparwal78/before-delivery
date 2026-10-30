const ERROR_DEFS = {
  PAYLOAD_TOO_LARGE: [413, 'Request body is larger than 1000000 bytes'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Send this request as application/json'],
  MALFORMED_JSON: [400, 'Request body is not valid JSON'],
  VALIDATION_ERROR: [422, 'A field is missing or malformed'],
  UNKNOWN_FIELD: [422, 'This endpoint does not define that field'],
  APP_ID_REQUIRED: [400, 'Send the X-Corvo-Org header'],
  UNAUTHENTICATED: [401, 'Send a bearer credential'],
  INVALID_CREDENTIAL: [401, 'That credential is not live'],
  BAD_CREDENTIALS: [401, 'Email or password is incorrect'],
  APP_ID_MISMATCH: [403, 'That app id is not your organization'],
  FORBIDDEN_ROLE: [403, 'Your role may not do that'],
  IDEMPOTENCY_KEY_IN_PROGRESS: [409, 'That idempotency key is still in flight'],
  IDEMPOTENCY_KEY_REUSED: [422, 'That idempotency key was used for another request'],
  WALLET_NOT_FOUND: [404, 'Wallet not found'],
  INTENT_NOT_FOUND: [404, 'Intent not found'],
  POLICY_NOT_FOUND: [404, 'Policy not found'],
  QUORUM_NOT_FOUND: [404, 'Key quorum not found'],
  MEMBER_NOT_FOUND: [404, 'Member not found'],
  API_KEY_NOT_FOUND: [404, 'API key not found'],
  NOT_FOUND: [404, 'Not found'],
  WALLET_NAME_TAKEN: [409, 'A wallet of this organization already uses that name'],
  MEMBER_EXISTS: [409, 'That email already belongs to a member'],
  INVALID_QUORUM_MEMBER: [422, 'Key quorum members must be owners or approvers of this organization'],
  INVALID_THRESHOLD: [422, 'The threshold must run from 1 to the member count'],
  DUPLICATE_DEPOSIT: [409, 'That reference is already used on this wallet'],
  INVALID_AMOUNT: [422, 'Enter an amount like 1250 or 0.5'],
  AMOUNT_PRECISION: [422, 'That amount has more decimals than the asset allows'],
  AMOUNT_NOT_POSITIVE: [422, 'Enter an amount greater than zero'],
  AMOUNT_TOO_LARGE: [422, 'That amount is larger than 1000000000 whole units'],
  INVALID_ADDRESS: [422, 'Enter an address of 0x and 40 hex characters'],
  INVALID_ADDRESS_CHECKSUM: [422, 'That address fails its EIP-55 checksum'],
  SELF_TRANSFER: [422, 'A wallet cannot send to itself'],
  ASSET_MISMATCH: [422, 'That wallet holds another chain or asset'],
  WALLET_FROZEN: [409, 'This wallet is frozen'],
  WALLET_NOT_FROZEN: [409, 'This wallet is active'],
  POLICY_DENIED: [403, 'The policy denied this request'],
  INSUFFICIENT_FUNDS: [409, 'Not enough available balance'],
  INTENT_NOT_PENDING: [409, 'This intent is no longer pending approval'],
  NOT_IN_QUORUM: [403, 'You are not in this intent\'s key quorum'],
  SELF_APPROVAL: [403, 'You cannot decide the intent you started'],
  ALREADY_DECIDED: [409, 'You already decided this intent'],
  INVALID_POLICY: [422, 'That policy is outside the grammar'],
  POLICY_IN_USE: [409, 'A wallet still uses this policy'],
  INVALID_CURSOR: [422, 'That cursor does not belong to this list'],
  MEMBER_IN_QUORUM: [409, 'That member sits in a key quorum'],
  LAST_OWNER: [409, 'An organization keeps at least one owner'],
  DATABASE_UNAVAILABLE: [503, 'Corvo cannot reach its database'],
  INTERNAL_ERROR: [500, 'Something went wrong']
};

export class ApiError extends Error {
  constructor(code, { details = {}, message, status } = {}) {
    const def = ERROR_DEFS[code] || ERROR_DEFS.INTERNAL_ERROR;
    super(message || def[1]);
    this.code = code;
    this.status = status || def[0];
    this.details = details;
  }
}
