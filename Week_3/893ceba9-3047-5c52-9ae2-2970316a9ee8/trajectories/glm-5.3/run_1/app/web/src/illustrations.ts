// SVG illustration panels and icon glyphs — seed visual language.

export function svgEl(inner: string, attrs: Record<string, string> = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}>${inner}</svg>`;
}

export const ICONS: Record<string, string> = {
  globe: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/></svg>`,
  chev: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" ><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  arrowL: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  menu: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l14 14M20 6L6 20"/></svg>`,
  doc: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h5"/><path d="M9 13h7M9 17h5"/></svg>`,
  undo: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h11a5 5 0 0 1 0 10h-5"/><path d="M8 6l-4 4 4 4"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>`,
  bolt: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-5 5-8 8-8s6.5 3 8 8"/></svg>`,
  key: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v4M20 12v3"/></svg>`,
  list: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>`,
  table: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  bucket: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M8 8a4 4 0 0 1 8 0"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  branch: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="5" r="2.5"/><circle cx="7" cy="19" r="2.5"/><circle cx="17" cy="8" r="2.5"/><path d="M7 7.5v9M17 10.5c0 3-4 3-7 5"/></svg>`,
  upload: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`,
  ai: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 10h.01M15 10h.01M9.5 14.5c1.6-1.4 3.9-1.4 5.5 0"/></svg>`,
  review: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15l2 2 3-3"/></svg>`,
  merge: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="6" r="2.5"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="12" r="2.5"/><path d="M7 8.5v7M7 12h5a2 2 0 0 1 2 2v.5"/></svg>`,
  publish: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/><path d="M4 20h16"/></svg>`,
  import: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>`,
};

export function icon(name: keyof typeof ICONS | string, size = 20): string {
  const g = ICONS[name] || ICONS.globe;
  return g.replace(`width="20" height="20"`, `width="${size}" height="${size}"`);
}

/** Small rounded-corner ink mark. */
export function logoMark(size = 30): string {
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="#10151f"/><path d="M10 22V10l6 7 6-7v12" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Hero illustration: three overlapping locale-file cards with skeleton bars and badges. */
export function heroCollage(strength = 1): string {
  return `<div class="illus-panel hero-collage">
    <div class="grid-bg"></div>
    <svg viewBox="0 0 600 500" width="100%" height="100%" role="img" aria-label="Three locale files with MQM, match and conflict figures" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="cardg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.98"/>
          <stop offset="1" stop-color="#fdfcfa" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <g>
        <rect x="150" y="150" width="240" height="300" rx="16" fill="url(#cardg)" stroke="rgba(16,21,31,.10)"/>
        <rect x="150" y="150" width="240" height="300" rx="16" fill="none" stroke="rgba(16,21,31,.10)"/>
        <text x="174" y="196" font-family="Inter, sans-serif" font-size="13" fill="#8a919e" letter-spacing="1">en.json</text>
        <rect x="174" y="212" width="80" height="9" rx="4.5" fill="#dfe3e9"/>
        <rect x="174" y="232" width="150" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="174" y="252" width="120" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="174" y="272" width="160" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="174" y="292" width="140" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="174" y="318" width="100" height="22" rx="7" fill="#f2f4f7"/>
      </g>
      <g>
        <rect x="240" y="200" width="240" height="300" rx="16" fill="#fff" stroke="rgba(16,21,31,.12)"/>
        <text x="264" y="246" font-family="Inter, sans-serif" font-size="13" fill="#8a919e" letter-spacing="1">de.json</text>
        <rect x="264" y="262" width="70" height="9" rx="4.5" fill="#dfe3e9"/>
        <rect x="264" y="282" width="150" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="264" y="302" width="130" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="264" y="322" width="160" height="9" rx="4.5" fill="#e8ebf0"/>
        <rect x="264" y="360" width="80" height="22" rx="7" fill="#f2f4f7"/>
      </g>
      <g>
        <rect x="330" y="250" width="240" height="300" rx="16" fill="#fff" stroke="rgba(16,21,31,.14)"/>
        <text x="354" y="296" font-family="Inter, sans-serif" font-size="13" fill="#8a919e" letter-spacing="1">ja.json</text>
        <rect x="354" y="312" width="60" height="9" rx="4.5" fill="#dfe3e9"/>
        <rect x="354" y="332" width="140" height="9" rx="4" fill="#e8ebf0"/>
        <rect x="354" y="352" width="120" height="7" rx="3.5" fill="#e8ebf0"/>
        <rect x="354" y="372" width="150" height="9" rx="4.5" fill="#e8ebf0"/>
      </g>
    </svg>
    <div class="stat-chip" style="left:6%;top:12%"><span class="num">MQM 96</span><small>Example</small></div>
    <div class="stat-chip" style="right:5%;top:42%"><span class="num">312 exact matches reused</span><small>Example</small></div>
    
    <div class="stat-chip" style="left:16%;bottom:10%"><span class="num">2 branch conflicts open</span><small>Example</small></div>
  </div>`;
}

/** Mini hub diagram: repo tile, connector, tray of tiles, connector, avatar. */
export function hubDiagram(opts: { repository: string; tmCount: number; routes: Array<[string, string]>; label?: string }): string {
  const tray = opts.routes.map(([lang, engine]) => `<span class="hub-tile">${lang} → ${engine}</span>`).join("")
    + `<span class="hub-tile hub-tm">TM ${opts.tmCount}</span>`;
  return `<div class="illus-panel hub-panel">
    <div class="grid-bg"></div>
    <div class="hub-row" role="img" aria-label="${escapeHtmlText(opts.label || "The engineer's desk")}">
      <span class="hub-tile hub-app">${escapeHtmlText(opts.repository)}</span>
      <span class="hub-line"></span>
      <span class="hub-tray">${tray}</span>
      <span class="hub-line"></span>
      <span class="hub-avatar">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="11" fill="#f7e5d5"/><circle cx="17" cy="13" r="6.5" fill="none" stroke="#10151f" stroke-width="1.8"/><path d="M6 30c1.8-6 6-9 11-9s9.2 3 11 9" fill="none" stroke="#10151f" stroke-width="1.8" stroke-linecap="round"/></svg>
      </span>
    </div>
  </div>`;
}

export function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Empty-state locale card illustration. */
export function emptyIllustration(): string {
  return `<div class="illus-panel empty-illus">
    <div class="grid-bg"></div>
    <svg viewBox="0 0 180 120" width="100%" role="img" aria-hidden="true">
      <rect x="30" y="14" width="120" height="92" rx="10" fill="#fff" stroke="rgba(16,21,31,.16)"/>
      <text x="46" y="42" font-family="Inter, sans-serif" font-size="9" fill="#8a919e" letter-spacing="1">locale.json</text>
      <rect x="46" y="52" width="60" height="6" rx="3" fill="#dfe3e9"/>
      <rect x="46" y="66" width="88" height="6" rx="3" fill="#e8ebf0"/>
      <rect x="46" y="80" width="72" height="6" rx="3" fill="#e8ebf0"/>
    </svg>
  </div>`;
}

/** Gradient-stroke icon tile with a thin glyph. */
export function gradTile(glyph: string): string {
  return `<span class="gt"><span class="in">${glyph}</span></span>`;
}

/** Analytics band colour blocks. */
export function analyticsBlocks(): string {
  return `<svg class="blocks" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="0" width="1200" height="260" fill="#f7e5d5"/>
    <rect x="150" y="0" width="260" height="260" fill="#f3d7de"/>
    <rect x="480" y="0" width="300" height="260" fill="#e7e0f5"/>
    <rect x="880" y="0" width="320" height="260" fill="#f2f4f7"/>
  </svg>`;
}
