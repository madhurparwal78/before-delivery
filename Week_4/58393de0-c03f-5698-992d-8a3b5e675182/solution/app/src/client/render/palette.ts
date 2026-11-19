/** The toy-bright primaries every new shape cycles through. */
export const TOY_COLORS = ["#35b558", "#7a3fd1", "#f58220", "#1e90ff"] as const;

/** The colour for the shape at `index` in creation order. */
export function nextShapeColor(index: number): string {
  return TOY_COLORS[((index % TOY_COLORS.length) + TOY_COLORS.length) % TOY_COLORS.length] ?? TOY_COLORS[0];
}

export const HOLE_GREY = "#8b94a3";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const resolved = new Map<string, string | null>();
let probe: CanvasRenderingContext2D | null | undefined;

function expandHex(color: string): string {
  const lower = color.toLowerCase();
  return lower.length === 4 ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}` : lower;
}

/** Any CSS colour the browser understands, as #rrggbb; null when it is not a colour. */
function cssColorToHex(color: string): string | null {
  if (probe === undefined) probe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  const sentinel = "#010203";
  probe.fillStyle = sentinel;
  probe.fillStyle = color;
  const value = probe.fillStyle;
  if (value === sentinel && color.trim().toLowerCase() !== sentinel) return null;
  if (HEX.test(value)) return expandHex(value);
  const channels = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(value);
  if (!channels) return null;
  return `#${[1, 2, 3].map((i) => Number(channels[i]).toString(16).padStart(2, "0")).join("")}`;
}

/** The colour as #rrggbb, or null when it is not a valid CSS colour. */
function toHex(color: string): string | null {
  const cached = resolved.get(color);
  if (cached !== undefined) return cached;
  const hex = HEX.test(color) ? expandHex(color) : cssColorToHex(color);
  resolved.set(color, hex);
  return hex;
}

/** A design object's colour, or the toy primary for its position in the design when that is not a valid CSS colour. */
export function displayColor(color: string, index: number): string {
  return toHex(color) ?? nextShapeColor(index);
}

/** Mixes #rrggbb with another #rrggbb; `amount` 0 keeps `hex`, 1 gives `towards`. */
export function mixHex(hex: string, towards: string, amount: number): string {
  const channel = (value: string, at: number) => parseInt(value.slice(at, at + 2), 16);
  const part = (at: number) => Math.round(channel(hex, at) * (1 - amount) + channel(towards, at) * amount).toString(16).padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
}
