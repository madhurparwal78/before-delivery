import { copy } from '../../shared/copy';
import { timers } from '../../shared/rules';
import type { ReaderBoot, SearchResponse } from '../../shared/types';
import { announce, isTextField, must } from '../shared/dom';
import { openDialog, type OpenDialog } from '../shared/dialog';

export function initSearch(boot: ReaderBoot): void {
  const dialog = document.querySelector<HTMLDialogElement>('#search-dialog');
  if (dialog === null) {
    return;
  }
  const input = must<HTMLInputElement>('#search-input', dialog);
  const count = must<HTMLElement>('#search-count', dialog);
  const list = must<HTMLElement>('#search-results', dialog);
  const base = `/docs/${boot.siteSlug}/${boot.versionSlug}`;
  let session: OpenDialog | null = null;
  let active = -1;
  let ticket = 0;
  let searchTimer: number | undefined;
  let recordTimer: number | undefined;
  let recorded = '';

  const options = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  const mark = (index: number): void => {
    const all = options();
    active = all.length === 0 ? -1 : (index + all.length) % all.length;
    all.forEach((option, at) => option.setAttribute('aria-selected', String(at === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', all[active]?.id ?? '');
      all[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const render = (response: SearchResponse | null): void => {
    list.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    active = -1;
    if (response === null) {
      count.textContent = '';
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    count.textContent = response.count === 0 ? copy.noResults(response.query) : copy.searchCount(response.count, response.query);
    announce(count.textContent);
    response.results.forEach((result, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.id = `result-${index + 1}`;
      item.dataset.url = result.url;
      item.setAttribute('aria-selected', 'false');
      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = result.title;
      const where = document.createElement('span');
      where.className = 'result-group';
      where.textContent = result.heading === null ? result.group : `${result.group} › ${result.heading}`;
      item.append(title, where);
      item.addEventListener('click', () => go(result.url));
      list.append(item);
    });
    list.hidden = response.results.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const run = async (): Promise<void> => {
    const query = input.value.trim();
    const mine = ++ticket;
    if (query === '') {
      render(null);
      return;
    }
    const response = await fetch(`${base}/search?q=${encodeURIComponent(query)}`);
    if (mine === ticket) {
      render((await response.json()) as SearchResponse);
    }
  };
  const record = (keepalive: boolean): void => {
    window.clearTimeout(recordTimer);
    const term = input.value.trim();
    if (term.length >= 2 && term.toLowerCase() !== recorded) {
      recorded = term.toLowerCase();
      void fetch(`${base}/search-terms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }), keepalive });
    }
  };
  const go = (url: string): void => {
    close();
    const target = new URL(url, location.href);
    if (target.pathname === location.pathname && target.hash !== '') {
      location.hash = target.hash;
      document.getElementById(decodeURIComponent(target.hash.slice(1)))?.scrollIntoView({ block: 'start' });
    } else {
      location.href = url;
    }
  };
  function close(): void {
    window.clearTimeout(searchTimer);
    window.clearTimeout(recordTimer);
    session?.close();
    session = null;
  }
  const open = (opener: HTMLElement | null, query = ''): void => {
    if (session !== null) {
      return;
    }
    input.value = query;
    recorded = '';
    render(null);
    session = openDialog(dialog, { returnTo: opener, focus: input, onClose: () => (session = null) });
    if (query !== '') {
      searchTimer = window.setTimeout(() => void run(), timers.searchDebounce);
    }
  };

  input.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    window.clearTimeout(recordTimer);
    searchTimer = window.setTimeout(() => void run(), timers.searchDebounce);
    recordTimer = window.setTimeout(() => record(false), timers.searchRecord);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      mark(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      record(true);
      const url = options()[active]?.dataset.url;
      if (url !== undefined) {
        go(url);
      }
    }
  });
  must<HTMLElement>('#search-close', dialog).addEventListener('click', close);
  document.querySelector<HTMLElement>('#search-button')?.addEventListener('click', (event) => open(event.currentTarget as HTMLElement));
  document.addEventListener('keydown', (event) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open(opener);
    } else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextField(document.activeElement) && session === null) {
      event.preventDefault();
      open(opener);
    }
  });
  const notFound = document.querySelector<HTMLFormElement>('form[data-not-found]');
  notFound?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = must<HTMLInputElement>('input', notFound);
    open(field, field.value);
  });
}
