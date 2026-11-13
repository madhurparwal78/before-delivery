import {
  CITIES,
  jobCountLine,
  moneyRange,
  PAY_BANDS,
  ROLE_FAMILIES,
  WORK_PATTERNS,
  workPatternName,
} from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post, put, remove } from '../core/api';
import { el, focus, on, trapFocus } from '../core/dom';
import { navigate, replaceQuery, type Cleanup, type PageContext } from '../core/router';
import { clientConfig, currentUser, pageAlert, showToast, working } from '../core/shell';
import { chipGroup, type ChipGroup } from '../widgets/chips';
import { combobox, SEARCH_DEBOUNCE_MS } from '../widgets/combobox';
import { isPhone } from '../widgets/layout';
import { runMotion } from '../core/motion';

interface JobSummary {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city_name: string;
  city: string;
  role_family: string;
  remote: string;
  pay_low: number;
  pay_high: number;
  pay_band: string;
}

interface SearchOutcome {
  total?: number;
  page?: number;
  page_size?: number;
  hits?: JobSummary[];
  facets?: Record<string, Record<string, number>>;
  fallback?: string;
  cities?: Array<{ city: string; city_name: string; total: number; jobs: JobSummary[] }>;
}

const FACETS = [
  {
    key: 'city',
    param: 'city',
    name: 'City',
    chips: CITIES.map((city) => ({ id: city.id, label: city.name })),
    facet: 'city',
  },
  {
    key: 'role',
    param: 'role',
    name: 'Role',
    chips: ROLE_FAMILIES.map((role) => ({ id: role.id, label: role.name })),
    facet: 'role_family',
  },
  {
    key: 'remote',
    param: 'remote',
    name: 'Work pattern',
    chips: WORK_PATTERNS.map((pattern) => ({ id: pattern.id, label: pattern.name })),
    facet: 'remote',
  },
  {
    key: 'band',
    param: 'band',
    name: 'Pay band',
    chips: PAY_BANDS.map((band) => ({ id: band.id, label: band.name })),
    facet: 'pay_band',
  },
] as const;

function jobListItem(job: JobSummary): HTMLElement {
  return el('li', { 'data-id': job.id, class: 'job-result' }, [
    el('a', { href: `/jobs/${job.id}`, text: `${job.title} at ${job.company_name}` }),
    el('p', {
      class: 'figures',
      text: `${job.city_name} · ${workPatternName(job.remote)} · ${moneyRange(job.pay_low, job.pay_high)}`,
    }),
  ]);
}

export async function renderJobSearch(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const page = el('div', { class: 'working-screen jobs-screen' });
  container.append(page);
  const alert = pageAlert(page);

  const titleBox = combobox({
    name: 'Job title',
    listName: 'Job title suggestions',
    load: async (query) => {
      const suggestions = await get<{ options: string[] }>(`/api/jobs/suggest?q=${encodeURIComponent(query)}`);
      return suggestions.options.map((option) => ({ id: option, label: option }));
    },
    onSelect: () => schedule(null),
    onSubmitText: () => schedule(null),
  });
  titleBox.setText(ctx.query.get('q') ?? '');

  const clearButton = el('button', { type: 'button', class: 'nav-action', text: 'Clear filters' });
  const saveAlert = el('button', { type: 'button', class: 'nav-action', text: 'Save alert' });
  const countLine = el('p', { class: 'count-line' });
  const results = el('ul', { 'aria-label': 'Job results', class: 'plain-list' });
  const pager = el('nav', { class: 'pager' });
  const emptyHost = el('div');
  const fallbackHost = el('div');

  const groups = new Map<string, ChipGroup>();
  let pendingChange: { label: string; added: boolean } | null = null;
  let timer = 0;
  let currentPage = Math.max(1, Number(ctx.query.get('page') ?? '1') || 1);

  const facetHost = el('div', { class: 'facet-list' });
  for (const facet of FACETS) {
    const group = chipGroup({
      name: facet.name,
      chips: facet.chips,
      onToggle: ({ chip, added }) => {
        pendingChange = { label: chip.label, added };
        currentPage = 1;
        schedule(pendingChange);
      },
      clearButton: () => clearButton,
    });
    group.setPressed(ctx.query.getAll(facet.param));
    groups.set(facet.key, group);
    facetHost.append(el('div', { class: 'facet-group' }, [el('h2', { text: facet.name }), group.element]));
  }
  facetHost.append(clearButton, saveAlert);

  const currentQuery = (): URLSearchParams => {
    const query = new URLSearchParams();
    const text = titleBox.text().trim();
    if (text) query.set('q', text);
    for (const facet of FACETS) {
      for (const value of groups.get(facet.key)?.pressed() ?? []) query.append(facet.param, value);
    }
    if (currentPage > 1) query.set('page', String(currentPage));
    return query;
  };

  const run = async (change: { label: string; added: boolean } | null): Promise<void> => {
    const query = currentQuery();
    replaceQuery(query);
    const outcome = await get<SearchOutcome>(`/api/jobs/search?${query.toString()}`);
    fallbackHost.replaceChildren();
    emptyHost.replaceChildren();
    pager.replaceChildren();

    if (outcome.fallback === 'by_city') {
      alert('Search is unavailable right now. Showing all jobs by city instead.');
      const list = el('ul', { 'aria-label': 'Jobs by city', class: 'plain-list' });
      for (const city of outcome.cities ?? []) {
        const inner = el('ul', { class: 'plain-list' });
        for (const job of city.jobs) inner.append(jobListItem(job));
        list.append(el('li', {}, [el('h3', { text: city.city_name }), inner]));
      }
      fallbackHost.append(list);
      results.replaceChildren();
      countLine.textContent = '';
      return;
    }

    alert(null);
    const hits = outcome.hits ?? [];
    results.replaceChildren(...hits.map(jobListItem));
    const line = jobCountLine(outcome.total ?? 0);
    countLine.textContent = line;
    for (const facet of FACETS) groups.get(facet.key)?.setCounts(outcome.facets?.[facet.facet] ?? {});

    if (hits.length === 0) {
      emptyHost.append(el('a', { href: '/jobs', class: 'nav-action', text: 'Show all jobs' }));
    }
    const pageSize = outcome.page_size ?? clientConfig.search_page_size;
    const total = outcome.total ?? 0;
    if (currentPage > 1) {
      const previous = el('a', { href: '#', text: 'Previous page' });
      on(previous, 'click', (event) => {
        event.preventDefault();
        currentPage -= 1;
        void run(null);
      });
      pager.append(previous);
    }
    if (currentPage * pageSize < total) {
      const next = el('a', { href: '#', text: 'Next page' });
      on(next, 'click', (event) => {
        event.preventDefault();
        currentPage += 1;
        void run(null);
      });
      pager.append(next);
    }
    announce(change ? `Filter ${change.added ? 'added' : 'removed'}: ${change.label}. ${line}.` : line);
    sheetCount?.(total);
  };

  function schedule(change: { label: string; added: boolean } | null): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const reported = pendingChange ?? change;
      pendingChange = null;
      void run(reported);
    }, SEARCH_DEBOUNCE_MS);
  }

  on(titleBox.input, 'input', () => {
    currentPage = 1;
    schedule(null);
  });

  on(clearButton, 'click', () => {
    for (const facet of FACETS) groups.get(facet.key)?.setPressed([]);
    currentPage = 1;
    pendingChange = null;
    schedule(null);
  });

  on(saveAlert, 'click', () => {
    const done = working(saveAlert);
    const query = currentQuery();
    void post<{ id: string; label: string }>('/api/alerts', {
      q: query.get('q') ?? '',
      city: query.getAll('city'),
      role: query.getAll('role'),
      remote: query.getAll('remote'),
      band: query.getAll('band'),
    })
      .then((saved) => {
        showToast(`Alert saved for ${saved.label}`);
        announce(`Alert saved for ${saved.label}`);
      })
      .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
      .finally(done);
  });

  let sheetCount: ((total: number) => void) | null = null;
  const resultsColumn = el('div', { class: 'results-column' }, [countLine, results, emptyHost, fallbackHost, pager]);

  if (isPhone()) {
    const filtersButton = el('button', { type: 'button', class: 'nav-action', text: 'Filters' });
    on(filtersButton, 'click', () => openFilterSheet(filtersButton, facetHost, (setter) => (sheetCount = setter)));
    page.append(el('div', { class: 'search-head' }, [titleBox.element, filtersButton]), resultsColumn);
  } else {
    page.append(
      el('div', { class: 'search-head' }, [titleBox.element]),
      el('div', { class: 'jobs-split' }, [facetHost, resultsColumn]),
    );
  }

  await run(null);

  return () => window.clearTimeout(timer);
}

function openFilterSheet(
  opener: HTMLElement,
  facetHost: HTMLElement,
  registerCount: (setter: (total: number) => void) => void,
): void {
  const showButton = el('button', { type: 'button', class: 'solid-button', text: 'Show 0 jobs' });
  const dialog = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filters', class: 'sheet filter-sheet' },
    [facetHost, showButton],
  );
  const backdrop = el('div', { class: 'backdrop bottom' }, [dialog]);
  document.body.append(backdrop);
  runMotion(dialog, 'filter-sheet', 'opening', 'open');
  const release = trapFocus(dialog);
  registerCount((total) => {
    showButton.textContent = total === 1 ? 'Show 1 job' : `Show ${total} jobs`;
  });

  const close = (): void => {
    release();
    runMotion(dialog, 'filter-sheet', 'closing', 'closed', () => {
      backdrop.remove();
      focus(opener);
    });
    if (dialog.getAttribute('data-motion-ms') === '0') {
      backdrop.remove();
      focus(opener);
    }
  };
  on(showButton, 'click', close);
  on(dialog, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  let startY = 0;
  let startedOnEdge = false;
  on(
    dialog,
    'touchstart',
    (event) => {
      const touch = (event as TouchEvent).changedTouches[0];
      startY = touch?.clientY ?? 0;
      startedOnEdge = startY - dialog.getBoundingClientRect().top < 40;
    },
    { passive: true },
  );
  on(
    dialog,
    'touchend',
    (event) => {
      const endY = (event as TouchEvent).changedTouches[0]?.clientY ?? 0;
      if (startedOnEdge && endY - startY >= 80) close();
    },
    { passive: true },
  );

  focus(dialog.querySelector('button'));
}

interface JobDetail extends JobSummary {
  description: string;
  status: 'draft' | 'listed' | 'closed';
}

export async function renderJobPage(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const id = ctx.params['id'] as string;
  const job = await get<JobDetail>(`/api/jobs/${id}`);
  const page = el('div', { class: 'narrow-page job-page' });
  container.append(page);
  const alert = pageAlert(page);

  const saved = new Set<string>();
  if (currentUser()?.role === 'member') {
    const savedJobs = await get<{ jobs: JobSummary[] }>('/api/saved-jobs');
    for (const item of savedJobs.jobs) saved.add(item.id);
  }

  const applyButton = el('button', { type: 'button', class: 'solid-button', text: 'Apply now' });
  on(applyButton, 'click', () => navigate(`/jobs/${id}/apply`));

  const saveButton = el('button', {
    type: 'button',
    class: 'nav-action save-button',
    'aria-label': 'Save job',
    'aria-pressed': saved.has(id) ? 'true' : 'false',
    text: saved.has(id) ? 'Saved' : 'Save job',
  });
  on(saveButton, 'click', () => {
    const next = saveButton.getAttribute('aria-pressed') !== 'true';
    const done = working(saveButton);
    const request = next
      ? put<{ saved: boolean }>(`/api/saved-jobs/${id}`)
      : remove<{ saved: boolean }>(`/api/saved-jobs/${id}`);
    void request
      .then(() => {
        saveButton.setAttribute('aria-pressed', next ? 'true' : 'false');
        saveButton.textContent = next ? 'Saved' : 'Save job';
        runMotion(saveButton, 'save-toggle', 'running', 'done');
        announce(next ? `Saved ${job.title} at ${job.company_name}.` : `Removed ${job.title} from saved jobs.`);
      })
      .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
      .finally(done);
  });

  const actions = el('div', { class: 'job-actions' });
  page.append(
    el('h1', { text: job.title }),
    el('p', {}, [el('a', { href: `/companies/${job.company_slug}`, text: job.company_name })]),
    el('p', {
      class: 'figures',
      text: `${job.city_name} · ${workPatternName(job.remote)} · ${moneyRange(job.pay_low, job.pay_high)}`,
    }),
    actions,
    el('p', { class: 'job-description', text: job.description }),
  );

  if (job.status === 'closed') {
    page.append(el('p', { text: 'This job is closed.' }));
    actions.append(saveButton);
    return () => undefined;
  }

  if (isPhone()) {
    const bar = el('div', { role: 'region', 'aria-label': 'Apply bar', class: 'apply-bar' }, [applyButton, saveButton]);
    container.append(bar);
    return () => bar.remove();
  }
  actions.append(applyButton, saveButton);
  return () => undefined;
}
