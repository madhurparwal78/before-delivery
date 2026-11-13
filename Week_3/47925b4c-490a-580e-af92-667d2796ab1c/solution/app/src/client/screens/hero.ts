import { append, clear, el } from '../dom.js';
import { follow } from '../shell.js';
import { GROUND, INK } from '../wall.js';

interface Chips {
  output: number;
  throwRatio: number;
  capitals: boolean;
}

const OUTPUT_LOW = 5_000;
const OUTPUT_HIGH = 40_000;
const WEIGHTS = [300, 400, 500, 600, 700];

function lumensText(lumens: number): string {
  return `${String(lumens).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} lm`;
}

/** The Zuiderhal front, drawn in its two colours and lit by the chips: Output sets the glow, Throw the spread. */
function drawDemoWall(canvas: HTMLCanvasElement, chips: Chips): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const { width, height } = canvas;
  const glow = (chips.output - OUTPUT_LOW) / (OUTPUT_HIGH - OUTPUT_LOW);
  const spread = 0.35 + 0.65 * (1 - (chips.throwRatio - 0.8) / 2.2);
  context.fillStyle = INK;
  context.fillRect(0, 0, width, height);

  const bays = 9;
  const bayWidth = width / bays;
  const lit = (centre: number): number => {
    const distance = Math.abs(centre - width / 2) / (width / 2);
    return Math.max(0.08, (0.5 + 0.5 * glow) * Math.max(0, 1 - distance / spread));
  };
  for (let bay = 0; bay < bays; bay += 1) {
    const x = bay * bayWidth;
    const centre = x + bayWidth / 2;
    const pilaster = bay % 2 === 0;
    context.globalAlpha = lit(centre);
    context.fillStyle = GROUND;
    context.fillRect(x + 1, height * 0.2, bayWidth - 2, height * 0.8);
    context.globalAlpha = 1;
    if (!pilaster) {
      context.fillStyle = INK;
      context.beginPath();
      context.roundRect(x + bayWidth * 0.22, height * 0.38, bayWidth * 0.56, height * 0.4, [bayWidth * 0.28, bayWidth * 0.28, 0, 0]);
      context.fill();
      context.globalAlpha = Math.min(1, lit(centre) * 1.6 + 0.12);
      context.fillStyle = GROUND;
      context.fillRect(x + bayWidth * 0.28, height * 0.46, bayWidth * 0.44, height * 0.04);
      context.globalAlpha = 1;
    }
  }
  context.globalAlpha = 0.35 + 0.65 * glow;
  context.fillStyle = GROUND;
  context.beginPath();
  context.moveTo(width * 0.36, height * 0.2);
  context.lineTo(width * 0.5, height * 0.02);
  context.lineTo(width * 0.64, height * 0.2);
  context.closePath();
  context.fill();
  context.fillRect(0, height - 3, width, 3);
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
  const first = el('span', { 'aria-hidden': 'true' });
  const second = el('span', { 'aria-hidden': 'true' });
  const title = el('h1', { class: 'hero-title' }, [
    el('span', { class: 'line' }, [first, slot]),
    el('span', { class: 'line' }, [second]),
  ]);

  const outputReadout = el('output', { for: 'hero-output' });
  const throwReadout = el('output', { for: 'hero-throw' });
  const capitalsReadout = el('span', { class: 'state' });

  const output = el('input', {
    id: 'hero-output',
    type: 'range',
    'aria-label': 'Output',
    min: OUTPUT_LOW,
    max: OUTPUT_HIGH,
    step: 1000,
    value: chips.output,
  });
  const throwSlider = el('input', {
    id: 'hero-throw',
    type: 'range',
    'aria-label': 'Throw',
    min: 0.8,
    max: 3,
    step: 0.1,
    value: chips.throwRatio,
  });
  const capitals = el('button', { type: 'button', role: 'switch', 'aria-label': 'Capitals', 'aria-checked': 'true', class: 'switch' }, [
    el('span', { text: 'Capitals' }),
    capitalsReadout,
  ]);

  const paint = (): void => {
    drawDemoWall(canvas, chips);
    const step = Math.round(((chips.output - OUTPUT_LOW) / (OUTPUT_HIGH - OUTPUT_LOW)) * (WEIGHTS.length - 1));
    title.style.fontWeight = String(WEIGHTS[step]);
    title.style.letterSpacing = `${((chips.throwRatio - 1.3) * 0.05).toFixed(3)}em`;
    title.style.wordSpacing = `${((chips.throwRatio - 1.3) * 0.12).toFixed(3)}em`;
    first.textContent = chips.capitals ? 'MEASURE THE' : 'Measure the';
    second.textContent = chips.capitals ? 'BEFORE THE LIGHT' : 'before the light';
    title.classList.toggle('sentence-case', !chips.capitals);
    title.setAttribute('aria-label', chips.capitals ? 'MEASURE THE WALL BEFORE THE LIGHT' : 'Measure the wall before the light');
    outputReadout.textContent = lumensText(chips.output);
    throwReadout.textContent = `${chips.throwRatio.toFixed(1)} to 1`;
    capitalsReadout.textContent = chips.capitals ? 'On' : 'Off';
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
    el('div', { class: 'hero-stage' }, [
      title,
      el('div', { class: 'chips' }, [
        el('div', { class: 'chip chip-output' }, [el('span', { class: 'chip-name', text: 'Output' }), output, outputReadout]),
        el('div', { class: 'chip chip-throw' }, [el('span', { class: 'chip-name', text: 'Throw' }), throwSlider, throwReadout]),
        el('div', { class: 'chip chip-capitals' }, [capitals]),
      ]),
    ]),
  ]);
  paint();
  void document.fonts.ready.then(paint);

  return () => {
    document.body.classList.remove('hero');
  };
}
