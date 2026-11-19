import { randomUUID } from 'node:crypto';
import { Db, one, rows } from '../db';

export interface GuestView {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

export const MERGE_FIELDS = ['name', 'email', 'phone', 'company', 'address'] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

const COLUMNS: Record<MergeField, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  company: 'company',
  address: 'address',
};

interface GuestRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

export async function listGuests(db: Db, hotelId: string, search: string): Promise<GuestView[]> {
  const term = `%${search.trim().toLowerCase()}%`;
  return rows<GuestRow>(
    db,
    `select id, name, email, phone, company, address from guests
      where hotel_id = $1 and merged_into is null
        and ($2 = '%%' or lower(name) like $2 or lower(email) like $2 or lower(phone) like $2
             or lower(company) like $2)
      order by name, id`,
    [hotelId, term],
  );
}

export async function loadGuest(db: Db, hotelId: string, guestId: string): Promise<GuestView | null> {
  return one<GuestRow>(
    db,
    `select id, name, email, phone, company, address from guests
      where hotel_id = $1 and id = $2 and merged_into is null`,
    [hotelId, guestId],
  );
}

export async function findGuestByEmail(
  db: Db,
  hotelId: string,
  email: string,
): Promise<GuestView | null> {
  if (email.trim() === '') return null;
  return one<GuestRow>(
    db,
    `select id, name, email, phone, company, address from guests
      where hotel_id = $1 and merged_into is null and lower(email) = lower($2) limit 1`,
    [hotelId, email],
  );
}

export async function createGuest(
  db: Db,
  hotelId: string,
  guest: { name: string; email: string; phone: string },
): Promise<GuestView> {
  const id = randomUUID();
  await db.query(
    `insert into guests (id, hotel_id, name, email, phone, company, address)
     values ($1,$2,$3,$4,$5,'','')`,
    [id, hotelId, guest.name, guest.email, guest.phone],
  );
  return { id, name: guest.name, email: guest.email, phone: guest.phone, company: '', address: '' };
}

export async function stayAndFolioIds(
  db: Db,
  guestId: string,
): Promise<{ stayIds: string[]; folioIds: string[] }> {
  const stayRows = await rows<{ id: string }>(
    db,
    'select id from stays where guest_id = $1 order by seq',
    [guestId],
  );
  const folioRows = await rows<{ id: string }>(
    db,
    `select f.id from folios f join stays s on s.id = f.stay_id
      where s.guest_id = $1 order by s.seq, f.ord`,
    [guestId],
  );
  return { stayIds: stayRows.map((row) => row.id), folioIds: folioRows.map((row) => row.id) };
}

/** An empty survivor field takes the other value; a differing field takes the choice made. */
function mergedValue(
  field: MergeField,
  survivor: GuestView,
  merged: GuestView,
  choice: 'survivor' | 'merged' | undefined,
): string {
  const survivorValue = survivor[field];
  const mergedValueText = merged[field];
  if (survivorValue.trim() === '') return mergedValueText;
  if (survivorValue === mergedValueText) return survivorValue;
  return choice === 'merged' ? mergedValueText : survivorValue;
}

export async function applyMerge(
  db: Db,
  survivor: GuestView,
  merged: GuestView,
  choices: Partial<Record<MergeField, 'survivor' | 'merged'>>,
): Promise<{ guest: GuestView; staysMoved: number }> {
  const next: GuestView = { ...survivor };
  for (const field of MERGE_FIELDS) {
    next[field] = mergedValue(field, survivor, merged, choices[field]);
  }
  await db.query(
    `update guests set ${MERGE_FIELDS.map((field, index) => `${COLUMNS[field]} = $${index + 2}`).join(', ')}
      where id = $1`,
    [survivor.id, ...MERGE_FIELDS.map((field) => next[field])],
  );
  const moved = await db.query('update stays set guest_id = $1 where guest_id = $2', [
    survivor.id,
    merged.id,
  ]);
  await db.query('update guests set merged_into = $1 where id = $2', [survivor.id, merged.id]);
  return { guest: next, staysMoved: moved.rowCount ?? 0 };
}
