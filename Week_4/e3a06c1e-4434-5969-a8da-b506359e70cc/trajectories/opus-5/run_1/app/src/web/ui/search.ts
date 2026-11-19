import { ApiFailure, request } from '../api.js';
import { clear, el } from '../dom.js';
import { StatusRegion } from './status.js';
import { searchCopy } from '../../shared/copy.js';
import type { SessionView } from '../../shared/types.js';

const DEBOUNCE_MS = 250;

interface SearchReply {
  total: number;
  sessions: SessionView[];
}

/**
 * Session search. Results and the count update in place for the box's current
 * text only; replies for earlier text are thrown away.
 */
export class SessionSearch {
  readonly node: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status = new StatusRegion('Search results');
  private timer = 0;

  constructor() {
    this.input = el('input', {
      type: 'search',
      id: 'session-search',
      'aria-label': 'Search sessions',
      class: 'input search-input',
      autocomplete: 'off',
    });
    this.list = el('ul', { 'aria-label': 'Session results', class: 'search-results' });
    this.node = el('div', { class: 'search' }, [
      el('label', { class: 'field-label visually-hidden', for: 'session-search', text: 'Search sessions' }),
      this.input,
      this.status.node,
      this.list,
    ]);
    this.input.addEventListener('input', () => this.onInput());
  }

  private onInput(): void {
    window.clearTimeout(this.timer);
    const text = this.input.value;
    if (text.trim() === '') {
      clear(this.list);
      this.status.clear();
      return;
    }
    this.timer = window.setTimeout(() => void this.run(text), DEBOUNCE_MS);
  }

  private async run(text: string): Promise<void> {
    try {
      const reply = await request<SearchReply>(`/api/sessions/search?q=${encodeURIComponent(text)}`);
      if (this.input.value !== text) return;
      this.render(reply);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) return;
    }
  }

  private render(reply: SearchReply): void {
    clear(this.list);
    for (const session of reply.sessions)
      this.list.append(
        el('li', { class: 'search-result' }, [
          el('a', { href: `/console/sessions/${session.id}`, class: 'search-link', text: session.label || 'Untitled session' }),
        ]),
      );
    this.status.set(searchCopy.found(reply.total));
  }
}
