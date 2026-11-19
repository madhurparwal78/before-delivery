const PLUM = '#2b0b2e';
const CYAN = '#2ee6f6';
const GREY = '#8a8a93';

/** A generated side view of an invented coach, flat plum and cyan. */
export function coachDrawing(seats: number, title: string): string {
  const windows = Math.max(3, Math.min(10, Math.round(seats / 7)));
  const windowWidth = 180 / windows;
  const panes = Array.from({ length: windows }, (_unused, index) => {
    const x = 34 + index * windowWidth;
    return `<rect x="${x.toFixed(1)}" y="26" width="${(windowWidth - 6).toFixed(1)}" height="22" fill="${CYAN}"/>`;
  }).join('');
  return `<svg viewBox="0 0 240 100" role="img" aria-label="${title}" class="drawing">
  <rect x="14" y="16" width="212" height="52" fill="${PLUM}"/>
  <rect x="200" y="26" width="20" height="22" fill="${CYAN}"/>
  ${panes}
  <rect x="14" y="68" width="212" height="6" fill="${PLUM}"/>
  <circle cx="58" cy="80" r="11" fill="${PLUM}"/>
  <circle cx="58" cy="80" r="4" fill="${CYAN}"/>
  <circle cx="186" cy="80" r="11" fill="${PLUM}"/>
  <circle cx="186" cy="80" r="4" fill="${CYAN}"/>
  <rect x="0" y="91" width="240" height="9" fill="${PLUM}"/>
</svg>`;
}

export function heroDrawing(): string {
  return `<svg viewBox="0 0 1200 420" role="img" aria-label="A coach on a Coventry street" class="hero-drawing" preserveAspectRatio="xMidYMid slice">
  <rect width="1200" height="420" fill="${CYAN}"/>
  <rect y="300" width="1200" height="120" fill="${PLUM}"/>
  <g transform="translate(120 120) scale(3.4)">
    <rect x="14" y="16" width="212" height="52" fill="${PLUM}"/>
    <rect x="200" y="26" width="20" height="22" fill="${CYAN}"/>
    <rect x="34" y="26" width="34" height="22" fill="${CYAN}"/>
    <rect x="74" y="26" width="34" height="22" fill="${CYAN}"/>
    <rect x="114" y="26" width="34" height="22" fill="${CYAN}"/>
    <rect x="154" y="26" width="34" height="22" fill="${CYAN}"/>
    <circle cx="58" cy="74" r="10" fill="${PLUM}"/>
    <circle cx="186" cy="74" r="10" fill="${PLUM}"/>
  </g>
  <rect width="1200" height="420" fill="#000" opacity="0.4"/>
</svg>`;
}

export function occasionDrawing(name: string): string {
  const marks = name.length % 4;
  return `<svg viewBox="0 0 300 200" role="img" aria-label="${name}" class="drawing" preserveAspectRatio="xMidYMid slice">
  <rect width="300" height="200" fill="${CYAN}"/>
  <rect x="0" y="150" width="300" height="50" fill="${PLUM}"/>
  <g transform="translate(20 60) scale(1.1)">
    <rect x="0" y="0" width="200" height="50" fill="${PLUM}"/>
    <rect x="12" y="10" width="34" height="20" fill="${CYAN}"/>
    <rect x="54" y="10" width="34" height="20" fill="${CYAN}"/>
    <rect x="96" y="10" width="34" height="20" fill="${CYAN}"/>
    <rect x="138" y="10" width="34" height="20" fill="${CYAN}"/>
    <circle cx="40" cy="56" r="9" fill="${PLUM}"/>
    <circle cx="160" cy="56" r="9" fill="${PLUM}"/>
  </g>
  ${Array.from({ length: marks + 1 }, (_unused, index) => `<rect x="${230 + index * 14}" y="30" width="8" height="${30 + index * 10}" fill="${PLUM}"/>`).join('')}
</svg>`;
}

export function clientMark(name: string): string {
  const letters = name.slice(0, 2).toUpperCase();
  return `<svg viewBox="0 0 160 48" role="img" aria-label="${name}" class="client-mark">
  <rect width="160" height="48" fill="none"/>
  <text x="8" y="32" font-family="Poppins, sans-serif" font-size="22" fill="${GREY}">${letters}</text>
  <text x="44" y="32" font-family="Poppins, sans-serif" font-size="15" fill="${GREY}">${name}</text>
</svg>`;
}

export function seatSvg(label: string, taken: boolean): string {
  return `<svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true" class="seat-svg">
  <rect x="4" y="8" width="32" height="28" fill="${taken ? PLUM : 'none'}" stroke="${PLUM}" stroke-width="2"/>
  <rect x="8" y="4" width="24" height="8" fill="${taken ? CYAN : 'none'}" stroke="${PLUM}" stroke-width="2"/>
  <text x="20" y="28" text-anchor="middle" font-size="10" fill="${taken ? CYAN : PLUM}">${label}</text>
</svg>`;
}

export const CLIENT_MARKS = [
  'Foleshill Tool Makers',
  'Aldermoor Bowls',
  'Chelmsley Federation',
  'Earlsdon Choral',
  'Binley Netball',
  'Tile Hill Scouts',
  'Radford Rugby',
];
