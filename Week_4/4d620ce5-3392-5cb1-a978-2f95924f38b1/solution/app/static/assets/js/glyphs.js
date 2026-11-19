// Status glyphs and interface icons: one original outline set, drawn in the ink colour (brief: Icons, Status display).

const PATHS = {
  Open: '<circle cx="8" cy="8" r="5.2"/>',
  "Due soon": '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.9V8l2.3 1.6"/>',
  Overdue: '<path d="M8 2.4l6 10.8H2z"/><path d="M8 6.6v3.2"/><path d="M8 11.6v.01" stroke-width="2"/>',
  Deferred: '<path d="M5.9 3.8v8.4M10.1 3.8v8.4" stroke-width="2.2"/>',
  Complied: '<path d="M3.1 8.6l3.1 3.1 6.7-7.4"/>',
  Superseded: '<path d="M2.6 11.6L12.6 4.6M9.7 4.3h3.2v3.1M2.6 4.4l10 7M9.7 11.7h3.2V8.6"/>',
  "Not applicable": '<rect x="2.6" y="4.2" width="10.8" height="7.6"/><path d="M2.6 9.7L7.9 4.2M5.4 11.8l7.6-7.6M10.2 11.8l3.2-3.3"/>',
  Withdrawn: '<path d="M2.4 8h11.2M5.4 12.6L10.6 3.4"/>',
};

const SLUG = {
  Open: "open", "Due soon": "due-soon", Overdue: "overdue", Deferred: "deferred", Complied: "complied",
  Superseded: "superseded", "Not applicable": "na", Withdrawn: "withdrawn",
};

/** The status glyph as an image named by its label. */
export function glyph(label) {
  return `<svg class="glyph glyph--${SLUG[label]}" viewBox="0 0 16 16" role="img" aria-label="${label}">${PATHS[label]}</svg>`;
}

/** A decorative glyph (hidden from assistive tech), used where the label is already text. */
export function mark(label) {
  return `<svg class="glyph glyph--${SLUG[label]}" viewBox="0 0 16 16" aria-hidden="true">${PATHS[label]}</svg>`;
}

const ICONS = {
  search: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4l3.6 3.6"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  more: '<path d="M3.6 8h.01M8 8h.01M12.4 8h.01" stroke-width="2.4"/>',
  rail: '<path d="M2.5 3.5h3v9h-3zM8 4.5h5.5M8 8h5.5M8 11.5h5.5"/>',
  file: '<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/>',
  back: '<path d="M9.8 3.6L5.4 8l4.4 4.4"/>',
};

export function icon(name) {
  return `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Shared SVG definitions: the diagonal hatch for stubs. */
export const DEFS = `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<line class="hatch-line" x1="0" y1="0" x2="0" y2="6"/></pattern></defs></svg>`;

export const HATCH = '<svg class="hatch" aria-hidden="true" focusable="false"><rect width="100%" height="100%" fill="url(#hatch)"/></svg>';
