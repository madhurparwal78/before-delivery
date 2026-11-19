/** Generates the invented SVG assets: terrain band, owner story image and the dim stage still. */
import fs from 'node:fs';
import path from 'node:path';

function out(name, svg) {
  fs.writeFileSync(path.join('public', name), svg);
};

function terrain() {
  // A generated aerial road-and-hill terrain, procedural and invented.
  let hills = '';
  for (let i = 0; i < 24; i++) {
    const x = (i * 173) % 1200;
    const y = (i * 97) % 260;
    const r = 60 + ((i * 41) % 90);
    hills += `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${230 + (i * 7) % 40}, 26%, ${18 + (i % 5) * 3}%)" opacity="0.6"/>`;
  }
  let road = '';
  for (let y = 0; y < 340; y += 6) {
    const x = 600 + Math.sin(y / 40) * 130;
    road += `<rect x="${x - 14}" y="${y}" width="28" height="6" fill="#3a3358"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="340" viewBox="0 0 1200 340">
    <rect width="1200" height="340" fill="#1b1631"/>
    ${hills}
    ${road}
    <rect width="1200" height="340" fill="rgba(10,6,26,0.35)"/>
  </svg>`;
}

function story() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="700" viewBox="0 0 1400 700">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b53a8"/><stop offset="0.6" stop-color="#2c2560"/><stop offset="1" stop-color="#191336"/>
    </linearGradient></defs>
    <rect width="1400" height="700" fill="url(#g)"/>
    ${Array.from({ length: 16 }, (_, i) => `<path d="M ${i * 90} 700 Q ${i * 90 + 45} ${520 - (i % 3) * 60} ${i * 90 + 90} 700 Z" fill="rgba(255,255,255,${0.03 + (i % 3) * 0.02})"/>`).join('')}
  </svg>`;
}

function stageStill() {
  // The dim still of the faceted stage used for empty states and ended links.
  const facets = Array.from({ length: 14 }, (_, i) => {
    const x = 120 + (i % 5) * 190;
    const y = 90 + Math.floor(i / 5) * 130;
    return `<polygon points="${x},${y + 60} ${x + 150},${y} ${x + 210},${y + 90} ${x + 60},${y + 150}" fill="rgba(90,99,176,${0.25 + (i % 3) * 0.08})"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">
    <rect width="1200" height="640" fill="#16121f"/>
    <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2450"/><stop offset="1" stop-color="#16121f"/>
    </linearGradient></defs>
    <rect width="1200" height="640" fill="url(#d)"/>
    ${facets}
  </svg>`;
}

out('terrain.svg', terrain());
out('story.svg', story());
out('stage-still.svg', stageStill());
console.log('assets written');
