import { pool } from '../db.js';
import { notFound, validation } from '../errors.js';
import { checkPickupDate, checkReturnDate, MESSAGES } from '../validate.js';
import { findKitRecord, kitDetailView, kitViews, priceQuote } from '../../domain/catalogue.js';
import type { DateRange } from '../../domain/availability.js';
import type { KitDetailView, KitView, PriceQuote } from '../../shared/types.js';

/** Dates are optional on the catalogue endpoints, but both or neither. */
function readOptionalRange(url: URL): DateRange | null {
  const pickupDate = url.searchParams.get('pickupDate');
  const returnDate = url.searchParams.get('returnDate');
  if (pickupDate === null && returnDate === null) return null;
  const fields: Record<string, string> = {};
  if (pickupDate === null) fields.pickupDate = MESSAGES.pickupDate;
  if (returnDate === null) fields.returnDate = MESSAGES.returnDate;
  if (Object.keys(fields).length > 0) throw validation(fields);
  const pickupProblem = checkPickupDate(pickupDate);
  if (pickupProblem !== null) fields.pickupDate = pickupProblem;
  const returnProblem = checkReturnDate(pickupDate, returnDate);
  if (returnProblem !== null) fields.returnDate = returnProblem;
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { pickupDate: pickupDate as string, returnDate: returnDate as string };
}

export async function listKits(url: URL): Promise<{ kits: KitView[] }> {
  return { kits: await kitViews(pool, readOptionalRange(url)) };
}

export async function getKit(url: URL, kitId: string): Promise<KitDetailView> {
  const range = readOptionalRange(url);
  const kit = await findKitRecord(pool, kitId);
  if (kit === null) throw notFound();
  return kitDetailView(pool, kit, range);
}

export async function getPrice(url: URL): Promise<PriceQuote> {
  const kitId = url.searchParams.get('kitId');
  const pickupDate = url.searchParams.get('pickupDate');
  const returnDate = url.searchParams.get('returnDate');
  if (kitId === null) throw notFound();
  const kit = await findKitRecord(pool, kitId);
  if (kit === null) throw notFound();
  const fields: Record<string, string> = {};
  const pickupProblem = checkPickupDate(pickupDate);
  if (pickupProblem !== null) fields.pickupDate = pickupProblem;
  const returnProblem = checkReturnDate(pickupDate, returnDate);
  if (returnProblem !== null) fields.returnDate = returnProblem;
  if (Object.keys(fields).length > 0) throw validation(fields);
  return priceQuote(pool, kitId, pickupDate as string, returnDate as string);
}
