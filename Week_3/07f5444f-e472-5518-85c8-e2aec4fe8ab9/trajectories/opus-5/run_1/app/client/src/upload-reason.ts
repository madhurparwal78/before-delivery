import { ApiFailure } from './api.js';

/** The `<reason>` of the upload failure copy. */
export function uploadFailureReason(failure: unknown): string {
  if (!(failure instanceof ApiFailure)) return 'the upload did not finish';
  if (failure.status === 503) return 'the score store is offline';
  if (failure.status === 415) return 'only PDF, PNG or JPEG files can be filed';
  if (failure.status === 413) return 'the file is larger than 20,000,000 bytes';
  if (failure.status === 422 && failure.fieldError('file') === 'The file is empty.') return 'the file is empty';
  return 'the upload did not finish';
}
