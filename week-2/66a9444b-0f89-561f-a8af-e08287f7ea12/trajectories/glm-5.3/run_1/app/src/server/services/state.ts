import type { PoolClient } from "pg";
import { errors } from "../errors.js";

export type ItemStatus = "draft" | "review" | "scheduled" | "published" | "cancelled";

interface LegalMove {
  from: ItemStatus;
  to: ItemStatus;
  needsPublishAt?: boolean;
}

// The single state machine shared by sessions and artwork entries.
const LEGAL_MOVES: LegalMove[] = [
  { from: "draft", to: "review" },
  { from: "review", to: "draft" },
  { from: "review", to: "scheduled", needsPublishAt: true },
  { from: "scheduled", to: "review" },
  { from: "scheduled", to: "published" },
  { from: "scheduled", to: "cancelled" },
  { from: "published", to: "cancelled" },
];

export function isLegalMove(from: string, to: string): boolean {
  return LEGAL_MOVES.some((m) => m.from === from && m.to === to);
}

export function moveRequiresPublishAt(from: string, to: string): boolean {
  return LEGAL_MOVES.some((m) => m.from === from && m.to === to && m.needsPublishAt === true);
}

export function editableIn(status: string): boolean {
  return status === "draft" || status === "review" || status === "scheduled";
}

export async function recordHistory(
  client: PoolClient,
  itemType: "session" | "entry",
  itemId: string,
  from: string,
  to: string,
  by: string,
  note: string | null,
): Promise<void> {
  await client.query(
    "insert into item_history (item_type, item_id, from_status, to_status, at, by, note) values ($1,$2,$3,$4,now(),$5,$6)",
    [itemType, itemId, from, to, by, note],
  );
}

export async function getHistory(client: PoolClient, itemType: "session" | "entry", itemId: string) {
  const res = await client.query(
    "select from_status, to_status, at, by from item_history where item_type = $1 and item_id = $2 order by at, id",
    [itemType, itemId],
  );
  return res.rows.map((r) => ({ from: String(r.from_status), to: String(r.to_status), at: r.at, by: String(r.by) }));
}

export function illegalTransition(from: string, to: string): never {
  throw errors.conflict("illegal_transition", { from, to });
}
