// Catalog and build shapes as the API returns them; fits, stock, prices and ride time always come from the server.
export type Slot = "wing" | "mast" | "propulsion" | "battery" | "controller";
export const SLOT_NAMES: [Slot, string][] = [["wing", "Wing"], ["mast", "Mast"], ["propulsion", "Propulsion"], ["battery", "Battery"], ["controller", "Controller"]];

export interface FinancingTerm {
  months: number;
  apr_bp: number;
  monthly_cents: number;
  last_cents: number;
}

export interface BoardPackage {
  sku: string;
  name: string;
  size: string;
  finish: string;
  price_cents: number;
  defaults: Record<Slot, string>;
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface Component {
  sku: string;
  slot: Slot;
  name: string;
  colour: string;
  price_cents: number;
  wh: number | null;
  mast_m: string | null;
  fits: string[];
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface Accessory {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface Catalog {
  boards: BoardPackage[];
  components: Component[];
  accessories: Accessory[];
}

export interface Build {
  code: string;
  board_sku: string;
  board_name: string;
  slots: Record<Slot, { sku: string; name: string; delta_cents: number }>;
  spares: number;
  rider_kg: number;
  gear: number;
  total_cents: number;
  ride_min: number;
  total_ride_min: number;
  battery_bars: number;
  financing: FinancingTerm[];
}
