import type { Plate } from '../../shared/copy.js';

const drawings: Record<Plate, string> = {
  Stove: `
    <rect x="52" y="68" width="76" height="86" rx="4" fill="#2b2f38"/>
    <rect x="84" y="24" width="12" height="46" fill="#2b2f38"/>
    <circle cx="90" cy="110" r="15" fill="#f4c63c"/>
    <rect x="56" y="152" width="10" height="12" fill="#b98a3a"/>
    <rect x="114" y="152" width="10" height="12" fill="#b98a3a"/>`,
  Goose: `
    <rect x="30" y="104" width="120" height="8" fill="#dfe6ef"/>
    <rect x="36" y="112" width="108" height="20" fill="#c8d3e1"/>
    <ellipse cx="90" cy="92" rx="34" ry="17" fill="#a5672c"/>
    <rect x="86" y="62" width="3" height="26" fill="#b98a3a"/>
    <rect x="94" y="62" width="3" height="26" fill="#b98a3a"/>`,
  Tree: `
    <polygon points="90,26 124,80 56,80" fill="#24402f"/>
    <polygon points="90,62 134,124 46,124" fill="#24402f"/>
    <rect x="84" y="124" width="12" height="24" fill="#a5672c"/>
    <circle cx="74" cy="74" r="3.5" fill="#f4c63c"/>
    <circle cx="106" cy="74" r="3.5" fill="#f4c63c"/>
    <circle cx="68" cy="114" r="3.5" fill="#f4c63c"/>
    <circle cx="112" cy="114" r="3.5" fill="#f4c63c"/>`,
  Star: `
    <circle cx="112" cy="58" r="9" fill="#fff1c0"/>
    <path d="M118 51 L150 22" stroke="#f4c63c" stroke-width="4" stroke-linecap="round"/>
    <circle cx="44" cy="40" r="2" fill="#eaf0f7"/>
    <circle cx="66" cy="92" r="1.6" fill="#eaf0f7"/>
    <circle cx="36" cy="128" r="2" fill="#eaf0f7"/>`,
  Grandmother: `
    <circle cx="90" cy="96" r="54" fill="#f4c63c" opacity="0.16"/>
    <polygon points="90,62 120,152 60,152" fill="#4a5160"/>
    <circle cx="90" cy="52" r="15" fill="#d8c3ad"/>
    <ellipse cx="90" cy="72" rx="26" ry="8" fill="#dfe6ef"/>`,
};

/** The box page shows this drawing until a maker uploads plate art. */
export function plateDrawing(plate: Plate): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 180 180');
  svg.setAttribute('width', '320');
  svg.setAttribute('height', '320');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `A plate drawing for ${plate}`);
  svg.innerHTML = `<rect width="180" height="180" fill="#0d1220"/>${drawings[plate]}`;
  return svg;
}
