import type { WorldPosition } from "../../shared/sync.ts";

const NEXT_COLUMN = 280;
const ROW_HEIGHT = 200;
const SLOTS_PER_COLUMN = 5;

/** The Card slot rule: `count` empty positions laid out right of every positioned card. */
export function cardSlots(positioned: readonly WorldPosition[], count: number): WorldPosition[] {
  const right = positioned.length ? Math.max(...positioned.map((card) => card.x)) + NEXT_COLUMN : 0;
  return Array.from({ length: count }, (_, i) => ({
    x: right + NEXT_COLUMN * Math.floor(i / SLOTS_PER_COLUMN),
    y: ROW_HEIGHT * (i % SLOTS_PER_COLUMN),
  }));
}
