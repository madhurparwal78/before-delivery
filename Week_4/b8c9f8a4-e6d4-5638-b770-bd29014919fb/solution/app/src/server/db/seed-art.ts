// The pictures the seed owner "took": a close crop of each panel under the stage's light, with the
// fault that finding describes drawn into the paint, and the car's bumper and number plate across
// the foreground, inside the band the plate mask covers. Drawn here, in this project, and
// rasterised by the image pipeline. No photograph is used.

import sharp from 'sharp';
import type { SeedFinding } from './seed.js';

const WIDTH = 1200;
const HEIGHT = 800;

/** Everything a crop can paint with: the car's paint under the stage's light, and the fault tools. */
const DEFS = `
  <linearGradient id="sky-paint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#A9B9F8"/><stop offset="0.5" stop-color="#5A6AE0"/><stop offset="1" stop-color="#232080"/>
  </linearGradient>
  <linearGradient id="flank-paint" x1="0" y1="0" x2="1" y2="0.5">
    <stop offset="0" stop-color="#27309F"/><stop offset="0.45" stop-color="#5468E6"/><stop offset="1" stop-color="#1A1C74"/>
  </linearGradient>
  <linearGradient id="low-paint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3C49C4"/><stop offset="1" stop-color="#14105A"/>
  </linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3B4592"/><stop offset="0.5" stop-color="#121040"/><stop offset="1" stop-color="#0A0726"/>
  </linearGradient>
  <linearGradient id="bumper-paint" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#47507E"/><stop offset="0.3" stop-color="#2A2A5C"/><stop offset="1" stop-color="#0F0C2C"/>
  </linearGradient>
  <linearGradient id="lamp-red" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#D23A5E"/><stop offset="1" stop-color="#6E1230"/>
  </linearGradient>
  <linearGradient id="lamp-clear" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F4F1E4"/><stop offset="1" stop-color="#8F9AD0"/>
  </linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#17123F"/><stop offset="1" stop-color="#07041C"/>
  </linearGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="softer" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="34"/></filter>
  <filter id="edge" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
  <filter id="raised" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="height"/>
    <feSpecularLighting in="height" surfaceScale="7" specularConstant="0.85" specularExponent="18"
      lighting-color="#FFF2DB" result="shine">
      <feDistantLight azimuth="230" elevation="48"/>
    </feSpecularLighting>
    <feComposite in="shine" in2="SourceAlpha" operator="in" result="lit"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="lit"/></feMerge>
  </filter>
  <filter id="rough" x="-15%" y="-15%" width="130%" height="130%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="feather"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.05 0.14" numOctaves="4" seed="7" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.72  0 0 0 0 0.68  0 0 0 0 0.74  0 0 0 1.5 -0.56" result="flecks"/>
    <feComposite in="flecks" in2="feather" operator="in"/>
  </filter>
  <filter id="haze" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="30" result="feather"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves="4" seed="11" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.84  0 0 0 0 0.86  0 0 0 0 0.95  0 0 0 1.1 -0.28" result="cloud"/>
    <feComposite in="cloud" in2="feather" operator="in"/>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
    <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.11 0"/>
  </filter>`;

function times(count: number, draw: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => draw(index)).join('');
}

/** A shut line: the dark gap, with the light catching the panel edge beside it. */
function shut(path: string): string {
  return `<path d="${path}" stroke="#07041F" stroke-width="7" fill="none"/>
    <path d="${path}" stroke="#C9D3FB" stroke-width="2" fill="none" opacity="0.5" transform="translate(5 3)"/>`;
}

/** A reflection of the garage strip light lying along a panel. */
function sheen(path: string, opacity = 0.5): string {
  return `<path d="${path}" stroke="#E6ECFF" stroke-width="26" stroke-linecap="round" fill="none"
    opacity="${opacity}" filter="url(#soft)"/>`;
}

function tyreAndArch(cx: number, cy: number, radius: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${radius + 40}" fill="#07041F"/>
    <path d="M${cx - radius - 42} ${cy} A${radius + 42} ${radius + 42} 0 0 1 ${cx + radius + 42} ${cy}"
      stroke="#AFC0FA" stroke-width="5" fill="none" opacity="0.7"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#141127"/>
    <circle cx="${cx}" cy="${cy}" r="${radius * 0.62}" fill="#55587F"/>
    <circle cx="${cx}" cy="${cy}" r="${radius * 0.5}" fill="#23224C"/>
    ${times(10, (index) => {
    const angle = (index / 10) * Math.PI * 2;
    return `<path d="M${cx} ${cy} L${cx + Math.cos(angle) * radius * 0.56} ${cy + Math.sin(angle) * radius * 0.56}"
        stroke="#8E94BE" stroke-width="13"/>`;
  })}
    <circle cx="${cx}" cy="${cy}" r="${radius * 0.13}" fill="#C8CCE8"/>`;
}

/** The number plate, with its characters as blocks so the picture needs no font. */
function plate(ground: string): string {
  const left = 436;
  const top = 574;
  const bars = [3, 2, 4, 2, 3, 2, 3];
  let x = left + 40;
  const blocks = bars.map((count) => {
    const group = times(count, (index) =>
      `<rect x="${x + index * 9}" y="${top + 14}" width="6" height="40" rx="1" fill="#14102E"/>`);
    x += count * 9 + 11;
    return group;
  }).join('');
  return `<rect x="${left}" y="${top}" width="328" height="68" rx="7" fill="${ground}" stroke="#14102E" stroke-width="3"/>
    <rect x="${left}" y="${top}" width="26" height="68" rx="6" fill="#1B3FA8"/>${blocks}`;
}

/** The bumper across the foreground, carrying the plate inside the band the seed mask covers. */
function bumper(end: 'front' | 'rear'): string {
  const lamps = end === 'front'
    ? `<rect x="130" y="596" width="170" height="44" rx="20" fill="url(#lamp-clear)" opacity="0.8"/>
       <rect x="900" y="596" width="170" height="44" rx="20" fill="url(#lamp-clear)" opacity="0.8"/>`
    : `<rect x="110" y="600" width="200" height="26" rx="8" fill="url(#lamp-red)"/>
       <rect x="890" y="600" width="200" height="26" rx="8" fill="url(#lamp-red)"/>`;
  return `<path d="M0 ${HEIGHT} V724 H${WIDTH} V${HEIGHT} Z" fill="url(#floor)"/>
    <path d="M0 544 Q600 512 ${WIDTH} 544 V712 Q600 748 0 712 Z" fill="url(#bumper-paint)"/>
    <path d="M0 546 Q600 514 ${WIDTH} 546" stroke="#C7CFF5" stroke-width="4" fill="none" opacity="0.65"/>
    <path d="M0 676 Q600 706 ${WIDTH} 676" stroke="#07041F" stroke-width="6" fill="none" opacity="0.8"/>
    <rect x="404" y="556" width="392" height="104" rx="12" fill="#0B0826" opacity="0.72"/>
    ${lamps}
    ${plate(end === 'front' ? '#EDEBDD' : '#E4C93E')}
    <ellipse cx="600" cy="752" rx="520" ry="26" fill="#000000" opacity="0.5" filter="url(#soft)"/>`;
}

function chips(): string {
  return times(46, (index) => {
    const x = 170 + ((index * 197) % 860);
    const y = 372 + ((index * 83) % 66);
    const size = 2 + ((index * 7) % 4);
    return `<path d="M${x} ${y} l${size} ${-size} l${size + 2} ${size - 1} l${-size} ${size + 1} Z"
      fill="${index % 3 === 0 ? '#D8DCF5' : '#120E33'}"/>`;
  });
}

function bubbles(): string {
  return times(19, (index) => {
    const t = index / 18;
    const angle = Math.PI * (1.08 + t * 0.62);
    const reach = 268 + ((index * 37) % 34);
    const x = 790 + Math.cos(angle) * reach;
    const y = 520 + Math.sin(angle) * reach;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${11 + ((index * 5) % 15)}" fill="#3C49C4" filter="url(#raised)"/>`;
  });
}

const CROPS: Record<string, { end: 'front' | 'rear'; scene: string }> = {
  // Down the bonnet from the nose: the leading edge chipped and touched in, above the lamps.
  bonnet: {
    end: 'front',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#0B0726"/>
      <path d="M290 0 H910 L1200 330 V470 H0 V330 Z" fill="url(#sky-paint)"/>
      <path d="M430 0 H770 L720 44 H480 Z" fill="url(#glass)"/>
      ${sheen('M420 120 Q600 90 800 120', 0.6)}
      <path d="M330 60 L170 440" stroke="#26277E" stroke-width="5" opacity="0.7"/>
      <path d="M870 60 L1030 440" stroke="#BCC8FA" stroke-width="5" opacity="0.55"/>
      <path d="M0 438 Q600 400 ${WIDTH} 438" stroke="#07041F" stroke-width="8" fill="none"/>
      <rect x="60" y="452" width="290" height="72" rx="14" fill="url(#lamp-clear)"/>
      <rect x="850" y="452" width="290" height="72" rx="14" fill="url(#lamp-clear)"/>
      <rect x="390" y="456" width="420" height="62" rx="10" fill="#0B0826"/>
      ${times(5, (index) => `<rect x="404" y="${464 + index * 10}" width="392" height="3" fill="#6C73A8"/>`)}
      <circle cx="600" cy="487" r="23" fill="#D8DCF5"/><circle cx="600" cy="487" r="14" fill="#1A1C74"/>
      ${chips()}`,
  },
  // Along the offside front wing: the arch and the lamp's edge, the respray a shade off the door.
  'os-front-wing': {
    end: 'front',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flank-paint)"/>
      <path d="M0 0 H${WIDTH} V76 Q600 118 0 86 Z" fill="url(#sky-paint)"/>
      <path d="M0 86 Q600 118 ${WIDTH} 76" stroke="#E4E9FF" stroke-width="4" fill="none" opacity="0.8"/>
      <path d="M-20 130 Q120 124 180 170 L150 300 Q60 320 -20 310 Z" fill="url(#lamp-clear)"/>
      <path d="M0 262 H170" stroke="#5863A8" stroke-width="3"/>
      ${tyreAndArch(520, 610, 190)}
      ${shut('M990 86 Q980 330 1006 560')}
      <path d="M320 92 Q630 150 958 90 L972 556 H720 Q760 330 520 340 Q290 340 300 556 H190 Z" fill="#7B8CF0" opacity="0.16"/>
      ${sheen('M200 186 Q620 150 960 196', 0.55)}
      <path d="M960 92 Q948 330 974 556" stroke="#E4DCCB" stroke-width="3" fill="none" opacity="0.5" filter="url(#edge)"/>
      <path d="M1000 186 Q1100 170 1200 186" stroke="#E6ECFF" stroke-width="14" opacity="0.28" fill="none" filter="url(#edge)"/>
`,
  },
  // The offside door square on: glass above, the handle, and the dent below it bending the light.
  'os-door': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flank-paint)"/>
      <path d="M0 0 H${WIDTH} V106 H0 Z" fill="url(#glass)"/>
      <rect x="0" y="104" width="${WIDTH}" height="16" fill="#0B0826"/>
      <rect x="0" y="108" width="${WIDTH}" height="5" fill="#C8D2FA" opacity="0.7"/>
      ${shut('M130 118 Q116 340 136 556')}
      ${shut('M1076 118 Q1094 340 1070 556')}
      <rect x="480" y="176" width="210" height="44" rx="20" fill="#0D0A30"/>
      <rect x="500" y="170" width="170" height="30" rx="14" fill="#B6C2F6"/>
      <rect x="500" y="170" width="170" height="10" rx="5" fill="#EEF2FF" opacity="0.8"/>
      <path d="M136 268 C340 262 500 262 580 258 C660 316 740 318 820 260 C900 258 1000 262 1074 266"
        stroke="#E6ECFF" stroke-width="20" fill="none" opacity="0.6" filter="url(#edge)"/>
      <ellipse cx="704" cy="344" rx="112" ry="60" fill="#1A1C74" opacity="0.45" filter="url(#soft)"/>
      <ellipse cx="686" cy="320" rx="72" ry="26" fill="#8FA6F5" opacity="0.55" filter="url(#soft)"/>
      <path d="M136 470 Q600 456 1070 470" stroke="#0E0B3A" stroke-width="5" fill="none" opacity="0.7"/>`,
  },
  // Low along the offside sill: the door's foot, the rear arch, and the filler in the rear third.
  'os-sill': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flank-paint)"/>
      <path d="M0 0 H${WIDTH} V132 H0 Z" fill="url(#flank-paint)"/>
      ${shut('M0 140 H1180')}
      ${shut('M360 0 V136')}
      <rect x="0" y="146" width="${WIDTH}" height="400" fill="url(#low-paint)"/>
      ${sheen('M0 190 H980', 0.5)}
      ${times(4, (index) => `<rect x="${90 + index * 210}" y="486" width="46" height="18" rx="4" fill="#07041F" opacity="0.8"/>`)}
      <path d="M540 200 H1000 L1020 470 H520 Z" fill="#3D3C8E" opacity="0.8" filter="url(#soft)"/>
      <path d="M560 210 H990 L1000 450 H550 Z" filter="url(#rough)" fill="#000"/>
      <path d="M570 262 C680 240 860 288 985 256" stroke="#E7D9BC" stroke-width="9" fill="none" opacity="0.5" filter="url(#edge)"/>
      <path d="M552 340 C700 372 850 320 996 360" stroke="#0D0A30" stroke-width="10" fill="none" opacity="0.5" filter="url(#edge)"/>
      ${tyreAndArch(1240, 470, 190)}`,
  },
  // The boot from behind: rear screen, lamp clusters and the badge with its lacquer dulled.
  'boot-lid': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#0B0726"/>
      <path d="M170 0 H1030 L1100 90 H100 Z" fill="url(#glass)"/>
      ${times(6, (index) => `<path d="M${150 - index * 8} ${16 + index * 13} H${1050 + index * 8}" stroke="#6C73A8" stroke-width="2" opacity="0.5"/>`)}
      <path d="M90 92 H1110 L1200 300 V540 H0 V300 Z" fill="url(#sky-paint)"/>
      ${shut('M90 96 H1110')}
      ${sheen('M190 150 Q600 124 1010 150', 0.6)}
      <rect x="0" y="330" width="290" height="150" rx="16" fill="url(#lamp-red)"/>
      <rect x="910" y="330" width="290" height="150" rx="16" fill="url(#lamp-red)"/>
      <path d="M0 402 H290 M910 402 H1200" stroke="#2E0716" stroke-width="5"/>
      ${shut('M300 326 V520 M900 326 V520')}
      <ellipse cx="600" cy="316" rx="225" ry="96" fill="#E8EAF8" filter="url(#haze)"/>
      <ellipse cx="600" cy="316" rx="168" ry="66" fill="#9FA6DA" opacity="0.32" filter="url(#soft)"/>
      <circle cx="600" cy="316" r="36" fill="#C6CCEA" filter="url(#raised)"/>
      <circle cx="600" cy="316" r="23" fill="#2A2A6E"/>
      <path d="M608 303 a16 16 0 1 0 0 26" stroke="#E6E9F8" stroke-width="6" fill="none"/>`,
  },
  // The rear bumper's nearside corner, close: matt plastic, the scuff drawn across its corner.
  'rear-bumper': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky-paint)"/>
      ${sheen('M100 90 Q600 56 1100 90', 0.5)}
      <rect x="0" y="176" width="350" height="270" rx="20" fill="url(#lamp-red)"/>
      <rect x="850" y="176" width="350" height="270" rx="20" fill="url(#lamp-red)"/>
      <path d="M0 312 H350 M850 312 H1200" stroke="#2E0716" stroke-width="6"/>
      ${shut('M362 170 V500 M838 170 V500')}
      <rect x="540" y="250" width="120" height="66" rx="10" fill="#2B2A78"/>
      <circle cx="600" cy="282" r="18" fill="#C6CCEA"/>
      ${shut('M0 500 H1200')}
      <rect x="0" y="506" width="${WIDTH}" height="50" fill="url(#low-paint)"/>`,
  },
  // The nearside rear quarter, with the arch lip sweeping through it and paint lifting along it.
  'ns-rear-quarter': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flank-paint)"/>
      <path d="M0 0 H620 L500 96 H0 Z" fill="url(#glass)"/>
      <path d="M0 96 H500 L620 0" stroke="#C8D2FA" stroke-width="5" fill="none" opacity="0.65"/>
      ${sheen('M0 172 Q600 150 1200 170', 0.6)}
      <rect x="150" y="210" width="110" height="92" rx="14" fill="none" stroke="#07041F" stroke-width="5"/>
      ${tyreAndArch(790, 620, 228)}
      ${bubbles()}`,
  },
  // Up the nearside door to the glass line: the window rubber split and perished at its rear edge.
  'ns-door': {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#flank-paint)"/>
      <path d="M0 0 H${WIDTH} V258 H0 Z" fill="url(#glass)"/>
      <path d="M0 40 L420 0 H760 L260 258 H0 Z" fill="#AEBBF5" opacity="0.13"/>
      <rect x="0" y="258" width="${WIDTH}" height="34" fill="#0C0926"/>
      <rect x="0" y="258" width="${WIDTH}" height="8" fill="#3A3C70"/>
      ${times(15, (index) => `<path d="M${830 + index * 25 + (index % 3) * 4} 262 l${(index % 4) - 2} ${15 + (index * 7) % 14}"
        stroke="#7E86B8" stroke-width="3"/>`)}
      <path d="M820 276 C900 262 1030 298 1110 272" stroke="#7E86B8" stroke-width="3" fill="none" opacity="0.8"/>
      ${shut('M1118 0 V556')}
      <rect x="200" y="334" width="210" height="44" rx="20" fill="#0D0A30"/>
      <rect x="220" y="328" width="170" height="30" rx="14" fill="#B6C2F6"/>
      ${sheen('M0 440 Q600 420 1116 440', 0.5)}`,
  },
  // The roof seen over the rear screen: rails either side, the clear coat clouded across its centre.
  roof: {
    end: 'rear',
    scene: `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#0B0726"/>
      <path d="M250 0 H950 L1040 300 H160 Z" fill="url(#sky-paint)"/>
      <path d="M250 0 L160 300 M950 0 L1040 300" stroke="#07041F" stroke-width="12"/>
      <path d="M268 0 L180 300 M932 0 L1020 300" stroke="#C8D2FA" stroke-width="4" opacity="0.7"/>
      <ellipse cx="600" cy="150" rx="262" ry="116" fill="#E8EAF8" filter="url(#haze)"/>
      <ellipse cx="600" cy="150" rx="196" ry="74" fill="#C9CEEF" opacity="0.32" filter="url(#softer)"/>
      <path d="M160 304 H1040 L1140 452 H60 Z" fill="url(#glass)"/>
      ${times(7, (index) => `<path d="M${150 - index * 14} ${322 + index * 18} H${1050 + index * 14}" stroke="#6C73A8" stroke-width="2" opacity="0.45"/>`)}
      <path d="M60 454 H1140 L1200 548 H0 Z" fill="url(#low-paint)"/>
      ${shut('M60 456 H1140')}`,
  },
};

/** Marks that lie over the bumper rather than behind it. */
const OVER_BUMPER: Record<string, string> = {
  'rear-bumper': `
    <path d="M50 628 Q200 618 340 632 L340 700 Q190 716 50 704 Z" fill="#000" filter="url(#rough)"/>
    ${times(13, (index) => `<path d="M${64 + index * 20} ${634 + (index % 4) * 13} l${70 + (index % 3) * 22} ${8 + (index % 5) * 3}"
      stroke="#D8D5EC" stroke-width="${2 + (index % 3)}" opacity="0.7"/>`)}`,
};

function photoSvg(finding: SeedFinding): string {
  const crop = CROPS[finding.panelId];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>${DEFS}</defs>
    ${crop.scene}
    ${bumper(crop.end)}
    ${OVER_BUMPER[finding.panelId] ?? ''}
    <rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)"/>
  </svg>`;
}

export async function seedPhoto(finding: SeedFinding): Promise<Buffer> {
  return sharp(Buffer.from(photoSvg(finding)))
    .jpeg({ quality: 82, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export function invoiceHtml(): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Wing respray invoice</title>
    <style>
      body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1A0B54; font-size: 11pt; }
      h1 { font-size: 20pt; margin: 0 0 4pt; }
      table { border-collapse: collapse; width: 100%; margin-top: 12pt; }
      th, td { text-align: left; padding: 4pt 6pt; border-bottom: 1px solid #D8D5EC; }
      .total { font-weight: 600; }
    </style></head><body>
    <h1>Wing respray invoice</h1>
    <p>Larkfield Bodyworks &middot; 2019</p>
    <table>
      <thead><tr><th>Work</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>Offside front wing, prepare and respray</td><td>&pound;410</td></tr>
        <tr><td>Blend into door, lacquer and polish</td><td>&pound;180</td></tr>
        <tr class="total"><td>Total</td><td>&pound;590</td></tr>
      </tbody>
    </table>
    <p>Kept with the car file so a buyer can see what was done.</p>
    </body></html>`;
}
