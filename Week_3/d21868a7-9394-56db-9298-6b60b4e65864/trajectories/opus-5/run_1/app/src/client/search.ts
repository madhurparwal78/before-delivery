import { api, SessionEnded } from './api.ts';
import { clear, el, svg } from './dom.ts';
import { lucideIcons } from './lucide.ts';
import { navigate } from './navigation.ts';
import type { Suggestion } from './types.ts';

/** The global search box: up to 8 live suggestions for the latest text typed. */

export interface SearchBox {
  element: HTMLElement;
  refresh: () => Promise<void>;
}

export function searchBox(): SearchBox {
  const listbox = el('ul', {
    class: 'suggestions',
    attrs: { role: 'listbox', 'aria-label': 'Suggestions', hidden: true },
  });
  const input = el('input', {
    class: 'search-input',
    attrs: {
      type: 'text',
      role: 'combobox',
      'aria-label': 'Search turnouts, growers and operators',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': 'search-suggestions',
      autocomplete: 'off',
    },
  });
  listbox.id = 'search-suggestions';

  let sequence = 0;
  let suggestions: Suggestion[] = [];
  let activeIndex = -1;
  let timer = 0;

  const closeList = (): void => {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const paint = (): void => {
    clear(listbox);
    suggestions.forEach((suggestion, index) => {
      const option = el('li', {
        class: 'suggestion',
        attrs: {
          role: 'option',
          id: `search-option-${index}`,
          'aria-selected': index === activeIndex ? 'true' : 'false',
        },
        children: [
          el('span', { class: 'suggestion-label', text: suggestion.label }),
          el('span', { class: 'suggestion-detail', text: suggestion.detail }),
        ],
        on: {
          mousedown: (event) => {
            event.preventDefault();
            follow(index);
          },
        },
      });
      listbox.appendChild(option);
    });
    listbox.hidden = suggestions.length === 0;
    input.setAttribute('aria-expanded', suggestions.length === 0 ? 'false' : 'true');
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      input.setAttribute('aria-activedescendant', `search-option-${activeIndex}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const follow = (index: number): void => {
    const suggestion = suggestions[index];
    if (suggestion === undefined) return;
    closeList();
    navigate(suggestion.href);
  };

  const load = async (text: string): Promise<void> => {
    const mine = ++sequence;
    try {
      const reply = await api.get<{ suggestions: Suggestion[] }>(`/api/search?q=${encodeURIComponent(text)}`);
      if (mine !== sequence) return;
      suggestions = reply.suggestions;
      activeIndex = -1;
      paint();
    } catch (cause) {
      if (cause instanceof SessionEnded) return;
      if (mine !== sequence) return;
      suggestions = [];
      paint();
    }
  };

  input.addEventListener('input', () => {
    const text = input.value.trim();
    window.clearTimeout(timer);
    if (text.length < 2) {
      sequence += 1;
      suggestions = [];
      closeList();
      return;
    }
    timer = window.setTimeout(() => void load(text), 150);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      paint();
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      activeIndex = activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
      paint();
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      follow(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeList();
    }
  });

  const element = el('div', {
    class: 'search',
    children: [svg(lucideIcons.search as string, 'icon'), input, listbox],
  });

  const refresh = async (): Promise<void> => {
    const text = input.value.trim();
    if (text.length < 2 || listbox.hidden) return;
    await load(text);
  };

  return { element, refresh };
}
