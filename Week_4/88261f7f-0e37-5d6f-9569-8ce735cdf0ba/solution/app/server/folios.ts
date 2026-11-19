import type { Folio } from "../shared/api";
import type { IsoDate } from "../shared/dates";
import { isEmailAddress } from "../shared/email";
import { isAmountCents } from "../shared/money";
import { splitShares, validPercents } from "../shared/split";
import { database, inserted, one, rows, run, atomic, type Queryable, type Row } from "./db";
import { fail, isUuid, ok, type JsonObject, type Reply } from "./http";
import { loadHotel } from "./hotel";
import { emit } from "./live";
import { entryView, foliosOf, type EntryRow } from "./stayView";

const CLOSED = "This folio is closed.";
const CHANGED_AGAIN = "This entry cannot be changed again.";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface FolioRecord extends Row { id: string; stay_id: string; hotel_id: string; name: string; payer_name: string; payer_email: string; state: "open" | "closed" }
type EntryRecord = EntryRow;

export async function createFolio(client: Queryable, hotelId: string, stayId: string, payerName: string, payerEmail: string): Promise<FolioRecord> {
  const count = await inserted<Row & { count: number }>(client, "SELECT count(*)::int AS count FROM folios WHERE stay_id = $1", [stayId]);
  return inserted<FolioRecord>(
    client,
    "INSERT INTO folios (hotel_id, stay_id, name, payer_name, payer_email) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [hotelId, stayId, `Folio ${LETTERS[count.count]}`, payerName, payerEmail],
  );
}

async function insertEntry(
  client: Queryable, folioId: string, kind: "charge" | "payment", date: IsoDate, description: string, cents: number,
  roomNumber: string | null, links: { reverses?: string; splitOf?: string } = {},
): Promise<EntryRecord> {
  return inserted<EntryRecord>(
    client,
    `INSERT INTO entries (folio_id, kind, date, description, amount_cents, room_number, reverses_entry_id, split_of_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [folioId, kind, date, description, cents, roomNumber, links.reverses ?? null, links.splitOf ?? null],
  );
}

/** Posts a charge to the stay's first open folio, or to a new folio when none is open. */
export async function postCharge(client: Queryable, hotelId: string, stayId: string, date: IsoDate, description: string, cents: number, roomNumber: string): Promise<void> {
  const open = await one<FolioRecord>(client, "SELECT * FROM folios WHERE stay_id = $1 AND state = 'open' ORDER BY name LIMIT 1", [stayId]);
  const folio = open ?? (await createFolio(client, hotelId, stayId, ...(await payerOf(client, stayId))));
  await insertEntry(client, folio.id, "charge", date, description, cents, roomNumber);
}

async function payerOf(client: Queryable, stayId: string): Promise<[string, string]> {
  const guest = await inserted<Row & { name: string; email: string }>(client, "SELECT g.name, g.email FROM stays s JOIN guests g ON g.id = s.guest_id WHERE s.id = $1", [stayId]);
  return [guest.name, guest.email];
}

async function findFolio(client: Queryable, hotelId: string, folioId: string, lock = false): Promise<FolioRecord> {
  const folio = isUuid(folioId)
    ? await one<FolioRecord>(client, `SELECT * FROM folios WHERE id = $1 AND hotel_id = $2${lock ? " FOR UPDATE" : ""}`, [folioId, hotelId])
    : undefined;
  if (!folio) throw fail.notFound();
  return folio;
}

/** The entry, locked together with its folio (folio first, as the folio close does), so its folio state is the committed one. */
async function findEntry(client: Queryable, hotelId: string, entryId: string): Promise<EntryRecord & { stay_id: string; folio_state: "open" | "closed" }> {
  if (!isUuid(entryId)) throw fail.notFound();
  for (;;) {
    const at = await one<Row & { folio_id: string }>(
      client, "SELECT e.folio_id FROM entries e JOIN folios f ON f.id = e.folio_id WHERE e.id = $1 AND f.hotel_id = $2", [entryId, hotelId]);
    if (!at) throw fail.notFound();
    await rows(client, "SELECT id FROM folios WHERE id = $1 FOR UPDATE", [at.folio_id]);
    const entry = await one<EntryRecord & { stay_id: string; folio_state: "open" | "closed" }>(
      client,
      `SELECT e.*, f.stay_id, f.state AS folio_state FROM entries e JOIN folios f ON f.id = e.folio_id
       WHERE e.id = $1 AND f.hotel_id = $2 FOR UPDATE OF e`,
      [entryId, hotelId]);
    if (!entry) throw fail.notFound();
    if (entry.folio_id === at.folio_id) return entry;
  }
}

async function folioView(client: Queryable, stayId: string, folioId: string): Promise<Folio> {
  return (await foliosOf(client, stayId)).find((folio) => folio.id === folioId) as Folio;
}

function payerErrors(body: JsonObject): { name: string; email: string; errors: Record<string, string> } {
  const name = typeof body.payerName === "string" ? body.payerName.trim() : "";
  const email = typeof body.payerEmail === "string" ? body.payerEmail.trim() : "";
  const errors: Record<string, string> = {};
  if (!name) errors.payerName = "Enter the payer's name.";
  const wrongType = body.payerEmail !== undefined && body.payerEmail !== null && typeof body.payerEmail !== "string";
  if (wrongType || (email !== "" && !isEmailAddress(email))) errors.payerEmail = "Enter the payer's email address.";
  return { name, email, errors };
}

async function stayOfHotel(client: Queryable, hotelId: string, stayId: string): Promise<void> {
  const found = isUuid(stayId) ? await one(client, "SELECT 1 FROM stays WHERE id = $1 AND hotel_id = $2", [stayId, hotelId]) : undefined;
  if (!found) throw fail.notFound();
}

export async function addFolio(hotelId: string, stayId: string, body: JsonObject): Promise<Reply> {
  const created = await atomic(async (client) => {
    await stayOfHotel(client, hotelId, stayId);
    const { name, email, errors } = payerErrors(body);
    if (Object.keys(errors).length > 0) throw fail.invalid(errors);
    const folio = await createFolio(client, hotelId, stayId, name, email);
    await emit(client, hotelId, { type: "stay", stayId, notice: null });
    return folio.id;
  });
  return ok(await folioView(database(), stayId, created), 201);
}

export async function savePayer(hotelId: string, folioId: string, body: JsonObject): Promise<Reply> {
  const folio = await atomic(async (client) => {
    const found = await findFolio(client, hotelId, folioId, true);
    if (found.state === "closed") throw fail.conflict(CLOSED);
    const { name, email, errors } = payerErrors(body);
    if (Object.keys(errors).length > 0) throw fail.invalid(errors);
    await run(client, "UPDATE folios SET payer_name = $2, payer_email = $3 WHERE id = $1", [folioId, name, email]);
    await emit(client, hotelId, { type: "stay", stayId: found.stay_id, notice: null });
    return found;
  });
  return ok(await folioView(database(), folio.stay_id, folioId));
}

export async function addCharge(hotelId: string, folioId: string, body: JsonObject): Promise<Reply> {
  const entry = await atomic(async (client) => {
    const folio = await findFolio(client, hotelId, folioId, true);
    if (folio.state === "closed") throw fail.conflict(CLOSED);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const errors: Record<string, string> = {};
    if (!description) errors.description = "Enter a description.";
    if (!isAmountCents(body.amountCents)) errors.amountCents = "Enter an amount above zero.";
    if (Object.keys(errors).length > 0 || !isAmountCents(body.amountCents)) throw fail.invalid(errors);
    const hotel = await loadHotel(client, hotelId);
    const created = await insertEntry(client, folioId, "charge", hotel.businessDate, description, body.amountCents, null);
    await emit(client, hotelId, { type: "stay", stayId: folio.stay_id, notice: null });
    return created;
  });
  return ok(entryView(entry), 201);
}

export async function addPayment(hotelId: string, folioId: string, body: JsonObject): Promise<Reply> {
  const entry = await atomic(async (client) => {
    const folio = await findFolio(client, hotelId, folioId, true);
    if (folio.state === "closed") throw fail.conflict(CLOSED);
    const errors: Record<string, string> = {};
    const method = body.method === "cash" || body.method === "card" ? body.method : null;
    if (!method) errors.method = "Choose cash or card.";
    if (!isAmountCents(body.amountCents)) errors.amountCents = "Enter an amount above zero.";
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (method === "card" && !reference) errors.reference = "Enter the terminal reference.";
    if (Object.keys(errors).length > 0 || !method || !isAmountCents(body.amountCents)) throw fail.invalid(errors);
    const hotel = await loadHotel(client, hotelId);
    const description = method === "cash" ? "Cash payment" : `Card payment ${reference}`;
    const created = await insertEntry(client, folioId, "payment", hotel.businessDate, description, body.amountCents, null);
    await emit(client, hotelId, { type: "stay", stayId: folio.stay_id, notice: null });
    return created;
  });
  return ok(entryView(entry), 201);
}

/** An entry that is itself a reversal, or that a reversal already points at (a split reverses it too), is final. */
async function assertChangeable(client: Queryable, entry: EntryRecord): Promise<void> {
  const reversed = await one(client, "SELECT 1 FROM entries WHERE reverses_entry_id = $1", [entry.id]);
  if (entry.reverses_entry_id !== null || reversed) throw fail.conflict(CHANGED_AGAIN);
}

async function postReversal(client: Queryable, hotelId: string, entry: EntryRecord): Promise<EntryRecord> {
  const hotel = await loadHotel(client, hotelId);
  return insertEntry(client, entry.folio_id, entry.kind, hotel.businessDate, `Reversal of ${entry.description}`, -entry.amount_cents, entry.room_number, { reverses: entry.id });
}

export async function reverseEntry(hotelId: string, entryId: string): Promise<Reply> {
  const reversal = await atomic(async (client) => {
    const entry = await findEntry(client, hotelId, entryId);
    await assertChangeable(client, entry);
    if (entry.folio_state === "closed") throw fail.conflict(CLOSED);
    const created = await postReversal(client, hotelId, entry);
    await emit(client, hotelId, { type: "stay", stayId: entry.stay_id, notice: null });
    return created;
  });
  return ok(entryView(reversal), 201);
}

export async function splitEntry(hotelId: string, entryId: string, body: JsonObject): Promise<Reply> {
  const stayId = await atomic(async (client) => {
    const entry = await findEntry(client, hotelId, entryId);
    await assertChangeable(client, entry);
    if (entry.kind === "payment") throw fail.conflict(CHANGED_AGAIN);
    if (entry.folio_state === "closed") throw fail.conflict(CLOSED);
    const percents: unknown[] = Array.isArray(body.percents) ? body.percents : [];
    if (!validPercents(percents)) throw fail.invalid({ percents: "Enter 2 to 4 whole percentages that add up to 100." });
    let folios = await rows<FolioRecord>(client, "SELECT * FROM folios WHERE stay_id = $1 ORDER BY name FOR UPDATE", [entry.stay_id]);
    const [payerName, payerEmail] = await payerOf(client, entry.stay_id);
    while (folios.length < percents.length) {
      await createFolio(client, hotelId, entry.stay_id, payerName, payerEmail);
      folios = await rows<FolioRecord>(client, "SELECT * FROM folios WHERE stay_id = $1 ORDER BY name FOR UPDATE", [entry.stay_id]);
    }
    const targets = folios.slice(0, percents.length);
    if (targets.some((folio) => folio.state === "closed")) throw fail.conflict(CLOSED);
    await postReversal(client, hotelId, entry);
    const hotel = await loadHotel(client, hotelId);
    const shares = splitShares(entry.amount_cents, percents);
    for (const [index, folio] of targets.entries()) {
      await insertEntry(client, folio.id, "charge", hotel.businessDate, `${entry.description} (${percents[index]}%)`, shares[index], entry.room_number, { splitOf: entry.id });
    }
    await emit(client, hotelId, { type: "stay", stayId: entry.stay_id, notice: null });
    return entry.stay_id;
  });
  return ok({ folios: await foliosOf(database(), stayId) }, 201);
}

export async function moveEntry(hotelId: string, entryId: string, body: JsonObject): Promise<Reply> {
  const stayId = await atomic(async (client) => {
    const entry = await findEntry(client, hotelId, entryId);
    const target = typeof body.toFolioId === "string" && isUuid(body.toFolioId)
      ? await one<FolioRecord>(client, "SELECT * FROM folios WHERE id = $1 AND stay_id = $2 FOR UPDATE", [body.toFolioId, entry.stay_id])
      : undefined;
    if (entry.folio_state === "closed" || target?.state === "closed") throw fail.conflict(CLOSED);
    if (!target) throw fail.invalid({ toFolioId: "Choose a folio." });
    await run(client, "UPDATE entries SET folio_id = $2 WHERE id = $1", [entryId, target.id]);
    await emit(client, hotelId, { type: "stay", stayId: entry.stay_id, notice: null });
    return entry.stay_id;
  });
  return ok({ folios: await foliosOf(database(), stayId) });
}

