import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { Db, one } from '../db';
import { Hotel, hotelNow, loadHotel } from './hotels';
import { StayRecord, loadStayRecordById } from './stays';
import { awaitingOnlineCheckIn } from '../domain/stayState';

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Stores the token that the provider has already accepted, killing any earlier one. */
export async function storeToken(db: Db, hotel: Hotel, stayId: string, token: string): Promise<void> {
  const now = hotelNow(hotel);
  const expiresAt = new Date(now.getTime() + config.checkinLinkTtlSeconds * 1000);
  await db.query("update checkin_tokens set state = 'ended' where stay_id = $1", [stayId]);
  await db.query(
    "insert into checkin_tokens (token, stay_id, sent_at, expires_at, state) values ($1,$2,$3,$4,'active')",
    [token, stayId, now, expiresAt],
  );
  await db.query("update stays set checkin_link_state = 'sent' where id = $1", [stayId]);
}

export async function endLink(db: Db, stayId: string): Promise<void> {
  await db.query("update checkin_tokens set state = 'ended' where stay_id = $1", [stayId]);
  await db.query(
    "update stays set checkin_link_state = 'ended' where id = $1 and checkin_link_state = 'sent'",
    [stayId],
  );
}

export interface ResolvedLink {
  hotel: Hotel;
  stay: StayRecord;
  token: string;
}

/** Resolves a link only while it is alive by the hotel's clock and the stay is still booked. */
export async function resolveToken(db: Db, token: string): Promise<ResolvedLink | null> {
  const row = await one<{ stay_id: string; expires_at: Date; state: string }>(
    db,
    'select stay_id, expires_at, state from checkin_tokens where token = $1',
    [token],
  );
  if (!row || row.state !== 'active') return null;
  const stay = await loadStayRecordById(db, row.stay_id);
  if (!stay) return null;
  const hotel = await loadHotel(db, stay.hotelId);
  if (!hotel) return null;
  if (hotelNow(hotel).getTime() >= row.expires_at.getTime()) return null;
  if (!awaitingOnlineCheckIn(stay.status)) return null;
  if (stay.checkedInOnline) return null;
  return { hotel, stay, token };
}

export function checkinLinkUrl(requestOrigin: string, token: string): string {
  const base = config.appPublicUrl !== '' ? config.appPublicUrl : requestOrigin;
  return `${base.replace(/\/$/, '')}/checkin/${token}`;
}
