// Shared definitions of shop display states, used by map, legend and table.
export interface ShopStateDef {
  key: "open" | "closing_soon" | "closed" | "stock_critical" | "suspended";
  label: string;
  fill: string;
  ringWidth: string;
  dash: string;
}

export const SHOP_STATES: ShopStateDef[] = [
  { key: "open", label: "Open", fill: "#33c98a", ringWidth: "2px", dash: "none" },
  { key: "closing_soon", label: "Closing soon", fill: "#f4c94c", ringWidth: "3px", dash: "6 4" },
  { key: "closed", label: "Closed", fill: "#9a9a94", ringWidth: "1px", dash: "2 3" },
  { key: "stock_critical", label: "Stock critical", fill: "#ff7043", ringWidth: "4px", dash: "3 3" },
  { key: "suspended", label: "Suspended", fill: "#fbe9e9", ringWidth: "2px", dash: "1 5" },
];

export function stateDef(key: string): ShopStateDef {
  return SHOP_STATES.find((s) => s.key === key) ?? SHOP_STATES[0];
}

export function stateLabelLower(key: string): string {
  const def = stateDef(key);
  return def.label.toLowerCase();
}

export function markerDotStyle(key: string): string {
  const def = stateDef(key);
  return `background: ${def.fill}; border: ${def.ringWidth} dashed ${def.key === "suspended" ? def.fill : def.fill}; border-image: none;`;
}
