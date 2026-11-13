import { timers } from '../../shared/rules';
import { reducedMotion } from './dom';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'galley-theme';

function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Apply a theme at once; the page cross-fades unless reduced motion is asked for. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (!reducedMotion()) {
    root.classList.add('theme-fading');
    window.setTimeout(() => root.classList.remove('theme-fading'), timers.theme + 50);
  }
  root.dataset.theme = theme;
}

function chooseTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // the choice still applies to this page
  }
  applyTheme(theme);
}

/** Wire a radio group: show the remembered theme, apply a choice, follow a choice made in another tab. */
export function bindThemeSwitch(group: HTMLElement): void {
  const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const show = (): void => {
    for (const radio of radios) {
      radio.checked = radio.value === currentTheme();
    }
  };
  show();
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        chooseTheme(radio.value as Theme);
      }
    });
  }
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) {
      applyTheme(currentTheme());
      show();
    }
  });
}
