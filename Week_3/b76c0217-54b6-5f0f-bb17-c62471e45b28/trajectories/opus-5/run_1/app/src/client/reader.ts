import { readerMessages, reasonPhrases } from '../domain/messages';
import {
  $,
  $$,
  announce,
  api,
  CODE_GROUP_KEY,
  connectEvents,
  openDialog,
  pageData,
  reducedMotion,
  setMotion,
  setupTheme,
  tween,
  wait,
  type Dialog,
} from './dom';
import { createDrawer } from './drawer';

const SEARCH_DEBOUNCE = 150;
const SEARCH_RECORD_PAUSE = 1000;
const ACCORDION_TIMER = 150;
const NOTICE_TIMER = 4000;

interface ReaderData {
  siteSlug: string;
  versionSlug: string;
  pageId: string | null;
  pagePath: string | null;
  mode: 'public' | 'preview' | 'shared';
  focusTitle: boolean;
  announce: string | null;
}

const data = pageData<ReaderData>();

function transientNotice(anchor: HTMLElement, text: string): void {
  anchor.parentElement?.querySelector('.notice')?.remove();
  const notice = document.createElement('span');
  notice.className = 'notice';
  notice.textContent = text;
  anchor.insertAdjacentElement('afterend', notice);
  wait(NOTICE_TIMER, () => notice.remove());
  announce(text);
}

/* ---------------- sidebar drawer ---------------- */

function setupDrawer(): void {
  const button = $<HTMLButtonElement>('.menu-button');
  const panel = document.getElementById('site-nav');
  const extra = document.getElementById('drawer-extra');
  if (button === null || panel === null || extra === null) return;
  const header = $('.site-header');
  const tools = $('.header-tools');
  const sections = $('.header-sections');
  const switcher = $('.header-switcher');
  const place = (): void => {
    if (window.innerWidth < 768) {
      if (sections !== null) extra.appendChild(sections);
      if (switcher !== null) extra.appendChild(switcher);
      return;
    }
    if (sections !== null && header !== null && tools !== null) header.insertBefore(sections, tools);
    if (switcher !== null && tools !== null) tools.appendChild(switcher);
  };
  place();
  window.addEventListener('resize', place);
  createDrawer({ panel, button, label: 'Site navigation' });
}

/* ---------------- table of contents ---------------- */

function setupToc(): void {
  const toggle = $<HTMLButtonElement>('.toc-toggle');
  const nav = document.getElementById('toc');
  if (nav === null) return;
  const links = $$<HTMLAnchorElement>('a', nav);
  if (toggle !== null && toggle.dataset.ready !== 'true') {
    toggle.dataset.ready = 'true';
    const sync = (): void => {
      const folded = window.innerWidth < 1024;
      nav.hidden = folded && toggle.getAttribute('aria-expanded') !== 'true';
    };
    toggle.setAttribute('aria-expanded', 'false');
    sync();
    window.addEventListener('resize', sync);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      sync();
    });
  }
  const headings = $$<HTMLElement>('.page-content h2[id], .page-content h3[id]');
  const spy = (): void => {
    let current: HTMLElement | null = headings[0] ?? null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 96) current = heading;
    }
    for (const link of links) {
      if (current !== null && link.hash === `#${current.id}`) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };
  spy();
  window.addEventListener('scroll', spy, { passive: true });
}

function goToHeading(anchor: string): void {
  const heading = document.getElementById(anchor);
  if (heading === null) return;
  heading.setAttribute('tabindex', '-1');
  heading.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
}

function setupAnchorJumps(): void {
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a');
    if (link === null) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#') || href === '#') return;
    event.preventDefault();
    history.replaceState(null, '', href);
    goToHeading(href.slice(1));
  });
}

/* ---------------- search ---------------- */

interface SearchResult {
  pageId: string;
  title: string;
  group: string;
  heading: string | null;
  url: string;
}

function setupSearch(): void {
  const dialogElement = document.getElementById('search-dialog');
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const countLine = document.getElementById('search-count');
  const list = document.getElementById('search-results');
  if (dialogElement === null || input === null || countLine === null || list === null) return;
  let dialog: Dialog | null = null;
  let debounce = 0;
  let recordTimer = 0;
  let results: SearchResult[] = [];
  let active = -1;

  const paint = (query: string): void => {
    list.textContent = '';
    results.forEach((result, index) => {
      const option = document.createElement('li');
      option.setAttribute('role', 'option');
      option.id = `result-${index + 1}`;
      option.setAttribute('aria-selected', 'false');
      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = result.title;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent =
        result.heading === null ? result.group : `${result.group} \u203a ${result.heading}`;
      option.append(title, meta);
      option.addEventListener('click', () => window.location.assign(result.url));
      list.appendChild(option);
    });
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (query === '') {
      countLine.textContent = '';
      return;
    }
    const text =
      results.length === 0
        ? readerMessages.noResults(query)
        : readerMessages.searchCount(results.length, query);
    countLine.textContent = text;
    announce(text);
  };

  const recordTerm = async (query: string): Promise<void> => {
    if (query.trim().length < 2) return;
    await api('POST', `/docs/${data.siteSlug}/${data.versionSlug}/search-terms`, {
      term: query.trim(),
    });
  };

  const search = async (query: string): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed === '') {
      results = [];
      paint('');
      return;
    }
    const response = await api<{ results: SearchResult[] }>(
      'GET',
      `/docs/${data.siteSlug}/${data.versionSlug}/search?q=${encodeURIComponent(trimmed)}`,
    );
    if (!response.ok) return;
    results = response.data.results;
    paint(trimmed);
  };

  const scheduleRecord = (query: string): void => {
    window.clearTimeout(recordTimer);
    recordTimer = wait(SEARCH_RECORD_PAUSE, () => void recordTerm(query));
  };

  const setActive = (index: number): void => {
    const options = $$<HTMLElement>('[role="option"]', list);
    if (options.length === 0) return;
    active = (index + options.length) % options.length;
    options.forEach((option, position) => {
      option.setAttribute('aria-selected', position === active ? 'true' : 'false');
    });
    input.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    const query = input.value;
    window.clearTimeout(debounce);
    debounce = wait(SEARCH_DEBOUNCE, () => void search(query));
    scheduleRecord(query);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(active + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active - 1);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.clearTimeout(recordTimer);
    const chosen = results[active === -1 ? 0 : active];
    void recordTerm(input.value).then(() => {
      if (chosen !== undefined) window.location.assign(chosen.url);
    });
  });

  const open = (query: string, opener: HTMLElement | null): void => {
    if (dialog !== null) return;
    dialog = openDialog(dialogElement, {
      opener,
      focus: input,
      onClose: () => {
        dialog = null;
      },
    });
    input.value = query;
    results = [];
    paint('');
    if (query.trim() !== '') {
      void search(query);
      scheduleRecord(query);
    }
  };

  for (const button of $$<HTMLButtonElement>('.search-button')) {
    button.addEventListener('click', () => open('', button));
  }

  const notFoundBox = document.getElementById('not-found-search') as HTMLInputElement | null;
  notFoundBox?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    open(notFoundBox.value, notFoundBox);
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open('', document.activeElement as HTMLElement | null);
      return;
    }
    if (event.key === '/' && !typing) {
      event.preventDefault();
      open('', document.activeElement as HTMLElement | null);
    }
  });
}

/* ---------------- tabs and code groups ---------------- */

function selectTab(tablist: HTMLElement, tab: HTMLElement): void {
  for (const candidate of $$<HTMLElement>('[role="tab"]', tablist)) {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
    candidate.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(candidate.getAttribute('aria-controls') ?? '');
    if (panel !== null) panel.hidden = !selected;
  }
}

function applyCodeGroupChoice(title: string): void {
  for (const group of $$<HTMLElement>('[data-component="code-group"]')) {
    const tablist = $<HTMLElement>('[role="tablist"]', group);
    if (tablist === null) continue;
    const match = $$<HTMLElement>('[role="tab"]', tablist).find(
      (tab) => tab.dataset.title === title,
    );
    if (match !== undefined) selectTab(tablist, match);
  }
}

function setupTabs(): void {
  const tablists = $$<HTMLElement>(
    '[data-component="tabs"] [role="tablist"], [data-component="code-group"] [role="tablist"]',
  );
  for (const tablist of tablists) {
    if (tablist.dataset.ready === 'true') continue;
    tablist.dataset.ready = 'true';
    const tabs = $$<HTMLElement>('[role="tab"]', tablist);
    const isCodeGroup = tablist.closest('[data-component="code-group"]') !== null;
    const pick = (tab: HTMLElement): void => {
      if (isCodeGroup && tab.dataset.title !== undefined) {
        localStorage.setItem(CODE_GROUP_KEY, tab.dataset.title);
        applyCodeGroupChoice(tab.dataset.title);
        return;
      }
      selectTab(tablist, tab);
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => pick(tab));
      tab.addEventListener('keydown', (event) => {
        const moves: Record<string, number> = {
          ArrowRight: index + 1,
          ArrowLeft: index - 1,
          Home: 0,
          End: tabs.length - 1,
        };
        const next = moves[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const target = tabs[(next + tabs.length) % tabs.length];
        pick(target);
        target.focus();
      });
    });
  }
  const stored = localStorage.getItem(CODE_GROUP_KEY);
  if (stored !== null) applyCodeGroupChoice(stored);

  for (const button of $$<HTMLButtonElement>('.copy-button')) {
    if (button.dataset.ready === 'true') continue;
    button.dataset.ready = 'true';
    button.addEventListener('click', () => {
      const panel = button.closest('[role="tabpanel"]');
      const code = panel?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code);
      transientNotice(button, readerMessages.copied);
    });
  }
}

/* ---------------- accordions ---------------- */

function setupAccordions(): void {
  for (const button of $$<HTMLButtonElement>('.accordion-button')) {
    if (button.dataset.ready === 'true') continue;
    button.dataset.ready = 'true';
    const region = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (region === null) continue;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (expanded) {
        const height = region.scrollHeight;
        setMotion(region, 'closing');
        tween(
          ACCORDION_TIMER,
          (eased) => {
            region.style.height = `${height * (1 - eased)}px`;
          },
          () => {
            region.style.height = '';
            region.hidden = true;
            setMotion(region, 'closed');
          },
        );
        return;
      }
      region.hidden = false;
      setMotion(region, 'opening');
      const height = region.scrollHeight;
      tween(
        ACCORDION_TIMER,
        (eased) => {
          region.style.height = `${height * eased}px`;
        },
        () => {
          region.style.height = '';
          setMotion(region, 'open');
        },
      );
    });
  }
}

/* ---------------- ratings ---------------- */

function setupRatings(): void {
  const group = $<HTMLElement>('.rating');
  if (group === null) return;
  const pageId = group.dataset.page ?? '';
  const buttons = $$<HTMLButtonElement>('button[data-vote]', group);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const pressed = button.getAttribute('aria-pressed') === 'true';
      const vote = pressed ? null : (button.dataset.vote as 'yes' | 'no');
      void api('PUT', `/docs/${data.siteSlug}/ratings/${pageId}`, { vote }).then((response) => {
        if (!response.ok) return;
        for (const candidate of buttons) {
          candidate.setAttribute(
            'aria-pressed',
            vote !== null && candidate.dataset.vote === vote ? 'true' : 'false',
          );
        }
        transientNotice(
          button,
          vote === null ? readerMessages.feedbackRemoved : readerMessages.thanks,
        );
      });
    });
  }
}

/* ---------------- try it ---------------- */

function setupTryIt(): void {
  const panel = $<HTMLElement>('[data-try-it]');
  if (panel === null) return;
  const send = $<HTMLButtonElement>('[data-send-request]', panel);
  const status = $<HTMLElement>('[data-try-status]', panel);
  const bodyOut = $<HTMLElement>('[data-try-body]', panel);
  const codeSelect = $<HTMLSelectElement>('[data-response-code]', panel);
  if (send === null || status === null || bodyOut === null || codeSelect === null) return;
  const inputs = $$<HTMLInputElement>('input[data-parameter]', panel);
  const bodyField = $<HTMLTextAreaElement>('textarea[data-body]', panel);

  const showError = (
    field: HTMLInputElement | HTMLTextAreaElement,
    message: string | null,
  ): void => {
    const error = document.getElementById(`${field.id}-error`);
    if (error === null) return;
    if (message === null) {
      error.hidden = true;
      error.textContent = '';
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
      return;
    }
    error.textContent = message;
    error.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', error.id);
  };

  send.addEventListener('click', () => {
    const invalid: { field: HTMLInputElement | HTMLTextAreaElement; message: string }[] = [];
    for (const input of inputs) {
      const message =
        input.dataset.required === 'true' && input.value.trim() === ''
          ? readerMessages.requiredParameter(input.dataset.parameter ?? '')
          : null;
      showError(input, message);
      if (message !== null) invalid.push({ field: input, message });
    }
    if (bodyField !== null) {
      let message: string | null = null;
      try {
        JSON.parse(bodyField.value);
      } catch {
        message = readerMessages.invalidBody;
      }
      showError(bodyField, message);
      if (message !== null) invalid.push({ field: bodyField, message });
    }
    if (invalid.length > 0) {
      announce(invalid[0].message);
      invalid[0].field.focus();
      return;
    }
    const parameters: Record<string, string> = {};
    for (const input of inputs) parameters[input.dataset.parameter ?? ''] = input.value;
    void api<unknown>(
      'POST',
      `/api/mock/${panel.dataset.site ?? ''}/${panel.dataset.version ?? ''}/${panel.dataset.operation ?? ''}`,
      { code: Number(codeSelect.value), parameters, body: bodyField === null ? '' : bodyField.value },
    ).then((response) => {
      const line = readerMessages.tryItStatusLine(
        response.status,
        reasonPhrases[response.status] ?? '',
      );
      status.textContent = line;
      status.hidden = false;
      bodyOut.textContent = JSON.stringify(response.ok ? response.data : response.error, null, 2);
      bodyOut.hidden = false;
      announce(line);
    });
  });
}

/* ---------------- version switcher ---------------- */

function setupSwitcher(): void {
  for (const switcher of $$<HTMLElement>('.header-switcher')) {
    const button = $<HTMLButtonElement>('.version-button', switcher);
    const list = $<HTMLElement>('[role="listbox"]', switcher);
    if (button === null || list === null) continue;
    const options = $$<HTMLElement>('[role="option"]', list);
    const close = (): void => {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    const choose = (option: HTMLElement): void => {
      window.location.assign(
        `/docs/${data.siteSlug}/${option.dataset.slug ?? ''}/${data.pagePath ?? ''}?from=${encodeURIComponent(data.versionSlug)}`,
      );
    };
    const openList = (): void => {
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      const current = options.find((option) => option.getAttribute('aria-selected') === 'true');
      (current ?? options[0])?.focus();
    };
    for (const option of options) {
      option.tabIndex = -1;
      option.addEventListener('click', () => choose(option));
      option.addEventListener('keydown', (event) => {
        const index = options.indexOf(option);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
          options[(next + options.length) % options.length].focus();
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose(option);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          button.focus();
        }
      });
    }
    button.addEventListener('click', () => {
      if (list.hidden) openList();
      else close();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && list.hidden) {
        event.preventDefault();
        openList();
      }
    });
  }
}

/* ---------------- live updates ---------------- */

async function replaceContent(): Promise<void> {
  const response = await fetch(window.location.href, { headers: { Accept: 'text/html' } });
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const content = parsed.querySelector('.page-content');
  const current = document.querySelector('.page-content');
  if (content !== null && current !== null) current.innerHTML = content.innerHTML;
  const title = parsed.querySelector('#page-title');
  const currentTitle = document.getElementById('page-title');
  if (title !== null && currentTitle !== null) currentTitle.textContent = title.textContent;
  const toc = parsed.querySelector('#toc');
  const currentToc = document.getElementById('toc');
  if (toc !== null && currentToc !== null) currentToc.innerHTML = toc.innerHTML;
  document.title = parsed.title;
  setupTabs();
  setupAccordions();
  setupToc();
}

function setupLiveUpdates(): void {
  if (data.mode === 'preview' && data.pageId !== null) {
    connectEvents(`/api/events?pageId=${data.pageId}`, { page: () => void replaceContent() });
    return;
  }
  if (data.mode !== 'public' || data.pageId === null) return;
  const banner = document.getElementById('update-banner');
  const reload = document.getElementById('reload-button');
  if (banner === null || reload === null) return;
  reload.addEventListener('click', () => window.location.reload());
  connectEvents(`/docs/${data.siteSlug}/events`, {
    published: (payload) => {
      const changed = (payload as { changedPageIds: string[] }).changedPageIds;
      if (!changed.includes(data.pageId as string)) return;
      banner.hidden = false;
      announce(readerMessages.updateBanner);
    },
  });
}

function start(): void {
  setupTheme();
  setupDrawer();
  setupToc();
  setupAnchorJumps();
  setupSearch();
  setupTabs();
  setupAccordions();
  setupRatings();
  setupTryIt();
  setupSwitcher();
  setupLiveUpdates();
  if (window.location.hash.length > 1) goToHeading(window.location.hash.slice(1));
  if (data.focusTitle) document.getElementById('page-title')?.focus();
  if (data.announce !== null && data.announce !== undefined) announce(data.announce);
}

start();
