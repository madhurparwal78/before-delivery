/** Refusal copy that quotes a limit, built from the one definition of that limit. */
import { formatDollars } from "./money.js";
import { APPROVAL_THRESHOLD_CENTS, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX, MEMO_MAX } from "./rules.js";

export const MEMO_TOO_LONG = `Keep the memo to ${MEMO_MAX} characters of plain text`;
export const SCHEDULED_CAP = `Scheduled payments can be at most ${formatDollars(APPROVAL_THRESHOLD_CENTS)}`;
export const NAME_TOO_LONG = `Keep this to ${INQUIRY_NAME_MAX} characters or fewer`;
export const MESSAGE_TOO_LONG = `Keep your message to ${INQUIRY_MESSAGE_MAX.toLocaleString("en-US")} characters or fewer`;
