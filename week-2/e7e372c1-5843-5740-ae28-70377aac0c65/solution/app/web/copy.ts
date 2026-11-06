// Every user-facing sentence the brief fixes, in one place.

export const LOADING = "Loading figures...";
export const REFRESH_FAILED = "Figures could not be refreshed. Showing the last loaded figures.";
export const VAULT_NOTICE = "Filing vault unavailable — exhibits are temporarily unavailable. Figures shown are unchanged.";
export const VAULT_DOWNLOAD = "Filing vault unavailable — this exhibit cannot be downloaded right now. Figures shown are unchanged.";
export const UNEXPECTED = "Something went wrong. Nothing was changed.";
export const FOOTER = "Figures are preliminary and unaudited. Each figure links to the filing it comes from; where they differ, the filing controls.";

export const SIGN_IN_FAILED = "Email or password is incorrect.";
export const SESSION_ENDED_DIALOG = "Your session ended. Sign in again to finish this action.";
export const SESSION_ENDED_CANCELLED = "Your session ended. Sign in to save your changes.";
export const DRAFT_SAVED = "Draft saved.";
export const SENT = "Sent to disclosure counsel.";
export const SEND_REFUSED = "Attach a verified exhibit before sending to disclosure counsel.";
export const RETURNED = "Returned to the treasury analyst.";
export const CLEARED = "Cleared for release.";
export const VERSION_CONFLICT = "This restatement changed since you opened it. Reload to see the current version.";
export const WITHDRAWN = "Release withdrawn — the restatement is cleared again.";
export const WITHDRAW_REFUSED = "This restatement has already published or changed. Refresh to see its current state.";

export const UPLOADING = "Uploading exhibit and checking SHA-256...";
export const HASH_MISMATCH = "Exhibit rejected — the vault copy's SHA-256 does not match the file you chose.";
export const NOT_A_PDF = "Choose a PDF file.";
export const NOT_FILING_SAFE = "This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again.";
export const TOO_LARGE = "The exhibit is larger than the size limit.";
export const NO_ACCESSION = "Save the accession number before attaching an exhibit.";
export const VAULT_UPLOAD = "Filing vault unavailable — the exhibit was not stored. Try again when the vault is back.";

export const RELEASE_RELEASED_NOW = "Releasing now publishes it at once.";
export const RELEASE_UNCONFIRMED = "The release could not be confirmed. Press Release to try again; it will not be released twice.";
export const RELEASE_TWO_PERSON = "You prepared or cleared this restatement, so another disclosure officer must release it.";
export const RELEASE_NOT_CLEARED = "This restatement is no longer cleared. Refresh to see its current state.";

export const OPERATOR_PAUSED = "Tape paused.";
export const OPERATOR_PLAYING = "Tape playing.";
export const OPERATOR_REAL_TIME = "Clock follows real time.";
export const OPERATOR_INVALID = "Enter a time as YYYY-MM-DD HH:MM:SS in New York time.";

export const CLOCK_BADGES = { holdings: "Holdings week", equity: "Equity", eth: "ETH live" } as const;
