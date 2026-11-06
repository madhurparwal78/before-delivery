/** The one place each field error's published copy is written. */

import { formatByteLimit, formatDate } from './format.js';

export const fieldErrorCopy = {
  required: (label: string): string => `${label} is required.`,
  tooLong: (label: string, limit: number): string =>
    `${label} can be at most ${limit} characters.`,
  oneLine: (label: string): string => `${label} must be on one line.`,
  badEmail: (): string => 'Enter an email address like name@example.com.',
  outOfRange: (label: string, min: string, max: string): string =>
    `${label} must be between ${min} and ${max}.`,
  badAmount: (): string => 'Enter an amount like 1250.00.',
  future: (label: string): string => `${label} can't be in the future.`,
  closeNotAfterNow: (): string => 'Choose a close time after now.',
  expiryNotAfterNow: (): string => 'Choose an expiry after now.',
  currencyMismatch: (): string =>
    'Hong Kong and Macao projects bill in HKD; Singapore projects bill in SGD.',
  exclusionZero: (): string => 'Price this exclusion above zero.',
  provisionalSumsOverBase: (): string =>
    "Provisional sums can't add up to more than the base amount.",
  awardReasonMissing: (): string => 'Give a reason for not awarding the lowest levelled bid.',
  grossValuationLower: (): string => "Gross valuation can't be lower than the last certificate's.",
  periodEndingNotAfter: (previous: string): string =>
    `Period ending must be after ${formatDate(previous)}.`,
  commentsMissing: (codeLabel: string): string => `Comments are needed for ${codeLabel}.`,
  supersededInSet: (): string => 'Only current revisions can be issued.',
  contractorReceivedAt: (): string => 'Only the studio can log a received time.',
  receivedAtOutOfRange: (): string => 'Received at must be between 1 Jan 2026 and now.',
  snagAfterDefectsEnd: (defectsEndOn: string): string =>
    `This defect was observed after the defects period ended on ${formatDate(defectsEndOn)}.`,
  fileTooLarge: (fileName: string, limitBytes: number): string =>
    `${fileName} is larger than ${formatByteLimit(limitBytes)} bytes.`,
  unsupportedFile: (fileName: string): string =>
    `${fileName} isn't a PDF, PNG, JPEG or SVG file.`,
  unsupportedImage: (fileName: string): string => `${fileName} isn't a PNG or JPEG image.`,
  svgWithScript: (fileName: string): string =>
    `${fileName} contains scripts, so it wasn't accepted.`,
  storeUnknown: (): string => "Choose one of this project's stores.",
  missingRetryKey: (): string => 'Retry key is missing; reload and try again.',
  csvMissingColumn: (): string => 'The file needs Finish Name and Category columns.',
  csvTooManyRows: (): string => 'The file can have at most 2,000 rows.',
} as const;
