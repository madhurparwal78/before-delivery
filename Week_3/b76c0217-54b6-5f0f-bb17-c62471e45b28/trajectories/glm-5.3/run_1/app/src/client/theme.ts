const KEY = 'galley-theme';

export type ThemeChoice = 'light' | 'dark' | 'system';

let currentSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(theme: ThemeChoice, animate: boolean): void {
  const resolved = theme === 'system' ? (currentSystemDark ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  const doSwitch = () => {
    root.dataset.theme = resolved;
  };
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-fade');
    window.setTimeout(() => {
      doSwitch();
      window.setTimeout(() => root.classList.remove('theme-fade'), 200);
    }, 0);
  } else {
    doSwitch();
  }
}

export function initTheme(): void {
  const saved = (localStorage.getItem(KEY) as ThemeChoice | null) ?? 'system';
  apply(saved, false);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    currentSystemDark = e.matches;
    if ((localStorage.getItem(KEY) as ThemeChoice | null) === null || localStorage.getItem(KEY) === 'system') {
      apply('system', false);
    }
  });
}

export function setTheme(theme: ThemeChoice): void {
  localStorage.setItem(KEY, theme);
  apply(theme, true);
}

export function currentTheme(): ThemeChoice {
  return (localStorage.getItem(KEY) as ThemeChoice | null) ?? 'system';
}

export function renderThemeGroup(container: HTMLElement, opts: { compact?: boolean }): void {
  container.setAttribute('role', 'radiogroup');
  container.setAttribute('aria-label', 'Theme');
  const choices: { value: ThemeChoice; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];
  for (const c of choices) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.id = `theme-${c.value}${container.dataset.themeId ?? ''}`;
    input.value = c.value;
    input.checked = currentTheme() === c.value;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = c.label;
    input.addEventListener('change', () => { setTheme(c.value); });
    container.append(input, label);
  }
  window.setInterval(() => {
    const now = currentTheme();
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const r of radios) r.checked = r.value === now;
  }, 500);
}
