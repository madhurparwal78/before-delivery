// Status glyphs, limit gauges and hatched stubs, drawn as vector graphics.

import { element } from "./a11y.js";

const SVG = "http://www.w3.org/2000/svg";

const SHAPES = {
  Open: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  "Due soon":
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M8 4.2V8l2.6 1.8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  Overdue:
    '<path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M8 6v4" stroke="currentColor" stroke-width="1.5"/>',
  Deferred:
    '<path d="M5.5 3v10M10.5 3v10" stroke="currentColor" stroke-width="2"/>',
  Complied: '<path d="M2 8.6 6.2 13 14 3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  Superseded:
    '<path d="M2 4h8l-2.4-2.4M14 12H6l2.4 2.4" fill="none" stroke="currentColor"' +
    ' stroke-width="1.4"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1"/>',
  "Not applicable":
    '<rect x="1" y="3" width="14" height="10" fill="none" stroke="currentColor"' +
    ' stroke-width="1"/><path d="M1 13 15 3M1 8l7-5M8 13l7-5" stroke="currentColor"' +
    ' stroke-width="1"/>',
  Withdrawn:
    '<path d="M1 8h14" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M4 4.5h8M4 11.5h8" stroke="currentColor" stroke-width="1"/>',
};

const GLYPH_TONES = {
  Overdue: "overdue",
  "Due soon": "due_soon",
  Superseded: "superseded",
  Complied: "complied",
  Deferred: "deferred",
  "Not applicable": "stub",
  Withdrawn: "stub",
};

export function glyph(label) {
  const node = document.createElementNS(SVG, "svg");
  node.setAttribute("viewBox", "0 0 16 16");
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", label);
  node.setAttribute("class", `glyph ${GLYPH_TONES[label] || "open"}`);
  node.innerHTML = `<title>${label}</title>${SHAPES[label] || SHAPES.Open}`;
  return node;
}

/** One thin rail. `governs` adds the filled notch at its right end. */
export function rail(name, fraction, governs) {
  const value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 3");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<line x1="0" y1="1.5" x2="100" y2="1.5" stroke="#6b7688" stroke-width="3"/>' +
    `<line x1="0" y1="1.5" x2="${Math.max(value, 0.5)}" y2="1.5" stroke="${
      governs ? "#b3a5f7" : "#cfd5e0"
    }" stroke-width="3"/>` +
    (governs ? '<rect x="97" y="0" width="3" height="3" fill="#b3a5f7"/>' : "");
  return element(
    "div",
    {
      role: "meter",
      "aria-label": name,
      "aria-valuenow": String(value),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuetext": `${value}%`,
    },
    [svg]
  );
}

export function hatchedStub(label) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 14");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "stub");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.innerHTML =
    `<title>${label}</title><defs><pattern id="hatch-${label.replace(/\s/g, "")}"` +
    ' width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<line x1="0" y1="0" x2="0" y2="6" stroke="#6b7688" stroke-width="2"/></pattern></defs>' +
    `<rect width="100" height="14" fill="url(#hatch-${label.replace(/\s/g, "")})"/>`;
  return svg;
}

export function icon(path, size = 14) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = path;
  return svg;
}
