import { fail, invalid, HttpError } from './http/errors';

export const unauthenticated = (): HttpError => fail(401, 'unauthenticated', 'Sign in to continue.');
export const invalidCredentials = (): HttpError =>
  fail(401, 'invalid_credentials', "That email and password don't match.");
export const forbidden = (): HttpError => fail(403, 'forbidden', 'Only the program director can do that.');
export const notFound = (): HttpError => fail(404, 'not_found', "We couldn't find that.");

export const invalidTransition = (from: string, action: string): HttpError =>
  fail(409, 'invalid_transition', "That step isn't available in the current state.", { from, action });

export const emailTaken = (): HttpError => fail(409, 'email_taken', 'An account already uses that email.');
export const studioNameTaken = (): HttpError =>
  fail(409, 'studio_name_taken', 'Another studio already uses that name.');

export const deadlinePassed = (deadlineLabel: string): HttpError =>
  fail(409, 'deadline_passed', `Entries closed at ${deadlineLabel}.`);
export const deadlineNotPassed = (deadlineLabel: string): HttpError =>
  fail(409, 'deadline_not_passed', `Entries are still open until ${deadlineLabel}.`);

export const judgingStarted = (): HttpError =>
  fail(409, 'judging_started', 'Judging has started, so dates and categories are locked.');
export const categoryExists = (): HttpError =>
  fail(409, 'category_exists', 'That category already exists in this program.');

export const panelEmpty = (): HttpError =>
  fail(409, 'panel_empty', 'Add at least one juror before opening.');
export const screeningIncomplete = (): HttpError =>
  fail(409, 'screening_incomplete', 'Screen every submitted entry before opening Round 1.');
export const noEntries = (): HttpError =>
  fail(409, 'no_entries', 'There are no entries to judge in this round.');
export const previousRoundNotConfirmed = (): HttpError =>
  fail(409, 'previous_round_not_confirmed', 'Confirm Round 1 standings before opening the final round.');
export const finalNotConfirmed = (): HttpError =>
  fail(409, 'final_not_confirmed', 'Confirm the final round before publishing.');

export const roundClosed = (): HttpError =>
  fail(409, 'round_closed', 'This round closed before your ballot arrived. It was not counted.');
export const ballotSubmitted = (): HttpError =>
  fail(409, 'ballot_submitted', 'Your ballot is already submitted.');
export const ballotIncomplete = (remaining: number): HttpError =>
  fail(409, 'ballot_incomplete', `Score every entry before submitting. ${remaining} left.`);

export const idempotencyKeyReused = (): HttpError =>
  fail(409, 'idempotency_key_reused', 'That key was already used for a different entry.');

export const paymentsPausedOnPay = (): HttpError =>
  fail(503, 'payments_paused', 'Payments are paused. Your draft is saved — try again shortly.');
export const paymentsPausedOnRefund = (): HttpError =>
  fail(503, 'payments_paused', 'Refunds are paused. Your entry is still submitted — try again shortly.');
export const mailUnavailableOnPay = (): HttpError =>
  fail(
    503,
    'mail_unavailable',
    "We couldn't send your receipt, so nothing was charged. Your draft is saved — try again shortly.",
  );
export const storageUnavailableOnDraft = (): HttpError =>
  fail(
    503,
    'storage_unavailable',
    'Image storage is unavailable. Your draft is saved — try the upload again shortly.',
  );
export const storageUnavailableOnPay = (): HttpError =>
  fail(
    503,
    'storage_unavailable',
    'Image storage is unavailable, so nothing was charged. Your draft is saved — try again shortly.',
  );
export const storageUnavailableOnOpen = (): HttpError =>
  fail(503, 'storage_unavailable', 'Storage is unavailable, so the round was not opened. Try again shortly.');

export const fileTooLarge = (): HttpError =>
  fail(413, 'file_too_large', 'Images must be 8,000,000 bytes or smaller.');
export const unsupportedType = (): HttpError => fail(415, 'unsupported_type', 'Upload a PNG or JPEG image.');
export const payloadTooLarge = (): HttpError =>
  fail(413, 'payload_too_large', 'That request body is too large.');
export const unsupportedMediaType = (): HttpError =>
  fail(415, 'unsupported_media_type', 'Send this request as JSON.');

export const unreadableImage = (): HttpError =>
  invalid({ file: "This file isn't a readable PNG or JPEG image." });
export const badDimensions = (): HttpError =>
  invalid({ file: 'Images must be 640 to 4,096 pixels on each side.' });
export const tooManyImages = (): HttpError => invalid({ file: 'An entry holds at most 6 images.' });
export const missingAssets = (): HttpError => invalid({ assets: 'Add at least one case-study image.' });
export const badIdempotencyKey = (): HttpError =>
  invalid({ idempotencyKey: 'Send an Idempotency-Key header of 1 to 100 characters.' });
export const badScore = (fields: string[]): HttpError =>
  invalid(Object.fromEntries(fields.map((f) => [f, 'Scores are whole numbers from 1 to 10.'])));
export const badReason = (): HttpError => invalid({ reason: 'Give a reason of 1 to 300 characters.' });
