import { api, ApiFailure } from '../api.js';
import type { Me } from '../api.js';
import { avatarSvg } from '../avatars.js';
import { NAME_ERRORS } from '../copy.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { refreshMe, state } from '../store.js';

export async function renderWelcome(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  const me = state.me ?? (await refreshMe());
  let avatar = me?.avatar ?? 1;

  const nameInput = el('input', {
    type: 'text',
    id: 'name-input',
    'aria-label': 'Name',
    autocomplete: 'off',
    maxlength: '16',
    value: me !== null && me.chosen ? me.name : '',
  });
  const error = el('div', { id: 'name-error', role: 'alert', class: 'inline-error' });
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Avatar', class: 'avatar-grid' });
  const radios: HTMLInputElement[] = [];

  function select(n: number): void {
    avatar = n;
    radios.forEach((radio, index) => {
      const value = index + 1;
      radio.checked = value === n;
      radio.tabIndex = value === n ? 0 : -1;
    });
  }

  for (let n = 1; n <= 24; n += 1) {
    const input = el('input', {
      type: 'radio',
      name: 'avatar',
      id: `avatar-${n}`,
      'aria-label': `Avatar ${n}`,
      value: String(n),
      checked: n === avatar,
      tabindex: n === avatar ? '0' : '-1',
    });
    input.addEventListener('change', () => select(n));
    const option = el('span', { class: 'avatar-option' }, [avatarSvg(n), input]);
    radios.push(input);
    group.append(option);
  }

  group.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    let next = avatar + step;
    if (event.key === 'Home') next = 1;
    if (event.key === 'End') next = 24;
    if (next < 1) next = 24;
    if (next > 24) next = 1;
    select(next);
    radios[next - 1].focus();
  });

  const continueButton = el('button', { type: 'submit', text: 'Continue' });
  const skipButton = el('button', { type: 'button', text: 'Skip' });

  function showError(code: string, suggestions: string[]): void {
    clear(error);
    const message = NAME_ERRORS[code] ?? NAME_ERRORS.NAME_INVALID;
    error.append(icon('circle-alert'), el('span', { text: message }));
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.setAttribute('aria-describedby', 'name-error');
    if (suggestions.length > 0) {
      const row = el('span', { class: 'suggestions' });
      for (const suggestion of suggestions) {
        const button = el('button', { type: 'button', text: suggestion });
        button.addEventListener('click', () => {
          nameInput.value = suggestion;
          nameInput.focus();
        });
        row.append(button);
      }
      error.append(row);
    }
  }

  function clearError(): void {
    clear(error);
    nameInput.removeAttribute('aria-invalid');
    nameInput.removeAttribute('aria-describedby');
  }

  function arrive(): void {
    navigate('/');
    window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('h1');
      if (heading === null) return;
      heading.tabIndex = -1;
      heading.focus();
    });
  }

  async function submit(): Promise<void> {
    clearError();
    continueButton.disabled = true;
    try {
      state.me = await api.post<Me>('/api/me/name', { name: nameInput.value, avatar });
      arrive();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const suggestions = Array.isArray(failure.body.suggestions)
          ? (failure.body.suggestions as string[])
          : [];
        showError(failure.code, suggestions);
      }
    } finally {
      continueButton.disabled = false;
    }
  }

  const form = el('form', { class: 'stack' }, [
    el('h1', { class: 'display', text: 'Pick a name', style: 'font-size: var(--step-4)' }),
    el('div', {}, [el('label', { for: 'name-input', text: 'Name' }), nameInput, error]),
    el('div', {}, [el('span', { class: 'label', text: 'Avatar', style: 'font-weight:700' }), group]),
    el('div', { class: 'row' }, [continueButton, skipButton]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  skipButton.addEventListener('click', () => {
    void (async () => {
      skipButton.disabled = true;
      try {
        state.me = await api.post<Me>('/api/me/skip');
        arrive();
      } finally {
        skipButton.disabled = false;
      }
    })();
  });

  clear(view);
  view.append(el('section', { class: 'field field--ground' }, [el('div', { class: 'sheet' }, [form])]));
}
