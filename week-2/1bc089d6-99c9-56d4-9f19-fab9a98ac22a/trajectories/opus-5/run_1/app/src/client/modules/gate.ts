import { loadSound, rememberedChoice, soundNames } from './audio.js';
import { el } from './dom.js';
import { drawTexture, textureNames } from './scenes/textures.js';

interface LoadStep {
  run(): Promise<void>;
}

const steps: LoadStep[] = [
  { run: () => document.fonts.load('600 1rem Fraunces').then(() => undefined) },
  { run: () => document.fonts.load('400 1rem "Hanken Grotesk"').then(() => undefined) },
  ...soundNames.map((name) => ({ run: () => loadSound(name) })),
  {
    run: () =>
      new Promise<void>((resolve) => {
        const poster = new Image();
        poster.onload = () => resolve();
        poster.onerror = () => resolve();
        poster.src = '/media/one-still-hour-poster.jpg';
      }),
  },
  ...textureNames.map((name) => ({
    run: async () => {
      drawTexture(name);
    },
  })),
];

/**
 * Gathers the evening's own assets, reporting real progress, then waits for the
 * visitor to choose sound or silence. Nothing scrolls or sounds until they do.
 */
export async function openGate(): Promise<boolean> {
  const gate = el('gate');
  const bar = el('gate-progress');
  const fill = el('gate-fill');
  const percent = el('gate-percent');
  const choices = el('gate-choices');
  const withSound = el<HTMLButtonElement>('begin-with-sound');
  const inSilence = el<HTMLButtonElement>('begin-in-silence');

  const behind = [...document.querySelectorAll<HTMLElement>('header, main, footer')];
  for (const part of behind) part.inert = true;

  let done = 0;
  const report = (): void => {
    const value = Math.round((done / steps.length) * 100);
    bar.setAttribute('aria-valuenow', String(value));
    percent.textContent = `${value}%`;
    fill.style.width = `${value}%`;
  };
  report();

  for (const step of steps) {
    try {
      await step.run();
    } catch {
      // A failed asset still counts; a missing sound simply stays silent.
    }
    done += 1;
    report();
  }

  choices.hidden = false;
  (rememberedChoice() === 'off' ? inSilence : withSound).focus();

  const choice = await new Promise<boolean>((resolve) => {
    withSound.addEventListener('click', () => resolve(true), { once: true });
    inSilence.addEventListener('click', () => resolve(false), { once: true });
  });

  gate.classList.add('is-leaving');
  document.body.classList.remove('is-gated');
  for (const part of behind) part.inert = false;
  window.setTimeout(() => {
    gate.hidden = true;
  }, 640);
  return choice;
}
