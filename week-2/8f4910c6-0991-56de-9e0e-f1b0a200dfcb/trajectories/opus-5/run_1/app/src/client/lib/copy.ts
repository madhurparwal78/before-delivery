import { formatOfficeTime } from '../../shared/format.js';
import type { ApiErrorBody, OfficeRecord } from '../../shared/types.js';

/** Every published piece of feedback copy lives here. */
export const copy = {
  sessionEnded: 'Your session ended. Your draft is kept; sign in again to finish.',
  draftRestored: 'Your draft was restored.',
  accessRemoved: 'Your access to Rungboard was removed. Nothing more can be saved.',
  staleVersion: (name: string, time: string): string =>
    `${name} saved a newer version at ${time}. Your changes were not saved.`,
  rateLimited: (seconds: number): string =>
    `Too many requests from this connection. Try again in ${seconds} seconds.`,
  billingUnavailable: 'Billing is unreachable, so nothing was saved. Try again in a few minutes.',
  storageUnavailable: 'Photo storage is unreachable, so nothing was saved. Try again in a few minutes.',
  validation: (count: number): string =>
    count === 1 ? 'Please fix 1 problem.' : `Please fix ${count} problems.`,
  invalidCredentials: 'That email and password do not match.',
  problemsHeading: (count: number): string =>
    count === 1 ? 'There is a problem' : `There are ${count} problems`,
  trayFull: 'Your tray holds up to 12 talent.',
  deadPackageHeading: 'This package link no longer opens',
  deadPackageBody: 'Ask your Vesper & Rowe booker for a new link.',
  deadConsentHeading: 'This consent link no longer works',
  deadConsentBody: 'Ask Vesper & Rowe to send a new link if you still need to decide.',
  goneProfileHeading: 'No longer represented',
  goneProfileBody: 'This talent is no longer represented by Vesper & Rowe Talent.',
  confirmBillingOutage:
    'Billing is unreachable, so nothing was booked. The option is still 1st. Try again in a few minutes.',
  downloadStorageOutage:
    'Photo storage is unreachable, so the download could not be prepared. Try again in a few minutes.',
  staleOrder: (name: string, time: string): string =>
    `${name} saved a newer order at ${time}. The previous order is back.`,
  staleLicence: (name: string, time: string): string =>
    `${name} extended this licence at ${time}. Check the new end date before extending again.`,
  recordChangedElsewhere: "That talent's record changed elsewhere. Reload to see it.",
} as const;

export function officeTime(iso: string | null | undefined, office: OfficeRecord): string {
  if (!iso) return '';
  return formatOfficeTime(Date.parse(iso), office.timeZone, office.city);
}

/** Maps an error body to its published copy; unknown codes keep a plain sentence. */
export function errorCopy(
  error: ApiErrorBody | null,
  office: OfficeRecord,
  perCode: Record<string, (body: ApiErrorBody) => string> = {},
): string {
  if (!error) return 'That action could not be saved.';
  const code = error.error;
  const custom = perCode[code];
  if (custom) return custom(error);
  switch (code) {
    case 'session_ended':
      return copy.sessionEnded;
    case 'access_removed':
      return copy.accessRemoved;
    case 'stale_version':
      return copy.staleVersion(String(error.savedBy ?? ''), officeTime(String(error.savedAt ?? ''), office));
    case 'rate_limited':
      return copy.rateLimited(Number(error.retryAfterSeconds ?? 1));
    case 'billing_unavailable':
      return copy.billingUnavailable;
    case 'storage_unavailable':
      return copy.storageUnavailable;
    case 'validation':
      return copy.validation(Object.keys(error.errors ?? {}).length);
    case 'invalid_credentials':
      return copy.invalidCredentials;
    default:
      return 'That action could not be saved.';
  }
}
