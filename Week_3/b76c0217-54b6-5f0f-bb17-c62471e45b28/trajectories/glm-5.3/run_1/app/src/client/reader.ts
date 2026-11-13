import { announce, api, TIMERS, prefersReducedMotion, qs, qsa, focusable, trapFocus } from './core';
import { initTheme } from './theme';

initTheme();

interface SearchResult {
  pageId: string; title: string; group: string; heading: string | null; url: string;
}

function siteSlug(): string { return document.body.dataset.siteSlug ?? ''; }
function versionSlug(): string { return document.body.dataset.versionSlug ?? ''; }
function docsBase(): string { return `/docs/${siteSlug()}/${versionSlug}`; }

// ---------- Announcer ----------
if (!document.getElementById('announcer')) {
  const region = document.createElement('div');
  region.id = 'announcer';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.className = 'sr-only';
  document.body.append(region);
}

// ---------- Drawer (Site navigation) ----------
const menuButton = document.querySelector<HTMLButtonElement>('[data-menu-button]');

function drawerElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-drawer="site-navigation"]');
}

function openDrawer(): void {
  const drawer = drawerElement();
  if (!drawer || !menuButton) return;
  drawer.hidden = false;
  drawer.dataset.motion = prefersReducedMotion() ? 'open' : 'opening';
  menuButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('drawer-open');
  trapFocus(drawer);
  if (prefersReducedMotion()) {
    drawer.dataset.motion = 'open';
  } else {
    window.setTimeout(() => { drawer.dataset.motion = 'open'; }, TIMERS.drawer);
  }
  focusable(drawer)[0]?.focus();
}

function closeDrawer(): void {
  const drawer = drawerElement();
  if (!drawer || !menuButton) return;
  if (prefersReducedMotion()) {
    drawer.hidden = true;
    drawer.dataset.motion = 'closed';
  } else {
    drawer.dataset.motion = 'closing';
    window.setTimeout(() => { drawer.hidden = true; drawer.dataset.motion = 'closed'; }, TIMERS.drawer);
  }
  menuButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('drawer-open');
  menuButton.focus();
}

if (menuButton) {
  menuButton.addEventListener('click', () => {
    if (menuButton.getAttribute('aria-expanded') === 'true') closeDrawer();
    else openDrawer();
  });
  const backdrop = document.querySelector<HTMLElement>('[data-drawer-backdrop]');
  backdrop?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    const drawer = drawerElement();
    if (e.key === 'Escape' && drawer && !drawer.hidden) {
      e.preventDefault();
      closeDrawer();
    }
  });
  const drawer = drawerElement();
  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target instanceof HTMLAnchorElement) closeDrawer();
    });
  }
}

// ---------- Table of contents disclosure ----------
qsa<HTMLButtonElement>('[data-toc-toggle]').forEach((btn) => {
  const listId = btn.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    if (list) list.hidden = expanded;
  });
});

// ---------- TOC current heading ----------
const tocLinks = qsa<HTMLAnchorElement>('[data-toc] a[href^="#"]');
if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
  const byId = new Map<string, HTMLAnchorElement>();
  for (const l of tocLinks) byId.set(l.getAttribute('href')!.slice(1), l);
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const link = byId.get(entry.target.id);
      if (!link) continue;
      tocLinks.forEach((l) => l.removeAttribute('aria-current'));
      link.setAttribute('aria-current', 'location');
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const [id] of byId) {
    const h = document.getElementById(id);
    if (h) observer.observe(h);
  }
}

// ---------- Search dialog ----------
type SearchUi = {
  dialog: HTMLDialogElement | HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  count: HTMLElement;
  active: number;
  results: SearchResult[];
  opener: HTMLElement | null;
  recordTimer: number | undefined;
  debounceTimer: number | undefined;
};

function searchDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-search-dialog]');
}

let searchUi: SearchUi | null = null;

function ensureSearchUi(opener: HTMLElement | null): SearchUi {
  const existing = searchUi;
  if (existing) {
    existing.opener = opener;
    return existing;
  }
  const dialog = searchDialog();
  if (!dialog) throw new Error('no search dialog');
  const input = dialog.querySelector<HTMLInputElement>('[data-search-input]')!;
  const list = dialog.querySelector<HTMLElement>('[data-search-results]')!;
  const count = dialog.querySelector<HTMLElement>('[data-search-count]')!;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Search results');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', list.id || 'search-results');
  if (!list.id) list.id = 'search-results';
  input.setAttribute('aria-controls', list.id);
  const ui: SearchUi = { dialog, input, list, count, active: 0, results: [], opener, recordTimer: undefined, debounceTimer: undefined };
  searchUi = ui;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  trapFocus(dialog);
  input.addEventListener('input', () => {
    if (ui.debounceTimer) window.clearTimeout(ui.debounceTimer);
    ui.debounceTimer = window.setTimeout(() => void runSearch(ui), TIMERS.searchDebounce);
    if (ui.recordTimer) window.clearTimeout(ui.recordTimer);
    const term = input.value.trim();
    if (term.length >= 2) {
      ui.recordTimer = window.setTimeout(() => { void recordTerm(term, ui); }, TIMERS.searchRecordPause);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(ui, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const term = input.value.trim();
      if (ui.results.length === 0) { void recordTerm(term, ui); return; }
      openResult(ui, ui.active);
    }
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch(ui);
    }
  });
  dialog.querySelectorAll('[data-search-close]').forEach((b) => b.addEventListener('click', () => closeSearch(ui)));
  dialog.querySelector<HTMLElement>('[data-search-backdrop]')?.addEventListener('click', () => closeSearch(ui));
  return ui;
}

async function runSearch(ui: SearchUi): Promise<void> {
  const term = ui.input.value.trim();
  if (term === '') {
    ui.results = [];
    renderResults(ui, []);
    ui.count.textContent = '';
    ui.count.hidden = true;
    return;
  }
  const res = await api<{ count: number; results: SearchResult[] }>('GET', `${docsBase()}/search?q=${encodeURIComponent(term)}`);
  if (!res.data) return;
  ui.results = res.data.results;
  renderResults(ui, ui.results);
  ui.count.hidden = false;
  ui.count.textContent = res.data.count === 1
    ? `1 result for "${term}"`
    : `${res.data.count} results for "${term}"`;
  announce(ui.count.textContent);
  setActive(ui, ui.results.length > 0 ? 0 : -1);
}

function renderResults(ui: SearchUi, results: SearchResult[]): void {
  ui.list.textContent = '';
  results.forEach((r, idx) => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.id = `result-${idx + 1}`;
    option.dataset.url = r.url;
    option.tabIndex = -1;
    option.setAttribute('aria-selected', 'false');
    const l1 = document.createElement('div');
    l1.textContent = r.title;
    const l2 = document.createElement('div');
    l2.textContent = r.heading !== null ? `${r.group} › ${r.heading}` : r.group;
    l2.className = 'search-result-line2';
    option.append(l1, l2);
    option.addEventListener('click', () => openResult(ui, idx));
    ui.list.append(option);
  });
  ui.active = results.length > 0 ? 0 : -1;
  setActive(ui, ui.active);
  if (results.length === 0 && ui.input.value.trim() !== '') {
    const none = document.createElement('div');
    none.className = 'search-no-results';
    none.textContent = `No results for "${ui.input.value.trim()}".`;
    ui.list.append(none);
  }
}

function setActive(ui: SearchUi, idx: number): void {
  ui.active = idx;
  const options = ui.list.querySelectorAll('[role="option"]');
  options.forEach((o, i) => {
    o.classList.toggle('active', i === idx);
    o.setAttribute('aria-selected', i === idx ? 'true' : 'false');
  });
  if (idx >= 0) {
    ui.input.setAttribute('aria-activedescendant', `result-${idx + 1}`);
  } else {
    ui.input.removeAttribute('aria-activedescendant');
  }
}

function moveActive(ui: SearchUi, delta: number): void {
  if (ui.results.length === 0) return;
  const next = Math.min(ui.results.length - 1, Math.max(0, ui.active + delta));
  setActive(ui, next);
}

function openResult(ui: SearchUi, idx: number): void {
  const r = ui.results[idx];
  if (!r) return;
  const term = ui.input.value.trim();
  void recordTerm(term, ui);
  window.location.href = r.url;
}

async function recordTerm(term: string, ui: SearchUi): Promise<void> {
  if (ui.recordTimer) { window.clearTimeout(ui.recordTimer); ui.recordTimer = undefined; }
  if (term.trim().length < 2) return;
  await api('POST', `${docsBase()}/search-terms`, { term });
}

function openSearch(opener: HTMLElement | null, query?: string): void {
  const ui = ensureSearchUi(opener);
  ui.dialog.hidden = false;
  ui.dialog.classList.add('open');
  if (query !== undefined) ui.input.value = query;
  window.setTimeout(() => {
    ui.input.focus();
    ui.input.select();
  }, 0);
  if (query !== undefined) void runSearch(ui);
}

function closeSearch(ui: SearchUi): void {
  ui.dialog.hidden = true;
  ui.dialog.classList.remove('open');
  ui.opener?.focus();
}

document.addEventListener('keydown', (e) => {
  const isCtrlK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
  if (isCtrlK) {
    e.preventDefault();
    openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    return;
  }
  if (e.key === '/' && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
    e.preventDefault();
    openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
});

qsa<HTMLButtonElement>('[data-search-button]').forEach((b) => {
  b.addEventListener('click', () => openSearch(b));
});

// ---------- Not-found search box ----------
const nfSearch = document.querySelector<HTMLInputElement>('[data-notfound-search]');
if (nfSearch) {
  nfSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      openSearch(nfSearch, nfSearch.value);
    }
  });
}

// ---------- Tabs and code groups ----------
function initTabs(tablist: HTMLElement): void {
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const select = (idx: number, focus = true) => {
    tabs.forEach((t, i) => {
      const selected = i === idx;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = t.getAttribute('aria-controls');
      const panelEl = panel ? document.getElementById(panel) : null;
      if (panelEl) panelEl.hidden = !selected;
      if (selected && focus) t.focus();
    });
  };
  tablist.addEventListener('keydown', (e) => {
    const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (current + dir + tabs.length) % tabs.length;
      select(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      select(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      select(tabs.length - 1);
    }
  });
  tablist.addEventListener('click', (e) => {
    const target = e.target instanceof HTMLElement ? e.target.closest('[role="tab"]') : null;
    if (!target) return;
    const idx = tabs.indexOf(target as HTMLButtonElement);
    select(idx, false);
    if (tablist.getAttribute('aria-label') === 'Code examples') {
      rememberCodeChoice(target as HTMLButtonElement);
    }
  });
}

qsa<HTMLElement>('[role="tablist"]').forEach(initTabs);

// ---------- Code group memory ----------
const CODE_KEY = 'galley-code-choice';
function rememberCodeChoice(tab: HTMLButtonElement): void {
  localStorage.setItem(CODE_KEY, tab.dataset.title ?? '');
  document.querySelectorAll<HTMLElement>('[data-component="code-group"]').forEach((group) => {
    const tabs = Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]'));
    const match = tabs.find((t) => t.dataset.title === tab.dataset.title);
    if (!match) return;
    const idx = tabs.indexOf(match);
    tabs.forEach((t, i) => {
      const selected = i === idx;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = t.getAttribute('aria-controls');
      const panelEl = panel ? document.getElementById(panel) : null;
      if (panelEl) panelEl.hidden = !selected;
    });
  });
}

(function restoreCodeChoices(): void {
  const remembered = localStorage.getItem(CODE_KEY);
  if (!remembered) return;
  document.querySelectorAll<HTMLElement>('[data-component="code-group"]').forEach((group) => {
    const tabs = Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]'));
    const match = tabs.find((t) => t.dataset.title === remembered);
    if (!match) return;
    const idx = tabs.indexOf(match);
    tabs.forEach((t, i) => {
      const selected = i === idx;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = t.getAttribute('aria-controls');
      const panelEl = panel ? document.getElementById(panel) : null;
      if (panelEl) panelEl.hidden = !selected;
    });
  });
})();

// ---------- Copy buttons ----------
qsa<HTMLButtonElement>('[data-component="code-group"] .copy-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panel = btn.closest('[role="tabpanel"]');
    const code = panel?.querySelector('code')?.textContent ?? '';
    void navigator.clipboard.writeText(code).then(() => announce('Copied')).catch(() => announce('Copied'));
  });
});

// ---------- Accordions ----------
qsa<HTMLButtonElement>('.accordion-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const regionId = btn.getAttribute('aria-controls');
    const region = regionId ? document.getElementById(regionId) : null;
    if (!region) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (prefersReducedMotion()) {
      btn.setAttribute('aria-expanded', String(!expanded));
      region.hidden = expanded;
      region.dataset.motion = expanded ? 'closed' : 'open';
    } else {
      if (expanded) {
        region.dataset.motion = 'closing';
        window.setTimeout(() => {
          region.hidden = true;
          region.dataset.motion = 'closed';
        }, TIMERS.accordion);
      } else {
        region.hidden = false;
        region.dataset.motion = 'opening';
        window.setTimeout(() => { region.dataset.motion = 'open'; }, TIMERS.accordion);
      }
      btn.setAttribute('aria-expanded', String(!expanded));
    }
  });
});

// ---------- Version switcher ----------
const versionButton = document.querySelector<HTMLButtonElement>('[data-version-button]');
if (versionButton) {
  const listbox = document.querySelector<HTMLElement>('[data-version-listbox]');
  if (listbox) {
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Versions');
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[data-version-option]'));
    options.forEach((o) => {
      o.setAttribute('role', 'option');
      o.tabIndex = -1;
    });
    const close = () => {
      listbox.hidden = true;
      versionButton.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      listbox.hidden = false;
      versionButton.setAttribute('aria-expanded', 'true');
      const current = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
      (options[Math.max(0, current)] ?? options[0])?.focus();
    };
    versionButton.addEventListener('click', () => {
      if (listbox.hidden) open();
      else close();
    });
    listbox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); versionButton.focus(); return; }
      const focused = options.findIndex((o) => o === document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (options[Math.min(options.length - 1, focused + 1)] ?? options[0])?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (options[Math.max(0, focused - 1)] ?? options[0])?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const target = options[focused] as HTMLElement | undefined;
        if (target) window.location.href = target.dataset.versionUrl ?? '';
      }
    });
    options.forEach((o) => o.addEventListener('click', () => {
      window.location.href = o.dataset.versionUrl ?? '';
    }));
    document.addEventListener('click', (e) => {
      if (listbox.hidden) return;
      if (e.target instanceof Node && !listbox.contains(e.target) && e.target !== versionButton) close();
    });
  }
}

// ---------- Ratings ----------
qsa<HTMLButtonElement>('[data-rating]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.closest<HTMLElement>('[data-rating-group]');
    const pageId = group?.dataset.pageId ?? '';
    const value = btn.dataset.rating === 'yes' ? 'yes' : 'no';
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    const next = pressed ? null : value;
    void api<{ pageId: string; vote: string | null }>('PUT', `/docs/${siteSlug()}/ratings/${pageId}`, { vote: next }).then((res) => {
      if (!res.data) return;
      group?.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach((b) => {
        const isThis = b === btn;
        b.setAttribute('aria-pressed', String(isThis && !pressed));
      });
      announce(pressed ? 'Feedback removed.' : 'Thanks for your feedback.');
    });
  });
});

// ---------- Try it ----------
const tryIt = document.querySelector<HTMLElement>('[data-try-it]');
if (tryIt) {
  const form = tryIt.querySelector<HTMLFormElement>('[data-try-it-form]');
  if (form) {
    const paramFields = Array.from(form.querySelectorAll<HTMLInputElement>('[data-param]'));
    const bodyField = form.querySelector<HTMLTextAreaElement>('[data-body]');
    const codeSelect = form.querySelector<HTMLSelectElement>('[data-code]');
    const statusLine = form.querySelector<HTMLElement>('[data-status-line]');
    const bodyOut = form.querySelector<HTMLElement>('[data-response-body]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let firstInvalid: HTMLElement | null = null;
      paramFields.forEach((f) => {
        const msg = document.getElementById(`${f.id}-error`);
        if (f.required && f.value.trim() === '') {
          const text = `${f.dataset.paramName} is required.`;
          f.setAttribute('aria-invalid', 'true');
          if (!msg) {
            const m = document.createElement('div');
            m.id = `${f.id}-error`;
            m.className = 'field-error';
            m.textContent = text;
            f.after(m);
          }
          if (!firstInvalid) firstInvalid = f;
        } else {
          f.removeAttribute('aria-invalid');
          msg?.remove();
        }
      });
      if (bodyField) {
        const msg = document.getElementById(`${bodyField.id}-error`);
        if (bodyField.value.trim() !== '' && !isValidJson(bodyField.value)) {
          bodyField.setAttribute('aria-invalid', 'true');
          if (!msg) {
            const m = document.createElement('div');
            m.id = `${bodyField.id}-error`;
            m.className = 'field-error';
            m.textContent = 'Request body must be valid JSON.';
            bodyField.after(m);
          }
          if (!firstInvalid) firstInvalid = bodyField;
        } else {
          bodyField.removeAttribute('aria-invalid');
          msg?.remove();
        }
      }
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }
      const parameters: Record<string, string> = {};
      paramFields.forEach((f) => { parameters[f.dataset.param ?? ''] = f.value; });
      const payload: { code: string; parameters: Record<string, string>; body?: string } = {
        code: codeSelect?.value ?? '200',
        parameters,
      };
      if (bodyField) payload.body = bodyField.value;
      const operationId = tryIt.dataset.operationId ?? '';
      void api<unknown>('POST', `/api/mock/${siteSlug()}/${versionSlug()}/${operationId}`, payload).then((res) => {
        const reason: Record<string, string> = {
          '200': 'OK', '201': 'Created', '400': 'Bad Request', '404': 'Not Found', '422': 'Unprocessable Content',
        };
        const text = `${res.status} ${reason[String(res.status)] ?? ''}`;
        if (statusLine) statusLine.textContent = text;
        if (bodyOut) bodyOut.textContent = res.data !== null ? JSON.stringify(res.data, null, 2) : '';
        announce(text);
      });
    });
  }
}

function isValidJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

// ---------- Update banner ----------
(function subscribeToPublish(): void {
  const slug = siteSlug();
  if (!slug) return;
  const pageId = document.body.dataset.pageId;
  if (!pageId) return;
  const es = new EventSource(`/docs/${slug}/events`);
  es.addEventListener('published', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { changedPageIds: string[] };
      if (!data.changedPageIds.includes(pageId)) return;
    } catch { return; }
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'This page was updated.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => window.location.reload());
    banner.append(text, reload);
    const existing = document.querySelector('.update-banner');
    existing?.remove();
    document.body.prepend(banner);
    announce('This page was updated.');
  });
})();
