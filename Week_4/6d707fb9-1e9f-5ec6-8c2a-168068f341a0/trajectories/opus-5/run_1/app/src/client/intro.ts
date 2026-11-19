import { focusHeading, pick, pickAll, reducedMotion } from './dom';

const SEEN = 'fioIntroSeen';
const NAME_MS = 640;
const STAGE_MS = 320;
const WHOLE_MS = 1600;

let ending = false;
let timer = 0;

/** A first visit to `/` plays the intro once in that browser. */
export function startIntro(): void {
  const intro = pick<HTMLElement>('[data-part="intro"]');
  if (!intro) return;
  if (location.pathname !== '/') return;
  if (reducedMotion()) return;
  let seen = false;
  try {
    seen = window.localStorage.getItem(SEEN) === 'true';
  } catch {
    seen = false;
  }
  if (seen) return;
  try {
    window.localStorage.setItem(SEEN, 'true');
  } catch {
    /* a browser with no storage plays it once per page */
  }

  intro.hidden = false;
  intro.classList.add('playing');
  for (const behind of pickAll<HTMLElement>('body > *:not([data-part="announcements"])')) {
    if (behind === intro || behind.contains(intro)) continue;
    behind.setAttribute('inert', '');
  }
  const skip = pick<HTMLElement>('[data-action="skip-intro"]', intro);
  if (skip) skip.focus();

  const name = pick<HTMLElement>('[data-part="intro-name"]', intro);
  if (name) name.animate([{ opacity: 0 }, { opacity: 1 }], { duration: NAME_MS, fill: 'forwards' });
  pickAll<HTMLElement>('[data-part="intro-stage"]', intro).forEach((stage, index) => {
    stage.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: STAGE_MS,
      delay: NAME_MS + index * STAGE_MS,
      fill: 'forwards',
    });
  });
  timer = window.setTimeout(endIntro, WHOLE_MS);
}

/** However it ends, focus moves to the level-one heading. */
export function endIntro(): void {
  const intro = pick<HTMLElement>('[data-part="intro"]');
  if (!intro || intro.hidden || ending) return;
  ending = true;
  window.clearTimeout(timer);
  intro.hidden = true;
  intro.classList.remove('playing');
  for (const behind of pickAll<HTMLElement>('body > [inert]')) behind.removeAttribute('inert');
  focusHeading();
  ending = false;
}

export function introPlaying(): boolean {
  const intro = pick<HTMLElement>('[data-part="intro"]');
  return intro !== null && !intro.hidden;
}
