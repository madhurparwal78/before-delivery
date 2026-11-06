export const UNKNOWN_FIELD_MESSAGE = 'unknown field';
export const MISSING_FIELD_MESSAGE = 'This field is required.';

export const FIELD_MESSAGES = {
  email: 'Enter a valid email address.',
  password: 'Use 10 to 128 characters.',
  displayName: 'Use 3 to 20 letters, digits, spaces, hyphens or underscores.',
  timeZone: 'Choose a time zone from the list.',
  token: 'This link is incomplete.',
  type: 'Choose a building from the catalog.',
  coordinate: 'Keep the whole building inside the build area.',
  rotation: 'Use 0, 90, 180 or 270.',
  unit: 'Choose Saltjack or Peat Slinger.',
  trainingCount: 'Choose 1 to 20.',
  requestCount: 'Choose 1 to 6.',
  donationCount: 'Choose 1 to 3.',
  villageId: 'Use a village ID.',
  deploys: 'Send 1 to 50 deploys, and at most 200 in one raid.',
  deployTick: 'Use a tick from 0 to 1,799, never earlier than the one before.',
  deployCell: 'Deploy on the tidal ring.',
  clanName: 'Use 3 to 24 characters.',
  motto: 'Use at most 80 characters.',
  body: 'Write 1 to 500 characters.',
  limit: 'Use 1 to 100.',
  cursor: 'Use an ID from this list.',
  snapshotTick: "Use a tick from 0 to the raid's final tick.",
  raidRole: 'Use attack or defence.',
  idempotencyKey: 'Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores.'
} as const;
