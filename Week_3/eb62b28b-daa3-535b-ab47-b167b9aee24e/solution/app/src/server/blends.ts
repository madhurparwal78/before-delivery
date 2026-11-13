// Packet packing and blend prices, in integer cents.

import { randomUUID } from "node:crypto";
import type { BlendView, PackedBlend } from "../shared/api";
import { wholeSeconds } from "../shared/time";
import { INGREDIENTS, PACKET_CAPSULES, type Ingredient } from "../shared/ingredients";
import { one, pool, rows, type Db } from "./db";
import { percentOfCents } from "./decimal";
import { ApiError, invalid } from "./errors";
import { records, text, type JsonBody } from "./fields";

const LIST_DAYS = 30;
const MEMBER_PERCENT = 85;

interface BlendItem {
  ingredient: string;
  capsulesPerDay: number;
}

function packetShare(ingredient: Ingredient, capsules: number): { morning: number; evening: number } {
  if (ingredient.time === "morning") return { morning: capsules, evening: 0 };
  if (ingredient.time === "evening") return { morning: 0, evening: capsules };
  const evening = Math.floor(capsules / 2);
  return { morning: capsules - evening, evening };
}

function packBlend(items: readonly BlendItem[]): PackedBlend {
  const packed = items.map((item) => {
    const ingredient = INGREDIENTS.find((entry) => entry.id === item.ingredient);
    if (!ingredient) throw new Error(`Unknown ingredient ${item.ingredient}`);
    return {
      item: { ...item, ...packetShare(ingredient, item.capsulesPerDay) },
      listCents: item.capsulesPerDay * LIST_DAYS * ingredient.priceCentsPerCapsule,
    };
  });
  const listPriceCents = packed.reduce((sum, entry) => sum + entry.listCents, 0);
  return {
    items: packed.map((entry) => entry.item),
    morningCapsules: packed.reduce((sum, entry) => sum + entry.item.morning, 0),
    eveningCapsules: packed.reduce((sum, entry) => sum + entry.item.evening, 0),
    listPriceCents,
    memberPriceCents: percentOfCents(listPriceCents, MEMBER_PERCENT),
  };
}

export function readBlend(body: JsonBody): PackedBlend {
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  const items = records(body["items"]).flatMap((row, index) => {
    const id = text(row, "ingredient");
    const capsules = row["capsulesPerDay"];
    if (!INGREDIENTS.some((entry) => entry.id === id)) fields[`items.${index}.ingredient`] = "Choose an ingredient from the catalog.";
    else if (seen.has(id)) fields[`items.${index}.ingredient`] = "Each ingredient appears once.";
    seen.add(id);
    if (typeof capsules !== "number" || !Number.isInteger(capsules) || capsules < 1) {
      fields[`items.${index}.capsulesPerDay`] = "Use a whole number of capsules, 1 or more.";
      return [];
    }
    return [{ ingredient: id, capsulesPerDay: capsules }];
  });
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const packed = packBlend(items);
  if (packed.morningCapsules > PACKET_CAPSULES) throw new ApiError(422, "packet_full", "The morning packet holds at most 4 capsules.");
  if (packed.eveningCapsules > PACKET_CAPSULES) throw new ApiError(422, "packet_full", "The evening packet holds at most 4 capsules.");
  return packed;
}

interface BlendRow {
  id: string;
  member_id: string;
  items: BlendItem[];
  saved_by: string;
  saved_at: Date;
}

function blendView(row: BlendRow): BlendView {
  return { ...packBlend(row.items), id: row.id, memberId: row.member_id, savedBy: row.saved_by, savedAt: wholeSeconds(row.saved_at) };
}

export async function saveBlend(db: Db, memberId: string, packed: PackedBlend, savedBy: string, now: Date): Promise<BlendView> {
  const row: BlendRow = {
    id: randomUUID(),
    member_id: memberId,
    items: packed.items.map(({ ingredient, capsulesPerDay }) => ({ ingredient, capsulesPerDay })),
    saved_by: savedBy,
    saved_at: now,
  };
  await db.query("INSERT INTO blends (id, member_id, items, saved_by, saved_at) VALUES ($1, $2, $3, $4, $5)", [
    row.id, memberId, JSON.stringify(row.items), savedBy, now,
  ]);
  return blendView(row);
}

export async function memberBlends(memberId: string): Promise<BlendView[]> {
  const found = await rows<BlendRow>(pool, "SELECT id, member_id, items, saved_by, saved_at FROM blends WHERE member_id = $1 ORDER BY seq DESC", [memberId]);
  return found.map(blendView);
}

export async function currentBlend(db: Db, memberId: string): Promise<BlendView | null> {
  const row = await one<BlendRow>(db, "SELECT id, member_id, items, saved_by, saved_at FROM blends WHERE member_id = $1 ORDER BY seq DESC LIMIT 1", [memberId]);
  return row ? blendView(row) : null;
}

export async function blendById(id: string): Promise<BlendView | null> {
  const row = await one<BlendRow>(pool, "SELECT id, member_id, items, saved_by, saved_at FROM blends WHERE id = $1", [id]);
  return row ? blendView(row) : null;
}
