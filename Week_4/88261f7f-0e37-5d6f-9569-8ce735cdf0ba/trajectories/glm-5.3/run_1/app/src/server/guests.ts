import type { Request, Response } from 'express';
import { withTransaction } from './db.js';
import { err } from './errors.js';
import { publish } from './live.js';

export async function searchGuests(req: Request, res: Response) {
  const user = req.user!;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const { rows } = await withTransaction(async client => {
    const res = await client.query(
      `SELECT id, name, email, phone, company, address FROM guests
       WHERE hotel_id = $1 AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
       ORDER BY name`,
      [user.hotelId, search]);
    return { rows: res.rows };
  });
  res.json({ guests: rows });
}

export async function getGuest(req: Request, res: Response) {
  const user = req.user!;
  const result = await withTransaction(async client => {
    const guestRes = await client.query(
      'SELECT id, name, email, phone, company, address FROM guests WHERE id = $1 AND hotel_id = $2',
      [req.params.id, user.hotelId]);
    if (!guestRes.rows[0]) throw err.notFound();
    const staysRes = await client.query('SELECT id FROM stays WHERE guest_id = $1 ORDER BY created_at', [req.params.id]);
    const foliosRes = await client.query(
      'SELECT f.id FROM folios f JOIN stays s ON s.id = f.stay_id WHERE s.guest_id = $1 ORDER BY f.letter', [req.params.id]);
    return {
      guest: guestRes.rows[0],
      stayIds: staysRes.rows.map(r => r.id),
      folioIds: foliosRes.rows.map(r => r.id)
    };
  });
  res.json({ ...result.guest, stayIds: result.stayIds, folioIds: result.folioIds });
}

const FIELDS = ['name', 'email', 'phone', 'company', 'address'] as const;
type Field = typeof FIELDS[number];
type Choice = 'survivor' | 'merged';

export async function mergeGuests(req: Request, res: Response) {
  const user = req.user!;
  const survivorId = req.body.survivorId;
  const mergedId = req.body.mergedId;
  if (typeof survivorId !== 'string' || typeof mergedId !== 'string') {
    throw err.validation('mergedId', 'Choose two different guests.');
  }
  if (survivorId === mergedId) {
    throw err.validation('mergedId', 'Choose two different guests.');
  }
  const result = await withTransaction(async client => {
    const survivorRes = await client.query(
      'SELECT * FROM guests WHERE id = $1 AND hotel_id = $2', [survivorId, user.hotelId]);
    const mergedRes = await client.query(
      'SELECT * FROM guests WHERE id = $1 AND hotel_id = $2', [mergedId, user.hotelId]);
    const survivor = survivorRes.rows[0];
    const merged = mergedRes.rows[0];
    if (!survivor || !merged) throw err.notFound();

    const choices = (req.body.choices ?? {}) as Record<string, unknown>;
    const updates: Record<Field, string> = {
      name: survivor.name, email: survivor.email, phone: survivor.phone,
      company: survivor.company, address: survivor.address
    };
    for (const field of FIELDS) {
      const survivorValue = (survivor[field] ?? '').trim();
      const mergedValue = (merged[field] ?? '').trim();
      if (!survivorValue && mergedValue) {
        updates[field] = mergedValue;
      } else if (survivorValue && mergedValue && survivorValue !== mergedValue) {
        const choice = choices[field];
        if (choice === 'merged') updates[field] = mergedValue;
      }
    }

    const staysRes = await client.query('SELECT id FROM stays WHERE guest_id = $1', [mergedId]);
    await client.query('UPDATE stays SET guest_id = $1 WHERE guest_id = $2', [survivorId, mergedId]);
    await client.query('UPDATE guests SET name=$1, email=$2, phone=$3, company=$4, address=$5 WHERE id=$6',
      [updates.name, updates.email, updates.phone, updates.company, updates.address, survivorId]);
    await client.query('DELETE FROM guests WHERE id = $1', [mergedId]);
    await client.query('DELETE FROM checkin_tokens WHERE stay_id IN (SELECT id FROM stays WHERE guest_id = $1)', [mergedId]);

    const survivorOut = await client.query(
      'SELECT id, name, email, phone, company, address FROM guests WHERE id = $1', [survivorId]);
    return { guest: survivorOut.rows[0], staysMoved: staysRes.rows.length };
  });
  publish(user.hotelId, { type: 'merge', notice: `Guests merged. ${result.staysMoved} stays moved.` });
  res.json(result);
}
