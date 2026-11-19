// The Wayline line glyphs, drawn for this app in the current text colour.
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };

export const Chevron = (p) => <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>;
export const Search = (p) => <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const ArrowUpRight = (p) => <svg {...base} {...p}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const ArrowRight = (p) => <svg {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Plus = (p) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const Tick = (p) => <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const Cross = (p) => <svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const Copy = (p) => <svg {...base} {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></svg>;
export const Discs = (p) => <svg {...base} {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
export const Braces = (p) => <svg {...base} {...p}><path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" /></svg>;
export const Star = (p) => <svg {...base} {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
export const Menu = (p) => <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
