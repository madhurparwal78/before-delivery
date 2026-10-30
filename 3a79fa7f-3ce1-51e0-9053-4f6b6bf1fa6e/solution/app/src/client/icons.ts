// Thin line icons (Lucide-style, 1.5px stroke) drawn in the text colour.
import { s } from "./dom.ts";

const PATHS: Record<string, string[]> = {
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  caret: ["m6 9 6 6 6-6"],
  cross: ["M18 6 6 18", "m6 6 12 12"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  tick: ["M20 6 9 17l-5-5"],
  notAllowed: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m4.9 4.9 14.2 14.2"],
  search: ["m21 21-4.3-4.3", "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"],
  person: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  bag: ["M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z", "M3 6h18", "M16 10a4 4 0 0 1-8 0"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  error: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 8v4", "M12 16h.01"],
};

export function icon(name: keyof typeof PATHS, size = 20, className = "icon"): SVGSVGElement {
  return s(
    "svg",
    { class: className, width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" },
    (PATHS[name] ?? []).map((d) => s("path", { d })),
  );
}
