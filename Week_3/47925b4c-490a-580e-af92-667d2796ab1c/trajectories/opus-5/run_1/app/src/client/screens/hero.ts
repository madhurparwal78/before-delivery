import { append, clear, el } from '../dom.js';
import { follow } from '../shell.js';

const GROUND = '#f7e8e5';
const INK = '#2b1430';

interface Chips {
  output: number;
  throwRatio: number;
  capitals: boolean;
}

function lumensText(lumens: number): string {
  return `${String(lumens).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} lm`;
}

/** The procedural Zuiderhal front, lit by the current chip values. */
function drawDemoWall(canvas: HTMLCanvasElement, chips: Chips): void {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = INK;
  context.fillRect(0, 0, width, height);
  const lit = Math.min(1, Math.max(0.08, (chips.output - 5000) / 35000));
  const spread = 0.5 + 0.5 / chips.throwRatio;
  context.globalAlpha = 0.25 + 0.75 * lit;
  context.fillStyle = GROUND;
  const left = width * (0.5 - spread / 2);
  const panel = (width * spread) / 7;
  for (let index = 0; index < 7; index += 1) {
    const bay = left + index * panel;
    const tall = height * (index % 2 === 0 ? 0.78 : 0.58);
    context.fillRect(bay + panel * 0.1, height - tall, panel * 0.8, tall);
  }
  context.globalAlpha = 1;
  context.fillStyle = INK;
  for (let index = 0; index < 7; index += 1) {
    const bay = left + index * panel;
    context.fillRect(bay + panel * 0.3, height * 0.55, panel * 0.4, height * 0.18);
  }
  context.fillStyle = GROUND;
  context.globalAlpha = 0.35 + 0.65 * lit;
  context.fillRect(0, height - 2, width, 2);
  context.globalAlpha = 1;
}

export function renderHero(screen: HTMLElement, chrome: HTMLElement): () => void {
  const chips: Chips = { output: 20_000, throwRatio: 1.3, capitals: true };
  document.body.classList.add('hero');
  clear(chrome);
  chrome.appendChild(
    el('nav', { 'aria-label': 'Nachtwit' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Nachtwit', onclick: follow }),
      el('a', { href: '/sites', class: 'action', text: 'Survey a wall', onclick: follow }),
    ]),
  );

  const canvas = el('canvas', { width: 640, height: 200 });
  const slot = el('span', { class: 'wall-slot', role: 'img', 'aria-label': 'Zuiderhal demo wall' }, [canvas]);
  const firstLine = el('span', { class: 'line' }, [el('span', { 'aria-hidden': 'true', text: 'MEASURE THE' }), slot]);
  const secondLine = el('span', { class: 'line' }, [el('span', { 'aria-hidden': 'true', text: 'BEFORE THE LIGHT' })]);
  const title = el('h1', { 'aria-label': 'MEASURE THE WALL BEFORE THE LIGHT' }, [firstLine, secondLine]);

  const outputReadout = el('span', { text: lumensText(chips.output) });
  const throwReadout = el('span', { text: `${chips.throwRatio.toFixed(1)} to 1` });

  const output = el('input', {
    type: 'range',
    role: 'slider',
    'aria-label': 'Output',
    min: 5000,
    max: 40000,
    step: 1000,
    value: 20000,
  });
  const throwSlider = el('input', {
    type: 'range',
    role: 'slider',
    'aria-label': 'Throw',
    min: 0.8,
    max: 3,
    step: 0.1,
    value: 1.3,
  });
  const capitals = el('button', {
    type: 'button',
    role: 'switch',
    'aria-label': 'Capitals',
    'aria-checked': 'true',
    class: 'switch',
    text: 'Capitals',
  });

  const paint = (): void => {
    drawDemoWall(canvas, chips);
    title.style.fontWeight = chips.output >= 25_000 ? '600' : '400';
    title.style.letterSpacing = `${(chips.throwRatio - 1.3) * 0.04}em`;
    const first = chips.capitals ? 'MEASURE THE' : 'Measure the';
    const second = chips.capitals ? 'BEFORE THE LIGHT' : 'before the light';
    (firstLine.firstChild as HTMLElement).textContent = first;
    (secondLine.firstChild as HTMLElement).textContent = second;
    title.classList.toggle('sentence-case', !chips.capitals);
    title.setAttribute(
      'aria-label',
      chips.capitals ? 'MEASURE THE WALL BEFORE THE LIGHT' : 'Measure the wall before the light',
    );
    outputReadout.textContent = lumensText(chips.output);
    throwReadout.textContent = `${chips.throwRatio.toFixed(1)} to 1`;
  };

  output.addEventListener('input', () => {
    chips.output = Number(output.value);
    paint();
  });
  throwSlider.addEventListener('input', () => {
    chips.throwRatio = Number(throwSlider.value);
    paint();
  });
  capitals.addEventListener('click', () => {
    chips.capitals = !chips.capitals;
    capitals.setAttribute('aria-checked', String(chips.capitals));
    paint();
  });

  clear(screen);
  append(screen, [
    title,
    el('div', { class: 'chips' }, [
      el('div', { class: 'chip' }, [el('label', {}, ['Output', output]), outputReadout]),
      el('div', { class: 'chip' }, [el('label', {}, ['Throw', throwSlider]), throwReadout]),
      el('div', { class: 'chip' }, [capitals]),
    ]),
  ]);
  paint();

  return () => {
    document.body.classList.remove('hero');
  };
}
