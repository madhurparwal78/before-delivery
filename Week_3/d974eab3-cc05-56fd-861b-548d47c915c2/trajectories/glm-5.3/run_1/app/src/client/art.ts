import type { Product, ScenarioRecord } from './core.js';

const INK = '#16261e';
const PAPER = '#f7f5ef';
const OXYGEN = '#a9d8ce';
const BEET = '#7a2030';

export function oxygenDiagram(width: number, height: number): string {
  const path = `M 24 ${height / 2} C ${width * 0.3} ${height / 2}, ${width * 0.3} 26, ${width * 0.55} 26 S ${width * 0.75} ${height - 26}, ${width - 40} ${height - 40}`;
  return `<svg class="oxygen-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
  <path d="${path}" fill="none" stroke="${OXYGEN}" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>
  <circle cx="24" cy="${height / 2}" r="15" fill="none" stroke="${INK}" stroke-width="2"/>
  <circle cx="${width - 40}" cy="${height - 40}" r="15" fill="none" stroke="${INK}" stroke-width="2"/>
  <path d="M ${width - 46} ${height - 40} h 12 M ${width - 40} ${height - 46} v 12" stroke="${INK}" stroke-width="2"/>
  <circle cx="24" cy="${height / 2}" r="4" fill="${OXYGEN}"/>
  <circle class="oxygen-dot" data-dot cx="24" cy="${height / 2}" r="9" fill="${OXYGEN}" stroke="${INK}" stroke-width="2"/>
</svg>`;
}

export function pathwayDiagram(step: number, width: number, height: number): string {
  const y = 34;
  const nodes = [0, 1, 2]
    .map((index) => {
      const cx = 30 + index * ((width - 60) / 2);
      const fill = index < step ? BEET : PAPER;
      const stroke = index < step ? BEET : INK;
      return `<circle cx="${cx}" cy="${y}" r="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    })
    .join('');
  const arrows = [0, 1]
    .map((index) => {
      const x1 = 30 + index * ((width - 60) / 2) + 14;
      const x2 = 30 + (index + 1) * ((width - 60) / 2) - 14;
      return `<path d="M ${x1} ${y} H ${x2}" stroke="${index < step - 1 ? BEET : '#9aa79f'}" stroke-width="2"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
  <rect width="${width}" height="${height}" fill="${PAPER}"/>
  ${nodes}
  ${arrows}
</svg>`;
}

export function packPicture(product: Product, view: 'front' | 'side' | 'back'): string {
  const w = 220;
  const h = 300;
  const depth = view === 'side' ? 70 : 220;
  const lines =
    view === 'front'
      ? [product.name]
      : view === 'side'
        ? [product.format]
        : ['Ingredients', ...product.ingredients.map((ingredient) => ingredient.name)].slice(0, 6);
  const fontSize = view === 'back' ? 7 : 16;
  const text = lines
    .map(
      (line, index) =>
        `<text x="${w / 2}" y="${130 + index * (fontSize + 4)}" font-size="${fontSize}" fill="${PAPER}" text-anchor="middle" font-family="serif">${escapeSvg(line)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  <rect x="${(w - depth) / 2}" y="20" width="${depth}" height="240" rx="10" fill="${BEET}"/>
  <rect x="${(w - depth) / 2}" y="20" width="${depth}" height="240" rx="10" fill="none" stroke="${INK}" stroke-width="2"/>
  <rect x="${(w - depth) / 2 + 10}" y="30" width="${depth - 20}" height="220" fill="none" stroke="${PAPER}" stroke-opacity="0.5" stroke-width="1"/>
  ${text}
</svg>`;
}

export function scenarioPicture(scenario: ScenarioRecord): string {
  const w = 360;
  const h = 240;
  const night = scenario.mode === 'off';
  const sky = night ? INK : '#e8ede4';
  const ground = night ? '#0e1a14' : '#cfe0cb';
  const light = night ? '#2e4a3c' : '#f2ede2';
  const group = scenario.id.split('-')[1] ?? 'work';
  const features: Record<string, string> = {
    work: `<rect x="40" y="90" width="90" height="70" fill="${light}"/><rect x="60" y="120" width="16" height="16" fill="${sky}"/>`,
    sports: `<path d="M 40 150 L 110 90 L 180 150 Z" fill="${light}"/><circle cx="140" cy="60" r="14" fill="#d8b04a"/>`,
    hobby: `<rect x="70" y="110" width="120" height="12" fill="${light}"/><rect x="70" y="140" width="120" height="12" fill="${light}"/><circle cx="240" cy="70" r="16" fill="${light}"/>`,
    housework: `<path d="M 120 90 q 30 -40 60 0 q 30 40 60 0" fill="none" stroke="${light}" stroke-width="8"/><rect x="40" y="160" width="120" height="10" fill="${light}"/>`,
    break: `<circle cx="180" cy="70" r="30" fill="${light}"/><rect x="90" y="150" width="180" height="8" fill="${light}"/>`,
    holiday: `<rect x="60" y="120" width="60" height="40" fill="${light}"/><rect x="140" y="100" width="80" height="60" fill="${light}"/><circle cx="290" cy="60" r="20" fill="${light}"/>`,
    relax: `<path d="M 100 140 h 160" stroke="${light}" stroke-width="8"/><path d="M 150 100 q 20 -30 60 0" fill="none" stroke="${light}" stroke-width="8"/>`,
    rest: `<circle cx="180" cy="120" r="50" fill="${light}"/><path d="M 170 100 q 10 20 20 0" fill="none" stroke="${sky}" stroke-width="3"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
  <rect width="${w}" height="${h}" fill="${sky}"/>
  <rect y="${h - 60}" width="${w}" height="60" fill="${ground}"/>
  <circle cx="${night ? 290 : 70}" cy="50" r="18" fill="${night ? '#d7e4dd' : '#d8b04a'}" fill-opacity="${night ? 0.9 : 1}"/>
  ${features[group] ?? features['work'] ?? ''}
</svg>`;
}

export function portrait(hue: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <rect width="120" height="120" fill="hsl(${hue} 30% 88%)"/>
  <circle cx="60" cy="52" r="24" fill="hsl(${hue} 45% 55%)"/>
  <path d="M 24 110 q 36 -34 72 0 Z" fill="hsl(${hue} 45% 45%)"/>
  <rect x="0" y="0" width="120" height="120" fill="none" stroke="hsl(${hue} 40% 60%)" stroke-width="4"/>
</svg>`;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
