import { el, reducedMotion } from '../dom.js';
import { person } from '../session.js';

const FIELDS: { tone: string; heading: string; line: string }[] = [
  {
    tone: 'mint',
    heading: 'Draw together, live',
    line: 'Two editors on one sprite, each cursor and stroke in place at once.',
  },
  {
    tone: 'cyan',
    heading: 'One swatch, every frame',
    line: 'Edit a colour and watch it reach every use, off-screen frames included.',
  },
  {
    tone: 'lemon',
    heading: 'Tiles that match edges',
    line: 'Cut a frame into tiles and lay a map that joins itself as you go.',
  },
  {
    tone: 'orange',
    heading: 'Review the exact pixel',
    line: 'Pin a comment to a frame and a pixel, and mention the person who owns it.',
  },
  {
    tone: 'cornflower',
    heading: 'Exports you can trust',
    line: 'Sheets, PNGs and GIFs, stored only once the store confirms them.',
  },
];

function spriteCanvas(size: number): HTMLCanvasElement {
  const canvas = el('canvas', { class: 'hero-sprite', width: size, height: size });
  const context = canvas.getContext('2d');
  if (context === null) return canvas;
  const cell = size / 16;
  const draw = (step: number): void => {
    context.clearRect(0, 0, size, size);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const middle = Math.abs(x - 7.5) + Math.abs(y - 8 - (step % 2)) * 0.8;
        if (middle > 7) continue;
        const colour =
          middle < 2.4 ? '#ffe9f4' : middle < 5 ? '#ff6fae' : middle < 6.4 ? '#b388ff' : '#2b1a2e';
        context.fillStyle = colour;
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  };
  if (reducedMotion()) {
    draw(3);
    return canvas;
  }
  let step = 0;
  draw(step);
  const timer = window.setInterval(() => {
    step += 1;
    draw(step);
    if (step >= 6) window.clearInterval(timer);
  }, 140);
  return canvas;
}

function sticker(rotation: number, corner: string): HTMLElement {
  const node = el('div', { class: `sticker ${corner}`, 'aria-hidden': 'true' }, [spriteCanvas(96)]);
  node.style.setProperty('--sticker-turn', `${rotation}deg`);
  if (reducedMotion()) node.classList.add('settled');
  else window.setTimeout(() => node.classList.add('settled'), 30);
  return node;
}

export function landingPage(): HTMLElement {
  const signedIn = person() !== null;
  const hero = el('section', { class: 'hero' }, [
    el('h1', { class: 'hero-headline' }, [
      el('span', { class: 'hero-grey', text: 'Draw the same sprite, ' }),
      el('span', { class: 'hero-white', text: 'at the same time.' }),
    ]),
    el('div', { class: 'hero-art' }, [spriteCanvas(320)]),
    el('a', { class: 'pill pill-large', href: signedIn ? '/projects' : '/signup' }, [
      'Start a project',
    ]),
    sticker(-8, 'corner-top-left'),
    sticker(11, 'corner-top-right'),
    sticker(-14, 'corner-bottom-left'),
    sticker(7, 'corner-bottom-right'),
  ]);

  const fields = FIELDS.map((field) =>
    el('section', { class: `candy-field candy-${field.tone}` }, [
      el('div', { class: 'candy-copy' }, [
        el('h2', { text: field.heading }),
        el('p', { text: field.line }),
      ]),
      el('div', { class: 'candy-sticker', 'aria-hidden': 'true' }, [spriteCanvas(140)]),
    ]),
  );

  return el('main', { class: 'landing' }, [hero, ...fields]);
}
