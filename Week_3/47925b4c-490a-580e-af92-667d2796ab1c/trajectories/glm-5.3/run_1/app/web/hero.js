// The hero: blush display capitals on a flat aubergine field, a lit wall in place of
// the word WALL, and three tilted working chips on the letters (DP-54, DP-57).

import { h } from './ui.js';

export function renderHero(root) {
  const field = h('div', { class: 'hero' });
  const wordmark = h('a', { class: 'wordmark', href: '/', 'data-link': '' }, 'Nachtwit');
  const action = h('a', { class: 'action', href: '/sites', 'data-link': '' }, 'Survey a wall');

  const canvas = h('canvas', { role: 'img', 'aria-label': 'Zuiderhal demo wall', width: 480, height: 200 });
  const slot = h('span', { class: 'canvas-slot' }, canvas);

  const settings = { output: 20000, throwRatio: 1.3, capitals: true };

  const heading = h('h1');
  redraw();

  function redraw() {
    heading.textContent = '';
    if (settings.capitals) {
      heading.setAttribute('aria-label', 'MEASURE THE WALL BEFORE THE LIGHT');
      heading.append(
        'MEASURE THE ',
        slot,
        h('span', { 'aria-hidden': 'true' }, 'WALL'),
        ' BEFORE THE LIGHT',
      );
    } else {
      heading.setAttribute('aria-label', 'Measure the wall before the light');
      heading.append(
        'Measure the ',
        slot,
        h('span', { 'aria-hidden': 'true' }, 'wall'),
        ' before the light',
      );
    }
    drawWall();
  }

  function drawWall() {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    // The wall: aubergine field with blush light on it, two colours only.
    const fieldColour = '#3b1f38';
    const lightColour = '#f7eddf';
    ctx.fillStyle = fieldColour;
    ctx.fillRect(0, 0, width, height);
    // The procedural Zuiderhal front: tall arches, one lit band per storey.
    const storeys = 3;
    const arches = 6;
    const litFraction = Math.min(1, settings.output / 40000);
    for (let storey = 0; storey < storeys; storey++) {
      for (let arch = 0; arch < arches; arch++) {
        const w = width / arches;
        const x = arch * w;
        const y = (storey * height) / storeys;
        const hh = height / storeys;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + hh);
        ctx.lineTo(x + 6, y + hh * 0.35);
        ctx.arc(x + w / 2, y + hh * 0.35, (w - 12) / 2, Math.PI, 0);
        ctx.lineTo(x + w - 6, y + hh);
        ctx.closePath();
        ctx.fillStyle = lightColour;
        ctx.globalAlpha = 0.12 + 0.5 * litFraction * ((arch + storey) % 2 === 0 ? 1 : 0.55);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // The throw ratio changes the gaps between letters (the arch spacing).
    ctx.strokeStyle = lightColour;
    ctx.lineWidth = 2;
    const gap = 8 * settings.throwRatio;
    for (let arch = 1; arch < arches; arch++) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(arch * (width / arches) + gap / 2 - 8, 0);
      ctx.lineTo(arch * (width / arches) + gap / 2 - 8, height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const outputReadout = h('span', { class: 'readout' }, formatLumens(settings.output));
  const throwReadout = h('span', { class: 'readout' }, `${settings.throwRatio.toFixed(1)} to 1`);
  const capitalsSwitch = h('button', {
    role: 'switch',
    'aria-checked': 'true',
    onclick: () => {
      settings.capitals = !settings.capitals;
      capitalsSwitch.setAttribute('aria-checked', String(settings.capitals));
      redraw();
    },
  }, 'Capitals');

  const outputSlider = h('input', {
    type: 'range',
    min: '5000',
    max: '40000',
    step: '1000',
    value: String(settings.output),
    'aria-label': 'Output',
    oninput: () => {
      settings.output = Number(outputSlider.value);
      outputReadout.textContent = formatLumens(settings.output);
      drawWall();
    },
  });

  const throwSlider = h('input', {
    type: 'range',
    min: '0.8',
    max: '3.0',
    step: '0.1',
    value: String(settings.throwRatio),
    'aria-label': 'Throw',
    oninput: () => {
      settings.throwRatio = Number(throwSlider.value);
      throwReadout.textContent = `${settings.throwRatio.toFixed(1)} to 1`;
      drawWall();
    },
  });

  const chips = h('div', { class: 'chips' },
    h('div', { class: 'chip' }, h('span', {}, 'Output'), outputSlider, outputReadout),
    h('div', { class: 'chip' }, h('span', {}, 'Throw'), throwSlider, throwReadout),
    h('div', { class: 'chip' }, capitalsSwitch));

  field.append(wordmark, action, heading, chips);
  root.append(field);
}

function formatLumens(value) {
  return `${value.toLocaleString('en-US').replace(/,/g, ' ')} lm`;
}
