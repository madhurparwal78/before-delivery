// Lucide icons (ISC licence, lucide.dev), path data inlined so no icon is fetched.

import { s } from "./dom.ts";

const ICONS = {
  "menu": [["path", { "d": "M4 5h16" }], ["path", { "d": "M4 12h16" }], ["path", { "d": "M4 19h16" }]],
  "x": [["path", { "d": "M18 6 6 18" }], ["path", { "d": "m6 6 12 12" }]],
  "chevron-left": [["path", { "d": "m15 18-6-6 6-6" }]],
  "chevron-right": [["path", { "d": "m9 18 6-6-6-6" }]],
  "locate-fixed": [["line", { "x1": "2", "x2": "5", "y1": "12", "y2": "12" }], ["line", { "x1": "19", "x2": "22", "y1": "12", "y2": "12" }], ["line", { "x1": "12", "x2": "12", "y1": "2", "y2": "5" }], ["line", { "x1": "12", "x2": "12", "y1": "19", "y2": "22" }], ["circle", { "cx": "12", "cy": "12", "r": "7" }], ["circle", { "cx": "12", "cy": "12", "r": "3" }]],
  "play": [["path", { "d": "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]],
  "lightbulb": [["path", { "d": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }], ["path", { "d": "M9 18h6" }], ["path", { "d": "M10 22h4" }]],
  "plug": [["path", { "d": "M12 22v-5" }], ["path", { "d": "M15 8V2" }], ["path", { "d": "M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" }], ["path", { "d": "M9 8V2" }]],
  "thermometer": [["path", { "d": "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" }]],
  "video": [["path", { "d": "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" }], ["rect", { "x": "2", "y": "6", "width": "14", "height": "12", "rx": "2" }]],
  "house": [["path", { "d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }], ["path", { "d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]],
  "layers": [["path", { "d": "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" }], ["path", { "d": "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }], ["path", { "d": "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }]],
  "palette": [["path", { "d": "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }], ["circle", { "cx": "13.5", "cy": "6.5", "r": ".5", "fill": "currentColor" }], ["circle", { "cx": "17.5", "cy": "10.5", "r": ".5", "fill": "currentColor" }], ["circle", { "cx": "6.5", "cy": "12.5", "r": ".5", "fill": "currentColor" }], ["circle", { "cx": "8.5", "cy": "7.5", "r": ".5", "fill": "currentColor" }]],
  "user-round-check": [["path", { "d": "M2 21a8 8 0 0 1 13.292-6" }], ["circle", { "cx": "10", "cy": "8", "r": "5" }], ["path", { "d": "m16 19 2 2 4-4" }]],
  "scroll-text": [["path", { "d": "M15 12h-5" }], ["path", { "d": "M15 8h-5" }], ["path", { "d": "M19 17V5a2 2 0 0 0-2-2H4" }], ["path", { "d": "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" }]],
  "mail": [["path", { "d": "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" }], ["rect", { "x": "2", "y": "4", "width": "20", "height": "16", "rx": "2" }]],
  "plus": [["path", { "d": "M5 12h14" }], ["path", { "d": "M12 5v14" }]],
  "trash-2": [["path", { "d": "M10 11v6" }], ["path", { "d": "M14 11v6" }], ["path", { "d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }], ["path", { "d": "M3 6h18" }], ["path", { "d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]],
  "rotate-ccw": [["path", { "d": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { "d": "M3 3v5h5" }]],
  "circle-alert": [["circle", { "cx": "12", "cy": "12", "r": "10" }], ["line", { "x1": "12", "x2": "12", "y1": "8", "y2": "12" }], ["line", { "x1": "12", "x2": "12.01", "y1": "16", "y2": "16" }]],
  "wifi-off": [["path", { "d": "M12 20h.01" }], ["path", { "d": "M8.5 16.429a5 5 0 0 1 7 0" }], ["path", { "d": "M5 12.859a10 10 0 0 1 5.17-2.69" }], ["path", { "d": "M19 12.859a10 10 0 0 0-2.007-1.523" }], ["path", { "d": "M2 8.82a15 15 0 0 1 4.177-2.643" }], ["path", { "d": "M22 8.82a15 15 0 0 0-11.288-3.764" }], ["path", { "d": "m2 2 20 20" }]],
  "calendar-days": [["path", { "d": "M8 2v3" }], ["path", { "d": "M16 2v3" }], ["rect", { "x": "3", "y": "3", "width": "18", "height": "18", "rx": "2" }], ["path", { "d": "M3 9h18" }], ["path", { "d": "M8 13h.01" }], ["path", { "d": "M12 13h.01" }], ["path", { "d": "M16 13h.01" }], ["path", { "d": "M8 17h.01" }], ["path", { "d": "M12 17h.01" }], ["path", { "d": "M16 17h.01" }]],
} satisfies Record<string, [string, Record<string, string>][]>;

export type IconName = keyof typeof ICONS;

/** A decorative line icon at the plan's thin stroke. */
export function icon(name: IconName): SVGSVGElement {
  const svg = s("svg", {
    class: "icon", viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor",
    "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  });
  for (const [tag, attrs] of ICONS[name] as [string, Record<string, string>][]) svg.append(s(tag as "path", attrs));
  return svg;
}
