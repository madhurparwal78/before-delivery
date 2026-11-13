// Contractors and erasure: names, phones and emails go; operator codes stay on every record.
import { handOver } from "./cards.ts";
import { tx, type Db } from "./db.ts";
import { ApiError, notFound } from "./http.ts";
import { CARD_SELECT, type CardRow } from "./records.ts";

export async function listContractors(db: Db) {
  const found = await db.query<{ code: string; name: string | null; phone: string | null; erased: boolean }>(
    "SELECT operator_code AS code, name, phone, erased FROM person WHERE operator_kind = 'contractor' ORDER BY operator_code",
  );
  return found.rows;
}

export async function eraseContractor(code: string) {
  return tx(async (db) => {
    const found = await db.query<{ id: number; erased: boolean }>(
      "SELECT id, erased FROM person WHERE operator_code = $1 AND operator_kind = 'contractor'",
      [code],
    );
    const person = found.rows[0];
    if (!person) throw notFound();
    if (person.erased) throw new ApiError(409, "already_erased", "This contractor has already been erased.");
    const open = await db.query<CardRow>(`${CARD_SELECT} WHERE g.holder_code = $1 AND g.state = 'open' ORDER BY g.id`, [code]);
    const handedOver: number[] = [];
    for (const card of open.rows) {
      await handOver(db, card, code);
      handedOver.push(card.id);
    }
    await db.query("DELETE FROM session WHERE person_id = $1", [person.id]);
    await db.query(
      "UPDATE person SET name = NULL, phone = NULL, email = NULL, password_hash = NULL, erased = true WHERE id = $1",
      [person.id],
    );
    return { contractor: { code, name: null, phone: null, erased: true }, handed_over: handedOver };
  });
}
