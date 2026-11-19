// Join: tier picker and account form, keyboard-only, one join request at a time.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { renderProblems, setPending, clearPending } from './ui';

const TIERS = [
  { value: 'pay-what-you-can', label: 'Pay what you can — $15.00 a year' },
  { value: 'standard', label: 'Standard — $40.00 a year' },
  { value: 'supporter', label: 'Supporter — $75.00 a year' },
];

export function renderJoinScreen(kit: ScreenKit): () => void {
  const { main } = kit;
  clear(main);
  const wrap = el('div', { class: 'single-column' });
  const announce = el('div', { role: 'status', 'aria-label': 'Account updates', 'aria-live': 'polite' });
  const problems = el('div');

  const heading = el('h1', { text: 'Join the tool library' });

  const tierGroup = el('fieldset', { class: 'tier-picker', role: 'radiogroup', 'aria-label': 'Membership tier' });
  tierGroup.append(el('legend', { text: 'Membership tier' }));
  const radios: HTMLInputElement[] = [];
  for (const tier of TIERS) {
    const input = el('input', { type: 'radio', name: 'tier', value: tier.value, id: `tier-${tier.value}` }) as HTMLInputElement;
    const label = el('label', { class: 'tier-option', for: `tier-${tier.value}` }, input, el('span', { text: tier.label }));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const idx = radios.indexOf(input);
        const nextRadio = radios[(idx + 1) % radios.length]!;
        nextRadio.checked = true;
        nextRadio.focus();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const idx = radios.indexOf(input);
        const prevRadio = radios[(idx - 1 + radios.length) % radios.length]!;
        prevRadio.checked = true;
        prevRadio.focus();
      }
    });
    radios.push(input);
    tierGroup.append(label);
  }

  const nameHolder = el('div', { class: 'field' });
  const name = el('input', { type: 'text', id: 'name', autocomplete: 'name' }) as HTMLInputElement;
  nameHolder.append(el('label', { for: 'name', text: 'Name' }), name);

  const emailHolder = el('div', { class: 'field' });
  const email = el('input', { type: 'text', id: 'join-email', autocomplete: 'email' }) as HTMLInputElement;
  emailHolder.append(el('label', { for: 'join-email', text: 'Email' }), email);

  const passwordHolder = el('div', { class: 'field' });
  const password = el('input', { type: 'password', id: 'join-password', autocomplete: 'new-password' }) as HTMLInputElement;
  passwordHolder.append(el('label', { for: 'join-password', text: 'Password' }), password);

  const submit = el('button', { class: 'primary', text: 'Pay and join' }) as HTMLButtonElement;

  const form = el('form');
  form.append(announce, problems, heading, tierGroup, nameHolder, emailHolder, passwordHolder, submit);

  const fieldsOf = (field: string): HTMLElement | null => {
    if (field === 'tier') return tierGroup;
    if (field === 'name') return name;
    if (field === 'email') return email;
    if (field === 'password') return password;
    return null;
  };

  let pending = false;

  form.addEventListener('submit', (event) => void handleJoin(event));
  for (const input of [name, email, password]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && pending) event.preventDefault();
    });
  }

  async function handleJoin(event: Event): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const tier = radios.find((radio) => radio.checked)?.value;
    if (tier === undefined) {
      renderProblems(problems, { tier: 'Pick a membership tier.' }, fieldsOf);
      focusSummary();
      return;
    }
    pending = true;
    setPending(submit, 'Starting your membership...');
    try {
      await apiJson('POST', '/api/members', { name: name.value, email: email.value, password: password.value, tier });
      window.location.href = '/account';
    } catch (err) {
      pending = false;
      clearPending(submit);
      if (err instanceof ApiFailure) {
        if (err.status === 422) {
          renderProblems(problems, err.fields ?? {}, fieldsOf);
          focusSummary();
        } else {
          announce.textContent = err.error;
        }
      }
    }
  }

  function focusSummary(): void {
    problems.setAttribute('tabindex', '-1');
    problems.focus();
  }

  wrap.append(form);
  main.append(wrap);
  radios[0]!.focus();
  return () => {};
}
