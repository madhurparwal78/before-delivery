// Refusal and rare-state copy shared by every office screen (brief: Feedback states).

export const NETWORK_FAILURE =
  "We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once.";
export const SESSION_ENDED = "Your session ended. Sign in again and we'll put your draft back.";
export const DRAFT_RESTORED = "Your draft is restored.";
export const ACCESS_REMOVED = "Your access to this workspace was removed. Anything unsaved was discarded.";
export const NOT_FOUND = "We couldn't find that. It may have been removed, or you may not have access.";
export const FORBIDDEN = "Your role can't do this. Ask the studio director if you need it.";
export const WRONG_PASSWORD = "That email and password don't match. Check them and try again.";

/** "That can't be done while this is <state word>." */
export const otherIllegal = (state: string): string => `That can't be done while this is ${state.replace(/_/g, " ")}.`;

/** The field error copy for an upload the server answered 413 file_too_large. */
export const tooLarge = (fileName: string, limitBytes: number): string =>
  `${fileName} is larger than ${limitBytes.toLocaleString("en-US")} bytes.`;

export const FILE_LIMIT = 10_000_000;
