// Procedural glassware art: vector line drawings generated from a name.
import { h } from './dom.js';

function hashOf(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function glasswareFor(seed: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('aria-hidden', 'true');
  const hash = hashOf(seed);
  const stroke = 'rgba(242, 244, 241, 0.72)';
  svg.innerHTML = `
    <g fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <g transform="translate(28, 30)">
        <rect x="0" y="0" width="56" height="14" rx="2"/>
        <line x1="14" y1="0" x2="14" y2="14"/>
        <line x1="28" y1="0" x2="28" y2="14"/>
        <line x1="42" y1="0" x2="42" y2="14"/>
        <line x1="0" y1="30" x2="0" y2="${34 + (hash % 20)}" stroke-width="1.6"/>
        <line x1="56" y1="30" x2="56" y2="${34 + (hash % 18)}" stroke-width="1.6"/>
      </g>
      <g transform="translate(${100 + (hash % 12)}, 92) rotate(${(hash % 9) - 4})">
        <path d="M -22 46 L -22 12 Q -22 -6 0 -6 Q 22 -6 22 12 L 22 46 Z"/>
        <line x1="-22" y1="18" x2="22" y2="18" stroke-width="1.4"/>
        <path d="M 0 -6 L 0 -20" />
      </g>
      <g transform="translate(148, 40) rotate(${(hash % 7) - 3})">
        <circle cx="0" cy="0" r="34"/>
        <path d="M 0 -34 L 0 -46" />
        <path d="M ${-(hash % 22) - 8} 0 A ${(hash % 22) + 8} ${(hash % 22) + 8} 0 0 1 ${(hash % 22) + 8} 0" stroke-width="1.5"/>
        <path d="M ${-(hash % 18) - 5} 12 A ${(hash % 18) + 5} ${(hash % 18) + 5} 0 0 0 ${(hash % 18) + 5} -12" stroke-width="1.5"/>
      </g>
    </g>
  `;
  return svg;
}

export function tileFigure(name: string, fact: string, seed: string): HTMLElement {
  const figure = h('figure', { class: 'tile-figure' });
  const tile = h('div', { class: 'tile' });
  tile.appendChild(glasswareFor(seed));
  figure.appendChild(tile);
  figure.appendChild(h('figcaption', { class: 'tile-caption' }, `${name}. ${fact}`));
  return figure;
}
