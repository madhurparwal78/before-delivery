// Published copy for errors that are not tied to a field, keyed by the API error code.
import { MESSAGES } from './domain.js';

export const OUTAGE_UPLOAD = 'Storage is unreachable. Nothing was stored; try again when it is back.';
const OUTAGE_OTHER = 'Storage is unreachable, so new readings are paused.';
export const TOO_LARGE = 'This scan is larger than 60,000,000 bytes.';
export const UNSUPPORTED_FORMAT = 'Only PNG or TIFF scans can be stored.';

const CODES = {
  invalid_credentials: 'Email or password is wrong.',
  email_taken: 'An account with this email already exists.',
  too_large: TOO_LARGE,
  unsupported_format: UNSUPPORTED_FORMAT,
  duplicate_scan: 'This strip is already on this roll.',
  not_calibrated: 'Calibrate this scan first.',
  frames_exist: 'Frames are already found; nudge them instead.',
  no_frames: 'Find frames first.',
  unframed_scans: 'Find frames on every strip of this roll first.',
  flagged_frames: 'Accept or nudge every flagged frame first.',
  not_flagged: 'This frame is not flagged.',
  stale_alignment: 'This alignment changed in another tab. Reload it before saving.',
  storage_unavailable: OUTAGE_OTHER,
};

/** The copy to announce for a failed response: its first field message, or the copy for its error code. */
export function failureCopy(response, { upload = false } = {}) {
  const { error, fields } = response.data ?? {};
  if (fields) return Object.values(fields)[0] ?? MESSAGES.file_unreadable;
  if (error === 'storage_unavailable' && upload) return OUTAGE_UPLOAD;
  return CODES[error] ?? OUTAGE_OTHER;
}
