import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { withTransaction, pool, id } from './db.js';
import { err, linkNotFound } from './errors.js';
import { config } from './config.js';
import { publish } from './live.js';
import { putObject, getObject, photoKey } from './storage.js';

interface TokenRow {
  token: string;
  stay_id: string;
  sent_at: Date;
  accepted_at: Date | null;
}

/** A link is live only while its stay is booked, within its TTL, and not superseded. */
async function liveToken(client: { query: Function }, token: string): Promise<{ stayId: string; hotelId: string }> {
  const res = await client.query(
    `SELECT t.stay_id, s.hotel_id, t.accepted_at, t.sent_at
     FROM checkin_tokens t JOIN stays s ON s.id = t.stay_id
     WHERE t.token = $1`, [token]);
  const row = res.rows[0];
  if (!row) throw linkNotFound();
  if (row.accepted_at) throw linkNotFound();
  const stayRes = await client.query('SELECT status, checked_in_online FROM stays WHERE id = $1', [row.stay_id]);
  const stay = stayRes.rows[0];
  if (!stay || stay.status !== 'booked') throw linkNotFound();
  const hotelRes = await client.query('SELECT clock_fixed_at FROM hotels WHERE id = $1', [row.hotel_id]);
  const now = hotelRes.rows[0].clock_fixed_at ? new Date(hotelRes.rows[0].clock_fixed_at) : new Date();
  const expiresAt = new Date(row.sent_at).getTime() + config.checkinLinkTtlSeconds * 1000;
  if (now.getTime() >= expiresAt) throw linkNotFound();
  return { stayId: row.stay_id, hotelId: row.hotel_id };
}

export async function checkinInfo(req: Request, res: Response) {
  const token = req.params.token;
  const info = await withTransaction(async client => {
    const { stayId, hotelId } = await liveToken(client, token);
    const stayRes = await client.query('SELECT * FROM stays WHERE id = $1', [stayId]);
    const stay = stayRes.rows[0];
    const roomRes = await client.query(
      `SELECT r.type FROM stay_nights sn JOIN rooms r ON r.id = sn.room_id
       WHERE sn.stay_id = $1 ORDER BY sn.date LIMIT 1`, [stayId]);
    const hotelRes = await client.query('SELECT name FROM hotels WHERE id = $1', [hotelId]);
    return {
      hotelName: hotelRes.rows[0].name,
      arrival: stay.arrival,
      departure: stay.departure,
      roomType: roomRes.rows[0]?.type ?? '',
      photo: stay.id_photo_key ? 'received' : 'none'
    };
  });
  res.json(info);
}

export async function uploadPhoto(req: Request, res: Response) {
  const token = req.params.token;

  // multipart already parsed by middleware into req.file
  const file = (req as Request & { file?: { buffer: Buffer; mimetype: string; size: number } }).file;
  if (!file) throw err.validation('photo', 'Please upload a JPEG or PNG photo.');

  const { stayId, hotelId } = await withTransaction(async client => liveToken(client, token));

  if (file.size > config.idPhotoMaxBytes) {
    throw err.tooLargePhoto();
  }
  const type = sniffImageType(file.buffer);
  if (type !== 'jpeg' && type !== 'png') {
    throw err.wrongPhotoType();
  }
  const stripped = stripExif(file.buffer, type);
  const key = photoKey(hotelId, stayId);
  try {
    await putObject(key, stripped, type === 'jpeg' ? 'image/jpeg' : 'image/png');
  } catch {
    throw err.photoStoreUnavailable();
  }
  await pool.query('UPDATE stays SET id_photo_key = $1, id_photo = $2 WHERE id = $3', [key, stripped, stayId]);
  res.json({ photo: 'received' });
}

export async function photoBytes(req: Request, res: Response) {
  const user = req.user!;
  const stayRes = await pool.query('SELECT id_photo_key, hotel_id FROM stays WHERE id = $1', [req.params.id]);
  const stay = stayRes.rows[0];
  if (!stay || stay.hotel_id !== user.hotelId || !stay.id_photo_key) throw err.notFound();
  try {
    const bytes = await getObject(stay.id_photo_key);
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(bytes);
  } catch {
    throw err.unavailable('The file store is unavailable.');
  }
}

export async function completeCheckin(req: Request, res: Response) {
  const token = req.params.token;
  const { stayId, hotelId } = await withTransaction(async client => liveToken(client, token));
  const stayRes = await pool.query('SELECT id_photo_key, hotel_id FROM stays WHERE id = $1', [stayId]);
  const stay = stayRes.rows[0];
  if (!stay.id_photo_key) {
    throw err.conflict('Please upload your ID photo first.');
  }
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  if (!fullName) throw err.validation('fullName', 'Enter your full name.');
  const now = await withTransaction(async client => {
    const hotelRes = await client.query('SELECT clock_fixed_at FROM hotels WHERE id = $1', [hotelId]);
    return hotelRes.rows[0].clock_fixed_at ? new Date(hotelRes.rows[0].clock_fixed_at) : new Date();
  });
  await pool.query(
    'UPDATE stays SET checked_in_online = TRUE, online_checkin_name = $1, online_checkin_phone = $2 WHERE id = $3',
    [fullName, phone, stayId]);
  await pool.query('UPDATE checkin_tokens SET accepted_at = $1 WHERE token = $2', [now, token]);
  const roomRes = await pool.query(
    `SELECT r.number FROM stay_nights sn JOIN rooms r ON r.id = sn.room_id
     WHERE sn.stay_id = $1 ORDER BY sn.date LIMIT 1`, [stayId]);
  publish(hotelId, {
    type: 'checkin', stayId,
    notice: `Room ${roomRes.rows[0]?.number ?? ''} guest completed online check-in.`
  });
  res.json({ completed: true });
}

function sniffImageType(buffer: Buffer): 'jpeg' | 'png' | 'other' {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return 'other';
}

/** Remove EXIF from JPEG (rebuild without the APP1 marker) and from PNG (strip ancillary text chunks). */
export function stripExif(buffer: Buffer, type: 'jpeg' | 'png'): Buffer {
  if (type === 'jpeg') return stripJpegExif(buffer);
  return stripPngExif(buffer);
}

function stripJpegExif(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let offset = 2;
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xda || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) break; // start of scan
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 > buf.length) break;
    const length = buf.readUInt16BE(offset + 2);
    const segment = buf.subarray(offset, offset + 2 + length);
    const isExif = marker === 0xe1 && segment.length >= 10 &&
      segment.subarray(4, 10).toString('ascii') === 'Exif\0\0';
    if (!isExif) parts.push(segment);
    offset += 2 + length;
  }
  parts.push(buf.subarray(offset));
  return Buffer.concat(parts);
}

function stripPngExif(buf: Buffer): Buffer {
  const signature = buf.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return buf;
  const parts: Buffer[] = [signature];
  let offset = 8;
  const keep = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'bKGD', 'pHYs', 'sBIT'];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const typeStr = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = buf.subarray(offset, offset + 12 + length);
    if (keep.includes(typeStr)) parts.push(chunk);
    offset += 12 + length;
    if (typeStr === 'IEND') break;
  }
  return Buffer.concat(parts);
}
