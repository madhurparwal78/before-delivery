import { FIELD, type FieldErrors } from "../errors.js";

// The keys each write accepts; anything else is refused field by field, in request order.
export const EDIT_FIELDS = ["text", "expected_version"] as const;
export const SEND_FIELDS = ["client_message_id", "text", "thread_root_id", "quoted_message_id"] as const;
export const SEND_FILE_PART = "file";

export function unacceptedKeys(keys: string[], accepted: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of keys) if (!accepted.includes(key)) errors[key] = FIELD.unaccepted;
  return errors;
}
