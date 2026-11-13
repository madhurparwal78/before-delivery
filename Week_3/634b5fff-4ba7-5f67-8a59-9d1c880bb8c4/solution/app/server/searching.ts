import { plateOf } from "../shared/domain.js";
import { pool } from "./db.js";
import { registerJob } from "./jobs.js";
import { recipientOf, type OrderRow } from "./orders.js";
import { removePublicBoxes, searchPublic, searchStaff, SearchUnreachable, upsertPublicBoxes, upsertStaffBoxes, type StaffBoxDocument } from "./search.js";
import { readShelf } from "./shelf.js";

/** Search over the shelf and the tale: index sync from Postgres, public hits with live state, staff hits with a database fallback. */

interface BoxRow {
  number: number;
  state: string;
}

const staffDocuments = async (numbers: number[] | null): Promise<StaffBoxDocument[]> => {
  const boxes = (await pool.query("SELECT number, state FROM boxes WHERE $1::int[] IS NULL OR number = ANY($1) ORDER BY number", [numbers])).rows as BoxRow[];
  const orders = (await pool.query("SELECT * FROM orders WHERE live")).rows as OrderRow[];
  return boxes.map((box) => {
    const order = orders.find((candidate) => candidate.box_number === box.number);
    return {
      id: `box-${box.number}`, number: box.number, plate: plateOf(box.number), state: box.state,
      recipientName: order ? recipientOf(order).name : null, reference: order?.reference ?? null,
    };
  });
};

/** Brings the indexes in line with Postgres for the given boxes (all boxes when null). */
export const syncBoxes = async (numbers: number[] | null): Promise<void> => {
  const documents = await staffDocuments(numbers);
  await upsertStaffBoxes(documents);
  await upsertPublicBoxes(documents.filter((box) => box.state === "available").map((box) => box.number));
  await removePublicBoxes(documents.filter((box) => box.state !== "available").map((box) => box.number));
};

registerJob("search", async (payload) => {
  await syncBoxes(payload.numbers as number[]);
});

export const publicSearch = async (query: string): Promise<Record<string, unknown>[]> => {
  const [hits, shelf] = await Promise.all([searchPublic(query), readShelf()]);
  return hits.flatMap((hit): Record<string, unknown>[] => {
    if (hit.kind === "passage") return [{ kind: "passage", passageId: hit.passageId, chapter: hit.chapter, excerpt: hit.excerpt ?? "" }];
    const state = shelf.states[(hit.number ?? 0) - 1] ?? "taken";
    return state === "taken" ? [] : [{ kind: "box", number: hit.number, plate: hit.plate, state }];
  });
};

const staffHit = (document: StaffBoxDocument): Record<string, unknown> => ({
  number: document.number, plate: document.plate, state: document.state, recipientName: document.recipientName, reference: document.reference,
});

export const staffSearch = async (query: string): Promise<{ hits: Record<string, unknown>[]; degraded: boolean }> => {
  if (query === "") return { hits: [], degraded: false };
  try {
    return { hits: (await searchStaff(query)).map(staffHit), degraded: false };
  } catch (error) {
    if (!(error instanceof SearchUnreachable)) throw error;
    const needle = query.toLowerCase();
    const documents = (await staffDocuments(null)).filter((document) =>
      String(document.number) === needle || document.plate.toLowerCase() === needle || (document.recipientName ?? "").toLowerCase().includes(needle));
    return { hits: documents.slice(0, 50).map(staffHit), degraded: true };
  }
};
