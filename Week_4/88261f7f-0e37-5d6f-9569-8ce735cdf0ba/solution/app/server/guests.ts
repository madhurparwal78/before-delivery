import type { Guest, GuestDetail } from "../shared/api";
import { notices } from "../shared/notices";
import { database, one, rows, run, atomic, type Queryable, type Row } from "./db";
import { fail, isObject, isUuid, ok, type JsonObject, type Reply } from "./http";
import { emit } from "./live";

interface GuestRow extends Row { id: string; name: string; email: string; phone: string; company: string; address: string }

const MERGED_FIELDS = ["name", "email", "phone", "company", "address"] as const;

const guestView = (row: GuestRow): Guest => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company, address: row.address });

export async function listGuests(hotelId: string, query: URLSearchParams): Promise<Reply> {
  const term = `%${(query.get("search") ?? "").trim()}%`;
  const found = await rows<GuestRow>(
    database(),
    `SELECT * FROM guests WHERE hotel_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2 OR company ILIKE $2) ORDER BY name, email`,
    [hotelId, term],
  );
  return ok({ guests: found.map(guestView) });
}

async function findGuest(hotelId: string, guestId: unknown, lock?: Queryable): Promise<GuestRow> {
  const found = typeof guestId === "string" && isUuid(guestId)
    ? await one<GuestRow>(lock ?? database(), `SELECT * FROM guests WHERE id = $1 AND hotel_id = $2${lock ? " FOR UPDATE" : ""}`, [guestId, hotelId])
    : undefined;
  if (!found) throw fail.notFound();
  return found;
}

export async function guestDetail(hotelId: string, guestId: string): Promise<Reply> {
  const guest = await findGuest(hotelId, guestId);
  const stays = await rows<Row & { id: string }>(database(), "SELECT id FROM stays WHERE guest_id = $1 ORDER BY arrival, id", [guest.id]);
  const folios = await rows<Row & { id: string }>(database(), "SELECT f.id FROM folios f JOIN stays s ON s.id = f.stay_id WHERE s.guest_id = $1 ORDER BY f.name, f.id", [guest.id]);
  const detail: GuestDetail = { ...guestView(guest), stayIds: stays.map((stay) => stay.id), folioIds: folios.map((folio) => folio.id) };
  return ok(detail);
}

export async function mergeGuests(hotelId: string, body: JsonObject): Promise<Reply> {
  const outcome = await atomic(async (client) => {
    if (body.survivorId === body.mergedId && typeof body.survivorId === "string") throw fail.invalid({ mergedId: "Choose two different guests." });
    // Lock in id order so two opposite merges queue behind each other instead of deadlocking.
    const ids = [body.survivorId, body.mergedId].filter((id): id is string => typeof id === "string" && isUuid(id)).sort();
    for (const id of ids) await findGuest(hotelId, id, client);
    const survivor = await findGuest(hotelId, body.survivorId, client);
    const merged = await findGuest(hotelId, body.mergedId, client);
    const choices = isObject(body.choices) ? body.choices : {};
    const values = MERGED_FIELDS.map((field) => {
      if (survivor[field] === "") return merged[field];
      return survivor[field] !== merged[field] && choices[field] === "merged" ? merged[field] : survivor[field];
    });
    const [name, email, phone, company, address] = values;
    await run(client, "UPDATE guests SET name = $2, email = $3, phone = $4, company = $5, address = $6 WHERE id = $1", [survivor.id, name, email, phone, company, address]);
    const moved = await run(client, "UPDATE stays SET guest_id = $1 WHERE guest_id = $2", [survivor.id, merged.id]);
    await run(client, "DELETE FROM guests WHERE id = $1", [merged.id]);
    await emit(client, hotelId, { type: "merge", notice: notices.merged(moved) });
    return { survivorId: survivor.id, moved };
  });
  const guest = await findGuest(hotelId, outcome.survivorId);
  return ok({ guest: guestView(guest), staysMoved: outcome.moved });
}
