// A booking reference is reserved by the first confirm attempt and reused by every later one.
import { pool, rows } from "./db.js";
import { newReferenceCandidate } from "./ids.js";

export async function reserveReference(ownerId: string): Promise<string> {
  for (;;) {
    await pool.query("INSERT INTO booking_references (reference, owner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      newReferenceCandidate(),
      ownerId,
    ]);
    const [owned] = await rows<{ reference: string }>(pool, "SELECT reference FROM booking_references WHERE owner_id = $1", [ownerId]);
    if (owned !== undefined) return owned.reference;
  }
}
