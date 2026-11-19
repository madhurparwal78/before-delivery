import { s } from "./dom";

// Side-profile line drawings of the cars, in the cream, ink and accent palette.
interface Profile {
  readonly body: string;
  readonly cabin: string;
}

const PROFILES: Readonly<Record<string, Profile>> = {
  "kestrel-hatch": { body: "M56 150 L72 122 L246 122 L266 146 L266 168 L56 168 Z", cabin: "M100 122 L122 88 L224 88 L240 122 Z" },
  "wren-coupe": { body: "M48 152 L70 126 L252 124 L276 148 L276 168 L48 168 Z", cabin: "M108 126 L140 96 L206 96 L240 124 Z" },
  "moth-roadster": { body: "M56 152 L76 130 L248 128 L268 150 L268 168 L56 168 Z", cabin: "M132 130 L150 108 L160 108 L150 130 Z" },
  "halcyon-rs": { body: "M44 152 L66 126 L254 124 L282 148 L282 168 L44 168 Z", cabin: "M104 126 L138 94 L210 94 L242 124 Z" },
  "ferrule-sport": { body: "M40 154 L64 130 L258 126 L286 150 L286 168 L40 168 Z", cabin: "M112 130 L148 100 L212 100 L244 126 Z" },
  "vantor-8": { body: "M36 156 L60 136 L262 130 L290 152 L290 168 L36 168 Z", cabin: "M118 136 L156 108 L216 106 L246 130 Z" },
};

export function carDrawing(carId: string, label: string | null): SVGSVGElement {
  const profile = PROFILES[carId] ?? PROFILES["kestrel-hatch"];
  const naming = label === null ? { "aria-hidden": "true", focusable: "false" } : { role: "img", "aria-label": label };
  return s("svg", { viewBox: "20 70 290 125", class: "car-drawing", ...naming },
    s("line", { x1: 24, y1: 184, x2: 306, y2: 184, stroke: "#1c1a16", "stroke-width": 2 }),
    s("path", { d: profile.body, fill: "#b93e0b", stroke: "#1c1a16", "stroke-width": 3, "stroke-linejoin": "round" }),
    s("path", { d: profile.cabin, fill: "#faf5e6", stroke: "#1c1a16", "stroke-width": 3, "stroke-linejoin": "round" }),
    ...[100, 226].flatMap((cx) => [
      s("circle", { cx, cy: 168, r: 16, fill: "#1c1a16" }),
      s("circle", { cx, cy: 168, r: 6, fill: "#faf5e6" }),
    ]));
}
