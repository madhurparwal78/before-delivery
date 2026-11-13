export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(JSON.stringify(body));
  }
}

const refusal = (status: number, error: string) => new HttpError(status, { error });

export const Refusal = {
  unauthenticated: () => refusal(401, "unauthenticated"),
  invalidCredentials: () => refusal(401, "invalid_credentials"),
  notFound: () => refusal(404, "not_found"),
  leaderOnly: () => refusal(403, "leader_only"),
  crossOrigin: () => refusal(403, "cross_origin"),
  staleTask: () => refusal(409, "stale_task"),
  alreadyDone: () => refusal(409, "already_done"),
  notDone: () => refusal(409, "not_done"),
  usernameTaken: () => refusal(409, "username_taken"),
  alreadyInParty: () => refusal(409, "already_in_party"),
  partyFull: () => refusal(409, "party_full"),
  alreadyInvited: () => refusal(409, "already_invited"),
  inviteExpired: () => refusal(409, "invite_expired"),
  questInProgress: () => refusal(409, "quest_in_progress"),
  notEnoughAccepted: () => refusal(409, "not_enough_accepted"),
  questNotActive: () => refusal(409, "quest_not_active"),
  idempotencyKeyReused: () => refusal(409, "idempotency_key_reused"),
  bodyTooLarge: () => refusal(413, "body_too_large"),
  fileTooLarge: () => refusal(413, "file_too_large"),
  unsupportedFileType: () => refusal(415, "unsupported_file_type"),
  unsupportedMediaType: () => refusal(415, "unsupported_media_type"),
  chatRateLimited: () => refusal(429, "chat_rate_limited"),
  storageUnavailable: () => refusal(503, "storage_unavailable"),
  databaseUnavailable: () => refusal(503, "database_unavailable"),
};

export const Message = {
  username: "Use 3 to 20 lowercase letters, digits or _.",
  password: "Use at least 8 characters.",
  title: "Title must be 1 to 80 characters.",
  difficulty: "Choose trivial, easy, medium or hard.",
  weekdays: "Choose at least one weekday.",
  price: "Price must be from 0.01 to 9999.99.",
  position: (total: number) => `Position must be from 1 to ${total}.`,
  direction: "Direction must be up or down.",
  type: "This action does not fit this task type.",
  timeZone: "Unknown time zone.",
  dayStartHour: "Day start hour must be a whole number from 0 to 23.",
  text: "Message must be 1 to 500 characters.",
  name: "Party name must be 1 to 40 characters.",
  quest: "Unknown quest.",
  inviteTarget: "No player with that username.",
  gold: "Not enough gold.",
} as const;

export function invalid(errors: Record<string, string>): HttpError {
  return new HttpError(422, { errors });
}
