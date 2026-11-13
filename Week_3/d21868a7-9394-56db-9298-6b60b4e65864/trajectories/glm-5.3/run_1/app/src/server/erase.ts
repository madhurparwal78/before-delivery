// Contractor erasure: removes personal details everywhere, ends sessions at
// once, and hands over every open card. Operator codes stay.
import { Store } from "./store.ts";
import { handOverAllCards } from "./cards.ts";
import { ApiError } from "./errors.ts";

export async function eraseContractor(
  store: Store,
  operatorCode: string,
  now: number,
): Promise<{ code: string; handed_over: string[] }> {
  const person = await store.query<{ id: number; erased: boolean }>(
    "SELECT id, erased FROM people WHERE role = 'operator' AND operator_code = $1",
    [operatorCode],
  );
  if (!person.rows[0]) throw new ApiError(404, "not_found", "There is no such record.");
  if (person.rows[0].erased) throw new ApiError(409, "already_erased", "This contractor has already been erased.");

  const handedOver = await handOverAllCards(store, operatorCode, now);
  await store.transaction(async (client) => {
    await client.query(
      `UPDATE people SET name = 'Operator ' || $1, email = $2, phone = null, password_hash = '', erased = true WHERE id = $3`,
      [operatorCode, `${operatorCode.toLowerCase()}@erased.invalid`, person.rows[0]!.id],
    );
    await client.query("DELETE FROM sessions WHERE person_id = $1", [person.rows[0]!.id]);
  });
  return { code: operatorCode, handed_over: handedOver };
}
