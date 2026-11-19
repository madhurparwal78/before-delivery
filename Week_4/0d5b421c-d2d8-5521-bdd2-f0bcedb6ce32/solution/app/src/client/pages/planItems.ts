// Turns the API's plan into drawable items. The status words are the published ones; nothing is decided here.
import type { FloorResponse, PlanResponse, PlanStatus } from "../../shared/api.js";
import type { PlanRoom } from "../components/FloorPlan.js";
import type { Look } from "../components/TableGlyph.js";

export const STATUS_WORDS: Record<PlanStatus, string> = {
  fits: "Fits your party",
  not_for_party: "Not for your party",
  taken: "Taken",
};

const LOOKS: Record<PlanStatus, Look> = { fits: "outline", not_for_party: "muted", taken: "hatched" };

interface HeldTable {
  targetId: string;
  partySize: number;
}

export function guestRooms(
  floor: FloorResponse,
  plan: PlanResponse,
  held: HeldTable | null,
  extras: (targetId: string, isHeld: boolean) => { ring?: React.ReactNode; note?: string },
): PlanRoom[] {
  const statusOf = new Map<string, PlanStatus>([
    ...plan.tables.map((table): [string, PlanStatus] => [table.table_id, table.status]),
    ...plan.pairs.map((pair): [string, PlanStatus] => [pair.pair_id, pair.status]),
  ]);
  const wordFor = (id: string): { word: string; look: Look; isHeld: boolean } => {
    if (held?.targetId === id) return { word: "Held by you", look: "solid", isHeld: true };
    const status = statusOf.get(id) ?? "not_for_party";
    return { word: STATUS_WORDS[status], look: LOOKS[status], isHeld: false };
  };
  return floor.rooms.map((room) => {
    const singles = room.tables.map((table) => {
      const { word, look, isHeld } = wordFor(table.table_id);
      return {
        id: table.table_id,
        name: `Table ${table.table_id}, ${room.name}, ${table.min_seats} to ${table.max_seats} seats, ${word}`,
        idLabel: table.table_id,
        statusWord: word,
        look,
        maxSeats: table.max_seats,
        holdParty: isHeld ? (held?.partySize ?? null) : null,
        ...extras(table.table_id, isHeld),
      };
    });
    const pairs = floor.joinable_pairs
      .filter((pair) => plan.pairs.some((entry) => entry.pair_id === pair.pair_id) && room.tables.some((table) => table.table_id === pair.tables[0]))
      .map((pair) => {
        const { word, look, isHeld } = wordFor(pair.pair_id);
        return {
          id: pair.pair_id,
          name: `Tables ${pair.tables[0]} and ${pair.tables[1]} joined, ${room.name}, ${pair.min_seats} to ${pair.max_seats} seats, ${word}`,
          idLabel: pair.pair_id,
          statusWord: word,
          look,
          maxSeats: pair.max_seats,
          holdParty: isHeld ? (held?.partySize ?? null) : null,
          ...extras(pair.pair_id, isHeld),
        };
      });
    return { roomId: room.room_id, name: room.name, items: [...singles, ...pairs] };
  });
}
