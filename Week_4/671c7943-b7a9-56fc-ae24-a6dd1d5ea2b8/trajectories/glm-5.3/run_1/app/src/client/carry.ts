export interface CarryData {
  fromSlug: string;
  tileIndex: number;
}

const CARRY_KEY = "__sollis_carry";

export function readCarry(): CarryData | null {
  const raw = (window as unknown as Record<string, unknown>)[CARRY_KEY];
  return typeof raw === "object" && raw !== null ? (raw as CarryData) : null;
}

export function writeCarry(data: CarryData | null): void {
  (window as unknown as Record<string, unknown>)[CARRY_KEY] = data;
}
