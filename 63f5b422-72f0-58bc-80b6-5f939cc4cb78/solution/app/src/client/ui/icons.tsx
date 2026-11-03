/** Inline Lucide icons (lucide-static 1.66.0, ISC licence): path data only, drawn at 16 px with currentColor. */
import type { SVGProps } from "react";

type Shape = ["path" | "circle" | "rect" | "line" | "polyline" | "polygon" | "ellipse", Record<string, string>];

const ICONS = {
  "circle-alert": [["circle", { cx: "12", cy: "12", r: "10" }], ["line", { x1: "12", x2: "12", y1: "8", y2: "12" }], ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16" }]],
  "plus": [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
  "fan": [["path", { d: "M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z" }], ["path", { d: "M12 12v.01" }]],
  "panel-right": [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }], ["path", { d: "M15 3v18" }]],
  "palette": [["path", { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }], ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }], ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }], ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }], ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }]],
  "database": [["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }], ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }], ["path", { d: "M3 12A9 3 0 0 0 21 12" }]],
  "image": [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" }], ["circle", { cx: "9", cy: "9", r: "2" }], ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }]],
  "history": [["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { d: "M3 3v5h5" }], ["path", { d: "M12 7v5l4 2" }]],
  "message-square": [["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }]],
  "share-2": [["circle", { cx: "18", cy: "5", r: "3" }], ["circle", { cx: "6", cy: "12", r: "3" }], ["circle", { cx: "18", cy: "19", r: "3" }], ["line", {  }], ["line", {  }]],
  "save": [["path", { d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }], ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }], ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }]],
  "list-tree": [["path", { d: "M8 5h13" }], ["path", { d: "M13 12h8" }], ["path", { d: "M13 19h8" }], ["path", { d: "M3 10a2 2 0 0 0 2 2h3" }], ["path", { d: "M3 5v12a2 2 0 0 0 2 2h3" }]],
  "monitor": [["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2" }], ["line", {  }], ["line", {  }]],
  "tablet": [["rect", { width: "16", height: "20", x: "4", y: "2", rx: "2", ry: "2" }], ["line", {  }]],
  "smartphone": [["rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" }], ["path", { d: "M12 18h.01" }]],
  "x": [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  "trash-2": [["path", { d: "M10 11v6" }], ["path", { d: "M14 11v6" }], ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }], ["path", { d: "M3 6h18" }], ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]],
  "upload": [["path", { d: "M12 3v12" }], ["path", { d: "m17 8-5-5-5 5" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }]],
  "menu": [["path", { d: "M4 5h16" }], ["path", { d: "M4 12h16" }], ["path", { d: "M4 19h16" }]],
  "file-text": [["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }], ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }], ["path", { d: "M10 9H8" }], ["path", { d: "M16 13H8" }], ["path", { d: "M16 17H8" }]],
  "link": [["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }], ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }]],
  "globe": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }], ["path", { d: "M2 12h20" }]],
  "copy": [["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]],
  "unlink": [["path", { d: "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" }], ["path", { d: "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" }], ["line", {  }], ["line", {  }], ["line", {  }], ["line", {  }]],
  "pencil": [["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }], ["path", { d: "m15 5 4 4" }]],
  "layers": [["path", { d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" }], ["path", { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }], ["path", { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }]],
  "square": [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }]],
  "type": [["path", { d: "M12 4v16" }], ["path", { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" }], ["path", { d: "M9 20h6" }]],
  "heading-1": [["path", { d: "M4 12h8" }], ["path", { d: "M4 18V6" }], ["path", { d: "M12 18V6" }], ["path", { d: "m17 12 3-2v8" }]],
  "mouse-pointer-click": [["path", { d: "M14 4.1 12 6" }], ["path", { d: "m5.1 8-2.9-.8" }], ["path", { d: "m6 12-1.9 2" }], ["path", { d: "M7.2 2.2 8 5.1" }], ["path", { d: "M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" }]],
  "rows-3": [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }], ["path", { d: "M21 9H3" }], ["path", { d: "M21 15H3" }]],
  "navigation": [["polygon", { points: "3 11 22 2 13 21 11 13 3 11" }]],
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
  "triangle-alert": [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]],
  "eye": [["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
  "send": [["path", { d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" }], ["path", { d: "m21.854 2.147-10.94 10.939" }]],
  "undo-2": [["path", { d: "M9 14 4 9l5-5" }], ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" }]],
  "redo-2": [["path", { d: "m15 14 5-5-5-5" }], ["path", { d: "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" }]],
  "file-stack": [["path", { d: "M11 21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1" }], ["path", { d: "M16 16a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1" }], ["path", { d: "M21 6a2 2 0 0 0-.586-1.414l-2-2A2 2 0 0 0 17 2h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1z" }]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {(ICONS[name] as Shape[]).map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  );
}
