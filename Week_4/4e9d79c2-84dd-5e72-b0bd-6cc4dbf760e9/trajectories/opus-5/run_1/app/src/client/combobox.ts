import { announce, all, api, one } from './dom.js';

type Suggestion = { id: string; text: string };

const TYPING_PAUSE_MS = 300;

/** One combobox that asks once after the typing pauses, reuses what the page has and ignores older replies. */
export function startCombobox(holder: HTMLElement): void {
  const input = one<HTMLInputElement>('input', holder);
  const list = one<HTMLUListElement>('.combobox-list', holder);
  if (!input || !list) return;
  const held = new Map<string, Suggestion[]>();
  let timer = 0;
  let asked = 0;
  let active = -1;

  const closeList = (): void => {
    list.setAttribute('hidden', '');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const show = (suggestions: Suggestion[]): void => {
    list.innerHTML = '';
    if (suggestions.length === 0) {
      closeList();
      return;
    }
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('li');
      item.id = `${input.id}-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.dataset.id = suggestion.id;
      item.textContent = suggestion.text;
      item.addEventListener('click', () => {
        void choose(suggestion);
      });
      list.append(item);
    });
    list.removeAttribute('hidden');
    input.setAttribute('aria-expanded', 'true');
    announce(`${suggestions.length} suggestions.`);
  };

  const choose = async (suggestion: Suggestion): Promise<void> => {
    const answer = await api<{ text: string }>(`/api/public/address/get/${encodeURIComponent(suggestion.id)}`);
    input.value = answer.ok ? answer.body.text : suggestion.text;
    input.dataset.checked = answer.ok ? 'true' : 'false';
    closeList();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  };

  const ask = async (text: string): Promise<void> => {
    const kept = held.get(text);
    if (kept) {
      show(kept);
      return;
    }
    asked += 1;
    const mine = asked;
    const answer = await api<{ suggestions: Suggestion[] }>(`/api/public/address/find?q=${encodeURIComponent(text)}`);
    if (mine !== asked) return;
    if (!answer.ok) {
      closeList();
      announce('We could not check this address. You can carry on and type it in full.');
      return;
    }
    held.set(text, answer.body.suggestions);
    show(answer.body.suggestions);
  };

  input.addEventListener('input', () => {
    input.dataset.checked = 'false';
    window.clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 3) {
      closeList();
      return;
    }
    timer = window.setTimeout(() => {
      void ask(text);
    }, TYPING_PAUSE_MS);
  });

  input.addEventListener('keydown', (event) => {
    const items = all<HTMLLIElement>('li', list);
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeList();
      return;
    }
    if (items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = event.key === 'ArrowDown' ? Math.min(active + 1, items.length - 1) : Math.max(active - 1, 0);
      items.forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', items[active].id);
      return;
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const item = items[active];
      void choose({ id: item.dataset.id as string, text: item.textContent ?? '' });
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(closeList, 150);
  });
}

export function startComboboxes(within: ParentNode = document): void {
  for (const holder of all<HTMLElement>('[data-combobox]', within)) {
    if (holder.dataset.started === 'true') continue;
    holder.dataset.started = 'true';
    startCombobox(holder);
  }
}
