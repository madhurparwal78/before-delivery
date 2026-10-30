// The build as the viewer draws it.
import type { Slot } from "../catalog.ts";

export interface SceneBuild {
  finish: string;
  parts: Record<Slot, { sku: string; name: string; colour: string }>;
  /** The mast length in metres with three decimals, as the catalog gives it. */
  mastM: string;
  spares: number;
}
