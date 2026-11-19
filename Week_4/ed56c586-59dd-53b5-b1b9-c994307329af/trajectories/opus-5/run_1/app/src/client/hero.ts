/** The hero: its intro timeline, copy drift, sculpture tilt and role line. */

import { INTRO_END_MS, ROLE_INTERVAL_MS, copyDrift, sculptureTilt } from '../shared/rules.js';
import { ROLES } from '../shared/seed.js';
import { ROLES_PAUSED, ROLES_RESUMED } from '../shared/text.js';
import { announce, isNarrow, need, onScrollOrResize, reducedMotion } from './dom.js';

const ROLE_COUNT = ROLES.length;

interface RoleLine {
  readonly start: () => void;
}

const setUpRoles = (): RoleLine => {
  const line = need<HTMLElement>('[data-role-line]');
  const role = need<HTMLElement>('[data-role]');
  const previousButton = need<HTMLButtonElement>('[data-role-previous]');
  const nextButton = need<HTMLButtonElement>('[data-role-next]');
  const toggleButton = need<HTMLButtonElement>('[data-role-toggle]');

  let index = 1;
  let running = false;
  let paused = reducedMotion();
  let hovering = false;
  let focused = false;
  let focusHoldIgnored = false;
  let timer: number | null = null;

  if (paused) toggleButton.textContent = 'Play roles';

  const held = (): boolean => hovering || (focused && !focusHoldIgnored);

  const clearTimer = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const show = (next: number, sliding: boolean): void => {
    index = next;
    role.dataset.roleIndex = String(next);
    role.textContent = ROLES[next - 1] ?? '';
    line.removeAttribute('data-role-sliding');
    if (sliding && !reducedMotion()) {
      // Restarting the slide needs the attribute to be re-applied after a reflow.
      void line.offsetWidth;
      line.dataset.roleSliding = 'true';
    }
  };

  const schedule = (): void => {
    clearTimer();
    if (!running || paused || held()) return;
    timer = window.setTimeout(() => {
      show((index % ROLE_COUNT) + 1, true);
      schedule();
    }, ROLE_INTERVAL_MS);
  };

  const step = (delta: number): void => {
    show(((index - 1 + delta + ROLE_COUNT) % ROLE_COUNT) + 1, false);
    schedule();
  };

  previousButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  toggleButton.addEventListener('click', () => {
    paused = !paused;
    toggleButton.textContent = paused ? 'Play roles' : 'Pause roles';
    if (!paused) focusHoldIgnored = true;
    announce(paused ? ROLES_PAUSED : ROLES_RESUMED);
    schedule();
  });

  line.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovering = true;
    clearTimer();
  });
  line.addEventListener('pointerleave', () => {
    hovering = false;
    schedule();
  });

  for (const button of [previousButton, nextButton, toggleButton]) {
    button.addEventListener('focus', () => {
      focused = true;
      focusHoldIgnored = false;
      clearTimer();
    });
    button.addEventListener('blur', () => {
      focused = false;
      schedule();
    });
  }

  return {
    start: () => {
      running = true;
      schedule();
    },
  };
};

const setUpIntro = (roles: RoleLine): void => {
  const intro = need<HTMLElement>('[data-intro]');
  let done = intro.dataset.intro === 'done';

  const end = (): void => {
    if (done) return;
    done = true;
    intro.dataset.intro = 'done';
    roles.start();
  };

  if (done || reducedMotion() || window.location.hash !== '') {
    intro.dataset.intro = 'done';
    done = true;
    roles.start();
    return;
  }

  const timer = window.setTimeout(end, INTRO_END_MS);
  const types = ['keydown', 'pointerdown', 'wheel', 'scroll'];
  const skip = (): void => {
    window.clearTimeout(timer);
    end();
    for (const type of types) window.removeEventListener(type, skip);
  };
  for (const type of types) window.addEventListener(type, skip, { passive: true });
};

const setUpCopyDrift = (): void => {
  const copy = need<HTMLElement>('[data-hero-copy]');
  onScrollOrResize(() => {
    const drift = reducedMotion() ? 0 : copyDrift(window.scrollY);
    copy.style.transform = `translateY(-${drift}px)`;
  });
};

const setUpTilt = (): void => {
  const intro = need<HTMLElement>('[data-intro]');
  const visual = need<HTMLElement>('[data-hero-visual]');

  const write = (x: number, y: number): void => {
    visual.dataset.tiltX = String(x);
    visual.dataset.tiltY = String(y);
    visual.style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
  };

  write(0, 0);

  intro.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || isNarrow() || reducedMotion()) {
      write(0, 0);
      return;
    }
    const box = intro.getBoundingClientRect();
    const tilt = sculptureTilt(event.clientX, event.clientY, box);
    write(tilt.x, tilt.y);
  });
  intro.addEventListener('pointerleave', () => write(0, 0));
};

export const setUpHero = (): void => {
  const roles = setUpRoles();
  setUpIntro(roles);
  setUpCopyDrift();
  setUpTilt();
};
