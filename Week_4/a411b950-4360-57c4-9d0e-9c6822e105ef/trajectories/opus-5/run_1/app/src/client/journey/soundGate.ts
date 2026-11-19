import { el, trapFocus } from '../shared/dom.ts';

const FADE_MS = 400;

export function openSoundGate(main: HTMLElement, onChoice: (withSound: boolean) => void): void {
  const withSound = el('button', { type: 'button', class: 'primary', text: 'Enter with sound' });
  const muted = el('button', { type: 'button', class: 'secondary', text: 'Enter muted' });
  const dialog = el('div', { class: 'gate-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sound gate' }, [
    el('h2', { class: 'gate-heading', text: 'Earshot by Kettlehole Audio' }),
    el('p', { text: 'Every station builds from silence. Choose how you want to listen.' }),
    el('div', { class: 'gate-actions' }, [withSound, muted]),
  ]);
  const backdrop = el('div', { class: 'gate-backdrop' }, [dialog]);

  let closed = false;
  const close = (sound: boolean): void => {
    if (closed) return;
    closed = true;
    release();
    main.removeAttribute('inert');
    document.body.classList.remove('gate-open');
    onChoice(sound);
    backdrop.classList.add('gate-leaving');
    window.setTimeout(() => backdrop.remove(), FADE_MS);
  };

  const release = trapFocus(dialog, () => close(false));
  withSound.addEventListener('click', () => close(true));
  muted.addEventListener('click', () => close(false));

  main.setAttribute('inert', '');
  document.body.classList.add('gate-open');
  document.body.append(backdrop);
  withSound.focus();
}
