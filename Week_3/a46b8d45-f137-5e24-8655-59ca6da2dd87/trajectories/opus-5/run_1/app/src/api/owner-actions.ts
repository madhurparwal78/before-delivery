/**
 * The owner's moves: starting a claim, confirming it and finding it again.
 */

import * as catalogue from '../db/catalogue';
import * as claims from '../db/claims';
import * as storage from '../services/storage';
import { apiError, partNotFound, partWithdrawn, validationFailed, wrongState } from '../http/errors';
import { baseFileName, PHOTO_COUNT_MAX, PHOTO_COUNT_MIN, refusePhoto, detectPhotoType } from '../domain/photos';
import { config } from '../config';
import { isReference, newReference, newToken, normaliseReference, sameEmail } from '../domain/references';
import { isBefore, isLondonDate, londonDate, now } from '../domain/time';
import { isLanguage, type Language } from '../shared/format';
import { sendConfirmationNotice } from '../services/notices';
import { clearWrongTries, countWrongTry } from '../db/shared-state';
import { stateAfter } from '../domain/state';
import type { ClaimState } from '../shared/claim-state';
import { withTransaction } from '../db/pool';
import type { UploadedFile } from '../http/request';

const OWNER = 'owner' as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const POSTCODE_PATTERN = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;
const QUANTITY_MIN = 1;
const QUANTITY_MAX = 20;
const BOOKLET_MIN = 1;
const BOOKLET_MAX = 99;

export interface ClaimStartFields {
  name: string;
  email: string;
  postcode: string;
  model: string;
  bookletNumber: string;
  quantity: string;
  purchaseDate: string;
  description: string;
  language: string;
}

export interface ClaimStartResult {
  reference: string;
  confirmBy: Date;
}

function wholeNumber(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** The booklet number and model slug are looked up before any other field is validated. */
function readPartSelection(fields: ClaimStartFields): { errors: Record<string, string>; bookletNumber: number | null } {
  const errors: Record<string, string> = {};
  if (fields.model.trim() === '') errors['model'] = 'required';

  const raw = fields.bookletNumber.trim();
  let bookletNumber: number | null = null;
  if (raw === '') {
    errors['booklet_number'] = 'required';
  } else {
    const parsed = wholeNumber(raw);
    if (parsed === null || parsed < BOOKLET_MIN || parsed > BOOKLET_MAX) errors['booklet_number'] = 'invalid';
    else bookletNumber = parsed;
  }
  return { errors, bookletNumber };
}

function validateRest(fields: ClaimStartFields, files: readonly UploadedFile[], today: string): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = fields.name.trim();
  if (name === '') errors['name'] = 'required';
  else if ([...name].length > NAME_MAX) errors['name'] = 'too_long';

  if (fields.email.trim() === '') errors['email'] = 'required';
  else if (!EMAIL_PATTERN.test(fields.email.trim())) errors['email'] = 'invalid';

  const postcode = fields.postcode.trim();
  if (postcode === '') errors['postcode'] = 'required';
  else if (!POSTCODE_PATTERN.test(postcode.toUpperCase())) errors['postcode'] = 'invalid';

  const quantity = fields.quantity.trim();
  if (quantity === '') {
    errors['quantity'] = 'required';
  } else {
    const parsed = wholeNumber(quantity);
    if (parsed === null || parsed < QUANTITY_MIN || parsed > QUANTITY_MAX) errors['quantity'] = 'invalid';
  }

  const purchaseDate = fields.purchaseDate.trim();
  if (purchaseDate === '') errors['purchase_date'] = 'required';
  else if (!isLondonDate(purchaseDate)) errors['purchase_date'] = 'invalid';
  else if (purchaseDate > today) errors['purchase_date'] = 'in_future';

  if ([...fields.description].length > DESCRIPTION_MAX) errors['description'] = 'too_long';

  if (!isLanguage(fields.language)) errors['language'] = 'invalid';

  if (files.length < PHOTO_COUNT_MIN || files.length > PHOTO_COUNT_MAX) errors['photos'] = 'count';
  // Each file present is judged under its own 1-based position, whatever the count.
  files.forEach((file, index) => {
    const refusal = refusePhoto(file.bytes);
    if (refusal !== null) errors[`photos.${index + 1}`] = refusal;
  });

  return errors;
}

async function freshReference(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = newReference();
    if ((await claims.findClaimRow(candidate)) === null) return candidate;
  }
  throw new Error('could not mint a free claim reference');
}

/**
 * A claim start succeeds only when the claim row, every photo, the reference and Mailpit's
 * acceptance of the confirmation email all succeed. Anything already written for a failed
 * start is removed.
 */
export async function startClaim(fields: ClaimStartFields, files: readonly UploadedFile[]): Promise<ClaimStartResult> {
  const selection = readPartSelection(fields);
  const startedAt = now();
  const today = londonDate(startedAt);

  let part: catalogue.CataloguePart | null = null;
  if (Object.keys(selection.errors).length === 0 && selection.bookletNumber !== null) {
    part = await catalogue.findPart(fields.model.trim(), selection.bookletNumber);
    if (part === null) throw partNotFound();
    if (part.status === 'withdrawn') throw partWithdrawn(OWNER, selection.bookletNumber);
  }

  const errors = { ...selection.errors, ...validateRest(fields, files, today) };
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  if (part === null) throw partNotFound();

  const language = fields.language as Language;
  const email = fields.email.trim();
  const reference = await freshReference();
  const confirmBy = new Date(startedAt.getTime() + config.confirmLinkTtlSeconds * 1000);
  const confirmToken = newToken();
  const storedKeys: string[] = [];

  try {
    return await withTransaction(async (tx) => {
      const clubMember = await catalogue.isClubMember(tx, email, fields.purchaseDate.trim());
      await claims.insertClaim(tx, {
        reference,
        language,
        name: fields.name.trim(),
        email,
        postcode: fields.postcode.trim(),
        purchaseDate: fields.purchaseDate.trim(),
        clubMember,
        modelSlug: part.modelSlug,
        bookletNumber: part.bookletNumber,
        quantity: Number(fields.quantity.trim()),
        description: fields.description,
        startedAt,
        confirmBy,
      });
      await claims.recordHistory(tx, reference, 'started', startedAt);
      await claims.insertConfirmLink(tx, confirmToken, reference, confirmBy);

      // Photos are stored byte for byte, numbered from 1 in upload order.
      for (const [index, file] of files.entries()) {
        const contentType = detectPhotoType(file.bytes);
        if (contentType === null) throw validationFailed({ [`photos.${index + 1}`]: 'not_a_photo' });
        const key = storage.photoKey(reference, index + 1);
        await storage.putObject(key, file.bytes, contentType);
        storedKeys.push(key);
        await claims.insertPhoto(tx, reference, index + 1, contentType, file.bytes.length);
      }

      // The claim only exists once Mailpit has accepted the confirmation email.
      await sendConfirmationNotice({
        reference,
        kind: 'confirmation',
        language,
        recipient: email,
        figures: { confirmToken, confirmBy: confirmBy.toISOString() },
      });

      return { reference, confirmBy };
    });
  } catch (error) {
    for (const key of storedKeys) await storage.deleteObject(key).catch(() => undefined);
    throw error;
  }
}

/* ---------------------------------------------------------------------- confirmation */

export type ConfirmationLinkState = 'live' | 'lapsed' | 'used';

export interface ConfirmationStatus {
  reference: string;
  linkState: ConfirmationLinkState;
  confirmBy: Date;
}

/**
 * An unknown, erased or malformed reference all answer the same way, so none of them can
 * be told apart.
 */
export async function confirmationStatus(rawReference: string): Promise<ConfirmationStatus> {
  const unknownClaim = apiError(OWNER, 404, 'claim_unknown');

  const reference = normaliseReference(rawReference);
  if (!isReference(reference)) throw unknownClaim;

  const claim = await claims.findClaimRow(reference);
  if (claim === null || claim.state === 'erased') throw unknownClaim;

  const link = await claims.confirmLinkFor(reference);
  if (link === null) throw unknownClaim;

  const linkState: ConfirmationLinkState =
    claim.state === 'started' ? (isBefore(now(), link.confirm_by) ? 'live' : 'lapsed') : 'used';
  return { reference, linkState, confirmBy: link.confirm_by };
}

export interface ConfirmResult {
  reference: string;
  shareToken: string;
}

/**
 * Confirming stores one instant, which is the claim's confirmation instant, the instant of
 * its history entry and the instant the ruling will compare against.
 */
export async function confirmClaim(token: string, bodyReference: string | null): Promise<ConfirmResult> {
  return withTransaction(async (tx) => {
    const unknownLink = apiError(OWNER, 404, 'link_unknown');

    const link = await claims.lockConfirmLink(tx, token);
    if (link === null) throw unknownLink;

    // A body reference naming a different claim is answered like an unknown link.
    if (bodyReference !== null && normaliseReference(bodyReference) !== link.reference) throw unknownLink;

    const at = now();
    if (!isBefore(at, link.confirm_by)) throw apiError(OWNER, 410, 'link_lapsed');
    if (link.used_at !== null) throw apiError(OWNER, 409, 'link_used');

    const claim = await claims.lockClaimRow(tx, link.reference);
    if (claim === null || claim.state === 'erased') throw unknownLink;
    if (claim.state !== 'started') throw apiError(OWNER, 409, 'link_used');

    const confirmedState = stateAfter('confirm', { state: claim.state, paid: false }) as ClaimState;
    await claims.markConfirmLinkUsed(tx, token, at);
    await claims.setClaimState(tx, link.reference, confirmedState);
    await claims.markConfirmedAt(tx, link.reference, at);
    await claims.recordHistory(tx, link.reference, confirmedState, at);

    const shareToken = newToken();
    await claims.insertShareLink(tx, shareToken, link.reference, at);
    return { reference: link.reference, shareToken };
  });
}

/* --------------------------------------------------------------------- find my claim */

export interface LookupResult {
  shareToken: string;
}

/**
 * Each wrong try counts against the reference named in the request, never against the claim
 * the email belongs to. An unknown, erased or malformed reference counts nothing.
 */
export async function lookupClaim(rawReference: string, email: string): Promise<LookupResult> {
  const notFound = apiError(OWNER, 404, 'not_found');

  const reference = normaliseReference(rawReference.trim());
  if (!isReference(reference)) throw notFound;

  const claim = await claims.findClaimRow(reference);
  if (claim === null || claim.state === 'erased') throw notFound;

  // A real reference with a different email is one wrong try, and the same 404 body.
  if (!sameEmail(claim.owner_email ?? '', email)) {
    await countWrongTry(reference, now());
    throw notFound;
  }

  const shareLink = await claims.latestShareLink(reference);
  if (shareLink === null || claim.state === 'started') throw wrongState(OWNER, claim.state);
  if (shareLink.state === 'ended') throw apiError(OWNER, 410, 'claim_closed');
  if (shareLink.state === 'withdrawn') throw apiError(OWNER, 410, 'link_withdrawn');

  await clearWrongTries(reference);
  return { shareToken: shareLink.token };
}
