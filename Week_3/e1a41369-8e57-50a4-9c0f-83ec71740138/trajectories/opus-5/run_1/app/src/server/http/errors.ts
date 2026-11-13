export type ErrorName =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'leader_only'
  | 'cross_origin'
  | 'stale_task'
  | 'already_done'
  | 'not_done'
  | 'username_taken'
  | 'already_in_party'
  | 'party_full'
  | 'already_invited'
  | 'invite_expired'
  | 'quest_in_progress'
  | 'not_enough_accepted'
  | 'quest_not_active'
  | 'idempotency_key_reused'
  | 'body_too_large'
  | 'file_too_large'
  | 'unsupported_file_type'
  | 'unsupported_media_type'
  | 'chat_rate_limited'
  | 'storage_unavailable'
  | 'database_unavailable';

const STATUS: Record<ErrorName, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  leader_only: 403,
  cross_origin: 403,
  stale_task: 409,
  already_done: 409,
  not_done: 409,
  username_taken: 409,
  already_in_party: 409,
  party_full: 409,
  already_invited: 409,
  invite_expired: 409,
  quest_in_progress: 409,
  not_enough_accepted: 409,
  quest_not_active: 409,
  idempotency_key_reused: 409,
  body_too_large: 413,
  file_too_large: 413,
  unsupported_file_type: 415,
  unsupported_media_type: 415,
  chat_rate_limited: 429,
  storage_unavailable: 503,
  database_unavailable: 503,
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body));
    this.status = status;
    this.body = body;
  }
}

export function fail(name: ErrorName): ApiError {
  return new ApiError(STATUS[name], { error: name });
}

export function failValidation(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

export const VALIDATION_MESSAGES = {
  username: 'Use 3 to 20 lowercase letters, digits or _.',
  password: 'Use at least 8 characters.',
  title: 'Title must be 1 to 80 characters.',
  difficulty: 'Choose trivial, easy, medium or hard.',
  weekdays: 'Choose at least one weekday.',
  price: 'Price must be from 0.01 to 9999.99.',
  position: (total: number): string => `Position must be from 1 to ${total}.`,
  direction: 'Direction must be up or down.',
  type: 'This action does not fit this task type.',
  timeZone: 'Unknown time zone.',
  dayStartHour: 'Day start hour must be a whole number from 0 to 23.',
  text: 'Message must be 1 to 500 characters.',
  name: 'Party name must be 1 to 40 characters.',
  quest: 'Unknown quest.',
  inviteTarget: 'No player with that username.',
  notEnoughGold: 'Not enough gold.',
} as const;

export function failNotEnoughGold(): ApiError {
  return new ApiError(422, { errors: { gold: VALIDATION_MESSAGES.notEnoughGold } });
}
