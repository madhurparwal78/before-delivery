export const PALETTE = {
  ember: { light: '#F2A08C', dark: '#A3341F' },
  saffron: { light: '#F7C266', dark: '#9A5B00' },
  meadow: { light: '#A9D99A', dark: '#2F6B2A' },
  lagoon: { light: '#7FD3D0', dark: '#00666B' },
  harbour: { light: '#9DBDF0', dark: '#1F4E8C' },
  iris: { light: '#C6B2F0', dark: '#5B3A9E' },
  orchid: { light: '#EDA8DC', dark: '#8E2C77' },
  clay: { light: '#E0B9A0', dark: '#7A4A33' },
  moss: { light: '#CFD88E', dark: '#4F5A1E' },
  stone: { light: '#C9C6CF', dark: '#4D4A55' },
} as const;

export const INK = '#17161C';

/** Three stacked trapezoids, each with a chevron cut. */
export function quenbyMark(size: number, fill: string, label = 'Quenby & Co. mark'): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'mark';
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', label);
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  wrapper.innerHTML = `<svg viewBox="0 0 100 100" focusable="false" aria-hidden="true" width="100%" height="100%">
    <path d="M32 6 H68 L76 28 H58 L50 20 L42 28 H24 Z" fill="${fill}"/>
    <path d="M26 36 H74 L82 58 H60 L50 49 L40 58 H18 Z" fill="${fill}" opacity="0.82"/>
    <path d="M20 66 H80 L88 88 H62 L50 78 L38 88 H12 Z" fill="${fill}" opacity="0.64"/>
  </svg>`;
  return wrapper;
}

type GlyphName = 'logo' | 'colour' | 'typography' | 'iconography' | 'motion' | 'voice' | 'library' | 'rules';

const GLYPHS: Record<GlyphName, (light: string, dark: string) => string> = {
  logo: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M32 6 H68 L76 28 H58 L50 20 L42 28 H24 Z" fill="${dark}"/>
    <path d="M26 36 H74 L82 58 H60 L50 49 L40 58 H18 Z" fill="${dark}" opacity="0.72"/>
    <path d="M20 66 H80 L88 88 H62 L50 78 L38 88 H12 Z" fill="${light}"/>
  </svg>`,
  colour: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M6 20 H46 V40 H66 V72 H26 V52 H6 Z" fill="${dark}"/>
    <path d="M38 34 H78 V54 H94 V84 H54 V64 H38 Z" fill="${light}" opacity="0.92"/>
    <rect x="38" y="34" width="28" height="30" fill="${INK}" opacity="0.18"/>
  </svg>`,
  typography: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <text x="2" y="86" font-family="system-ui, sans-serif" font-size="66" textLength="96" lengthAdjust="spacingAndGlyphs">
      <tspan font-weight="700" fill="${dark}">A</tspan><tspan font-weight="400" fill="${light}">a</tspan>
    </text>
  </svg>`,
  iconography: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M14 32 L50 14 L86 32 V72 L50 90 L14 72 Z" fill="${dark}"/>
    <path d="M14 32 L50 50 L86 32 L50 14 Z" fill="${light}"/>
    <path d="M50 50 V90 L86 72 V32 Z" fill="${INK}" opacity="0.16"/>
  </svg>`,
  motion: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M16 80 C40 80 40 24 84 24" fill="none" stroke="${dark}" stroke-width="5"/>
    <rect x="6" y="70" width="20" height="20" rx="5" fill="${light}" stroke="${dark}" stroke-width="4"/>
    <rect x="74" y="14" width="20" height="20" rx="5" fill="${light}" stroke="${dark}" stroke-width="4"/>
  </svg>`,
  voice: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M6 8 a17 17 0 1 1 0 34 a17 17 0 0 1 -8 -2 L22 60 Z" fill="${dark}"/>
    <path d="M46 8 a17 17 0 1 1 0 34 a17 17 0 0 1 -8 -2 L62 60 Z" fill="${dark}" opacity="0.7"/>
    <path d="M94 92 a17 17 0 1 0 0 -34 a17 17 0 0 0 8 2 L78 40 Z" fill="${light}"/>
    <path d="M54 92 a17 17 0 1 0 0 -34 a17 17 0 0 0 8 2 L38 40 Z" fill="${light}" opacity="0.8"/>
  </svg>`,
  library: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect x="18" y="44" width="64" height="44" rx="4" fill="none" stroke="${dark}" stroke-width="6"/>
    <path d="M32 44 V32 a18 18 0 0 1 36 0 V44" fill="none" stroke="${dark}" stroke-width="6"/>
    <circle cx="50" cy="64" r="7" fill="${light}" stroke="${dark}" stroke-width="4"/>
  </svg>`,
  rules: (light, dark) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M22 22 V78" stroke="${dark}" stroke-width="3" fill="none"/>
    <rect x="30" y="14" width="56" height="16" fill="${dark}"/>
    <rect x="30" y="42" width="48" height="16" fill="${light}"/>
    <rect x="30" y="70" width="56" height="16" fill="${dark}" opacity="0.7"/>
    <rect x="16" y="16" width="12" height="12" fill="${INK}"/>
    <rect x="16" y="44" width="12" height="12" fill="${INK}"/>
    <rect x="16" y="72" width="12" height="12" fill="${INK}"/>
  </svg>`,
};

function blend(from: string, to: string, amount: number): string {
  const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) =>
    Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Each glyph is flat art in a mid tone and the 700 tone of its tile's hue. */
export function tileGlyph(name: GlyphName, family: keyof typeof PALETTE): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = `tile-glyph tile-glyph-${name}`;
  wrapper.setAttribute('aria-hidden', 'true');
  const tones = PALETTE[family];
  wrapper.innerHTML = GLYPHS[name](blend(tones.light, tones.dark, 0.5), tones.dark);
  return wrapper;
}

export function badgeGlyph(badge: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'badge-glyph';
  wrapper.setAttribute('aria-hidden', 'true');
  const paths: Record<string, string> = {
    Available: '<path d="M3 9 L7 13 L15 4" fill="none" stroke="currentColor" stroke-width="2.4"/>',
    'Request required':
      '<circle cx="6" cy="7" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 9 L15 14 M12 12 L10.5 13.6" stroke="currentColor" stroke-width="2" fill="none"/>',
    Restricted: '<rect x="2" y="7" width="14" height="3.4" fill="currentColor"/>',
    Retired:
      '<circle cx="9" cy="9" r="6.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 5 V9 L12 11" stroke="currentColor" stroke-width="2" fill="none"/>',
  };
  wrapper.innerHTML = `<svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true" focusable="false">${paths[badge] ?? ''}</svg>`;
  return wrapper;
}

export function emptyGlyph(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'empty-glyph';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <rect x="10" y="22" width="100" height="76" fill="${PALETTE.ember.light}"/>
    <rect x="22" y="34" width="76" height="52" fill="${PALETTE.ember.dark}"/>
    <rect x="40" y="52" width="40" height="16" fill="${INK}"/>
  </svg>`;
  return wrapper;
}
