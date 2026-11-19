/** Published copy that both the server and the browser must print exactly. */

export const FORM_PROBLEMS_SUMMARY = 'Check the highlighted fields.';
export const STORAGE_BANNER =
  'Photo storage is down. Check-ins are held as pending photo until it is back.';
export const BILLING_BANNER =
  'Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back.';
export const PHOTO_LOAD_FAILED = 'Photo storage is down. Photos will show again when it is back.';
export const EMPTY_CHECKOUT_SLOT = 'No checkout photo — this loan predates photos.';
export const EMPTY_CHECKIN_SLOT = 'No check-in photo yet.';
export const NO_QUEUE_LINE = 'No one is waiting for this tool.';
export const HOLDS_NEED_ACTIVE = 'Holds open once your membership is active.';
export const DISCARD_PROMPT =
  'Discard this loan? The member, tools and photo you entered will be cleared.';
export const SKIPPED_RETURN_TIME =
  'That time does not exist in library time because the clocks go forward.';
export const MALFORMED_RETURN_TIME = 'Use YYYY-MM-DD HH:MM in library time.';
export const NOT_FOUND_HEADING = "We couldn't find that page.";
export const NO_TOOLS_MATCH = 'No tools match that search.';

export const SIGN_IN_REFUSED = 'Email or password is incorrect.';
export const SESSION_ENDED = 'Your session has ended. Sign in again.';
export const SIGN_IN_TO_CONTINUE = 'Sign in to continue.';
export const NOT_FOUND = 'Not found.';
export const CROSS_SITE_REFUSED = 'Cross-site request refused.';
export const STAFF_ONLY = 'Only desk staff can do that.';
export const COORDINATOR_ONLY = 'Only the coordinator can do that.';
export const MEMBERS_ONLY = 'Only members can do that.';
export const SIGN_OUT_BEFORE_JOINING = 'Sign out before joining.';
export const SEND_JSON = 'Send JSON.';
export const REQUEST_TOO_LARGE = 'Request is too large.';
export const PHOTO_TOO_LARGE = 'Photo must be 5,000,000 bytes or smaller.';
export const WRONG_PEG = 'That peg belongs to a different tool.';
export const EMAIL_TAKEN = 'An account with this email already exists.';
export const DAY_ALREADY_CLOSED = 'That day is already closed.';
export const PAST_CLOSURE = 'Past closures cannot be removed.';

export const BILLING_DOWN_GENERAL =
  'Billing is down. Nothing was charged; try again when it is back.';
export const BILLING_DOWN_CHECKIN =
  'Billing is down. This check-in was not saved; try again when it is back.';
export const BILLING_DOWN_WAIVER =
  'Billing is down. The waiver was not posted; try again when it is back.';
export const STORAGE_DOWN_CHECKOUT =
  'Photo storage is down. The loan stays reserved; check it out when storage is back.';
export const STORAGE_DOWN_CHECKIN = 'Saved as pending photo. Nothing has been charged.';
export const STORAGE_DOWN_FINISH =
  'Photo storage is down. This check-in is still pending photo; finish it when storage is back.';
export const STORAGE_DOWN_PHOTO_READ = STORAGE_DOWN_FINISH;

export const MEMBERSHIP_NOT_ACTIVE_HOLD = 'Your membership is not active.';
export const TOOL_ON_WALL = 'This tool is on the wall. Ask at the desk to borrow it.';
export const ALREADY_HOLDING = 'You already have a hold on this tool.';
export const HOLD_NO_LONGER_ACTIVE = 'This hold is no longer active.';
export const ONLY_ACTIVE_CANCELS = 'Only an active membership can be cancelled.';
export const ALREADY_ENDING = 'This membership already ends at the end of its term.';
export const MEMBER_NOT_ACTIVE_RESERVE = "This member's membership is not active.";
export const ALREADY_CHECKED_OUT = 'This loan is already checked out.';
export const ONLY_RESERVED_CANCELS = 'Only a reserved loan can be cancelled.';
export const NOT_CHECKED_OUT = 'This loan has not been checked out.';
export const WAITING_FOR_PHOTO = 'This check-in is waiting for its photo.';
export const ALREADY_CHECKED_IN = 'This loan is already checked in.';
export const NOT_WAITING_FOR_PHOTO = 'This loan is not waiting for a photo.';
export const FEE_ALREADY_SETTLED = 'This fee is already settled.';
export const FEE_ALREADY_WAIVED = 'This fee has been waived.';
export const WAIVER_ALREADY_WAITING = 'A waiver request is already waiting.';
export const NO_WAIVER_TO_DECIDE = 'There is no waiver request to decide.';

export function partAlreadyHung(partName: string): string {
  return `${partName} is already on its peg.`;
}

export function tagNotOnWall(tag: string): string {
  return `${tag} is not on the wall.`;
}

export function tagMissingParts(tag: string): string {
  return `${tag} is missing parts.`;
}

export function tagHeldForAnother(tag: string): string {
  return `${tag} is held for another member.`;
}
