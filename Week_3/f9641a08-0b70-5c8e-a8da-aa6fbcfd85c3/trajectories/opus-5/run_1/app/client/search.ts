import { api, escapeHtml, qs, qsa } from './core.js';

type Suggestion = { name: string; slug: string };

let latest = 0;
let activeIndex = -1;
let typed = '';

function listbox(): HTMLElement | null {
  return qs<HTMLElement>('#search-suggestions');
}

function setActive(index: number): void {
  const list = listbox();
  if (list === null) return;
  const options = qsa<HTMLElement>('[role="option"]', list);
  activeIndex = index;
  options.forEach((option, position) => {
    option.setAttribute('aria-selected', position === index ? 'true' : 'false');
  });
  const input = qs<HTMLInputElement>('[data-search-input]');
  if (input === null) return;
  if (index >= 0 && options[index] !== undefined) {
    input.setAttribute('aria-activedescendant', options[index].id);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function closeList(): void {
  const list = listbox();
  const input = qs<HTMLInputElement>('[data-search-input]');
  if (list !== null) {
    list.hidden = true;
    list.innerHTML = '';
  }
  input?.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
}

function showSuggestions(suggestions: Suggestion[]): void {
  const list = listbox();
  const input = qs<HTMLInputElement>('[data-search-input]');
  if (list === null || input === null) return;
  if (suggestions.length === 0) {
    closeList();
    return;
  }
  list.innerHTML = suggestions
    .map(
      (suggestion, index) =>
        `<li role="option" id="suggestion-${index}" aria-selected="false" data-slug="${escapeHtml(
          suggestion.slug
        )}">${escapeHtml(suggestion.name)}</li>`
    )
    .join('');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  setActive(-1);
}

export function setupSearch(): void {
  const input = qs<HTMLInputElement>('[data-search-input]');
  if (input === null) return;

  input.addEventListener('input', () => {
    typed = input.value;
    const token = ++latest;
    void api<{ suggestions: Suggestion[] }>(`/api/search/suggest?q=${encodeURIComponent(input.value)}`)
      .then((response) => {
        if (token !== latest) return;
        showSuggestions(response.suggestions);
      })
      .catch(() => undefined);
  });

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    const list = listbox();
    const options = list === null ? [] : qsa<HTMLElement>('[role="option"]', list);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (options.length > 0) setActive((activeIndex + 1) % options.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length > 0) setActive((activeIndex - 1 + options.length) % options.length);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeList();
      input.value = typed;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && options[activeIndex] !== undefined) {
        window.location.href = `/products/${options[activeIndex].dataset.slug}`;
        return;
      }
      window.location.href = `/collections/all?q=${encodeURIComponent(input.value)}`;
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const option = target.closest<HTMLElement>('#search-suggestions [role="option"]');
    if (option !== null) {
      window.location.href = `/products/${option.dataset.slug}`;
      return;
    }
    if (target.closest('.search-shell') === null) closeList();
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== '/') return;
    const target = event.target as HTMLElement | null;
    if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target !== null && target.isContentEditable) return;
    event.preventDefault();
    input.focus();
  });
}
