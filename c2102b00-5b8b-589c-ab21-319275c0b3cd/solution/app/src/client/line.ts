// A case line as the server sends it, and the two facts about it the screens share.
export interface Line {
  product_id: string;
  case_name: string;
  pack: number;
  unit: string;
  price_cents: number;
  version: number;
  pledged_units: number;
  units_to_go: number;
  status: "filling" | "sealed" | "dropped" | "taken_up";
  short_units: number;
  my_units: number | null;
  my_short_units: number | null;
  cells: ("mine" | "taken" | "empty")[];
}

/** As many columns as the smallest divisor of the pack that is at least its square root. */
export function gridColumns(pack: number): number {
  for (let c = Math.ceil(Math.sqrt(pack)); c <= pack; c++) if (pack % c === 0) return c;
  return pack;
}

export const onSealedSide = (line: Line) => line.status === "sealed" || line.status === "taken_up";
