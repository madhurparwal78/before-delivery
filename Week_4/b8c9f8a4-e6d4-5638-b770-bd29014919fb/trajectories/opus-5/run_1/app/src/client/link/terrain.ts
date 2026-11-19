import { el, svgFrom } from '../shared/dom';

const WIDTH = 1_600;
const HEIGHT = 520;

const wobble = (seed: number): number => {
  const value = Math.sin(seed * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};

const ridge = (index: number, amplitude: number, base: number): string => {
  const points: string[] = [];
  for (let x = 0; x <= WIDTH; x += 40) {
    const t = x / WIDTH;
    const y =
      base -
      Math.sin(t * Math.PI * (1.6 + index * 0.4) + index) * amplitude -
      wobble(x * 0.013 + index * 3.7) * amplitude * 0.5;
    points.push(`${x},${y.toFixed(1)}`);
  }
  return `${points.join(' ')} ${WIDTH},${HEIGHT} 0,${HEIGHT}`;
};

const roadPath = (): string => {
  const segments: string[] = [`M ${WIDTH * 0.46} ${HEIGHT}`];
  for (let step = 1; step <= 7; step += 1) {
    const t = step / 7;
    const x = WIDTH * (0.46 + Math.sin(t * 2.4) * 0.16 - t * 0.04);
    const y = HEIGHT * (1 - t * 0.78);
    segments.push(`Q ${(x + 46).toFixed(1)} ${(y + 34).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return segments.join(' ');
};

/** A generated aerial road and hill terrain, darkened for the viewing area label. */
export const roadTerrain = (viewingArea: string): HTMLElement => {
  const svg = svgFrom(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" class="terrain-svg" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="terrain-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b2a5e"/>
        <stop offset="1" stop-color="#15142f"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#terrain-sky)"/>
    <polygon points="${ridge(0, 54, HEIGHT * 0.52)}" fill="#2f3a63"/>
    <polygon points="${ridge(1, 44, HEIGHT * 0.66)}" fill="#27314f"/>
    <polygon points="${ridge(2, 36, HEIGHT * 0.8)}" fill="#1e2740"/>
    <path d="${roadPath()}" fill="none" stroke="#5a5f86" stroke-width="26" stroke-linecap="round"/>
    <path d="${roadPath()}" fill="none" stroke="#9aa0c6" stroke-width="2.4" stroke-dasharray="18 26"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#07060f" opacity="0.42"/>
  </svg>`);

  const band = el('div', { class: 'terrain-holder', role: 'img', 'aria-label': 'Road terrain' });
  band.append(svg, el('p', { class: 'terrain-label', text: viewingArea }));
  return band;
};

/** The procedural image behind the owner story, under a dark scrim. */
export const storyBackdrop = (): HTMLElement => {
  const svg = svgFrom(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" class="story-svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="story-ground" x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#4a4a8e"/>
        <stop offset="0.6" stop-color="#241f52"/>
        <stop offset="1" stop-color="#100d22"/>
      </linearGradient>
    </defs>
    <rect width="800" height="520" fill="url(#story-ground)"/>
    ${Array.from({ length: 9 }, (_unused, index) => {
      const x = wobble(index * 2.1) * 800;
      const y = 120 + wobble(index * 5.3) * 320;
      const size = 60 + wobble(index * 7.7) * 180;
      return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${size.toFixed(0)}" height="${(size * 0.6).toFixed(0)}" fill="#8f8ad6" opacity="${(0.06 + wobble(index * 9.1) * 0.14).toFixed(2)}" transform="rotate(${(wobble(index * 3.3) * 40 - 20).toFixed(1)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
    }).join('')}
  </svg>`);
  const holder = el('div', { class: 'story-backdrop', 'aria-hidden': 'true' });
  holder.append(svg, el('div', { class: 'story-scrim' }));
  return holder;
};
