// One line-icon set drawn for this app on a 24px grid, 1.75 stroke (Lucide-style geometry).
import { svg } from "./dom.js";

const PATHS = {
  clock: ["M12 7v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  calendarPlus: ["M8 3v4M16 3v4M3 10h18", "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M12 13v5M9.5 15.5h5"],
  list: ["M8 6h13M8 12h13M8 18h13", "M3.5 6h.01M3.5 12h.01M3.5 18h.01"],
  thermometer: ["M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z"],
  grid: ["M3 4h18v16H3Z", "M3 10h18M3 15h18M9 4v16M15 4v16"],
  hand: ["M7 11V6a1.5 1.5 0 0 1 3 0v4", "M10 10V4.5a1.5 1.5 0 0 1 3 0V10", "M13 10V5.5a1.5 1.5 0 0 1 3 0V12", "M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L4 15a1.5 1.5 0 0 1 2.4-1.8L7 14"],
  sprout: ["M12 21v-9", "M12 12c0-4 3-7 8-7 0 5-3 7-8 7Z", "M12 14c0-3-2.5-5-7-5 0 4 2.5 5 7 5Z"],
  inbox: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v6H3v-6Z"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  layers: ["M12 3 3 8l9 5 9-5Z", "M3 13l9 5 9-5"],
  check: ["M4 12.5 9 17.5 20 6.5"],
  receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2Z", "M9 8h6M9 12h6"],
  download: ["M12 4v11M7 10l5 5 5-5", "M4 20h16"],
  scroll: ["M8 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8", "M8 4a2 2 0 0 0-2 2v12a2 2 0 0 1-2 2h4", "M10 9h6M10 13h6"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  logout: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 17l-5-5 5-5M5 12h11"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  arrowLeft: ["M19 12H5M11 6l-6 6 6 6"],
  alert: ["M12 4 2.5 20h19Z", "M12 10v4M12 17h.01"],
};

export function icon(name, size = 18) {
  return svg("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "icon" },
  ...PATHS[name].map((d) => svg("path", { d })));
}

// The empty-state drawing: an empty tray with a hairline shadow line.
export function emptyTray() {
  return svg("svg", { viewBox: "0 0 64 48", width: 64, height: 48, fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "empty-art" },
  svg("path", { d: "M6 28h14l3 6h18l3-6h14" }),
  svg("path", { d: "M12 12h40l6 16v12H6V28Z" }),
  svg("path", { d: "M22 18h20M26 23h12", opacity: "0.55" }),
  svg("path", { d: "M10 45h44", opacity: "0.35" }));
}
