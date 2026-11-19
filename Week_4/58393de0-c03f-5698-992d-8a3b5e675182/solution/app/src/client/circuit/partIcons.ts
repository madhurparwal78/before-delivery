import { BatteryFull, Lightbulb, Omega, ToggleLeft, type LucideIcon } from "lucide-react";
import type { CircuitPartType } from "../../shared/types";

export const PART_ICONS: Record<CircuitPartType, LucideIcon> = { battery: BatteryFull, led: Lightbulb, resistor: Omega, switch: ToggleLeft };
