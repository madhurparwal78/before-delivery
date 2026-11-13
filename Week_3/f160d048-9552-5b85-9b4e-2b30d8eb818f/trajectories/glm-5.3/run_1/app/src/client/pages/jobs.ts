// Job search, the job page and the apply form.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, openDialog, pendingButton, toast } from '../feedback.js';
import { chip, chipGroup, combobox, moveFocusToNextChip } from '../controls.js';
import { live, onReload } from '../live.js';
import { CITIES, PAY_BANDS, ROLE_FAMILIES, WORK_PATTERNS, applicantLine, bandName, cityName, countLine, rangeText, roleName, workPatternName } from '../format.js';
import type { JobDetail, JobSummary, Me } from '../types.js';
import type { PageContext } from '../app.js';

interface SearchFilters {
  q: string;
  city: string[];
  role: string[];
  remote: string[];
  band: string[];
  page: number;
}

function readFilters(query: URLSearchParams): SearchFilters {
  return {
    q: query.get('q') ?? '',
    city: query.getAll('city'),
    role: query.getAll('role'),
    remote: query.getAll('remote'),
    band: query.getAll('band'),
    page: Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1),
  };
}

function filtersToUrl(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  for (const value of filters.city) params.append('city', value);
  for (const value of filters.role) params.append('role', value);
  for (const value of filters.remote) params.append('remote', value);
  for (const value of filters.band) params.append('band', value);
  if (filters.page > 1) params.set('page', String(filters.page));
  const text = params.toString();
  return text.length > 0 ? `/jobs?${text}` : '/jobs';
}

export function jobsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  const filters = readFilters(ctx.query);
  void buildJobs(main, ctx, filters);
  return main;
}

interface Facets {
  city: Record<string, number>;
  role_family: Record<string, number>;
  remote: Record<string, number>;
  pay_band: Record<string, number>;
}

interface SearchResult {
  total: number;
  page: number;
  page_size: number;
  hits: JobSummary[];
  facets: Facets;
  fallback?: string;
  cities?: { city: string; city_name: string; total: number; jobs: JobSummary[] }[];
}

async function buildJobs(main: HTMLElement, ctx: PageContext, filters: SearchFilters): Promise<void> {
  const isPhone = window.matchMedia('(max-width: 639px)').matches;
  const state = { filters };
  let facets: Facets = { city: {}, role_family: {}, remote: {}, pay_band: {} };
  let total = 0;
  let lastChangeLabel: string | null = null;

  const resultsList = h('ul', { role: 'list', 'aria-label': 'Job results', class: 'results' });
  const countLineEl = h('p', { class: 'count-line figures' });
  const nextLink = h('a', { href: '#', class: 'text-button' }, 'Next page');
  const prevLink = h('a', { href: '#', class: 'text-button' }, 'Previous page');
  const clearButton = h('button', { class: 'text-button', type: 'button' }, 'Clear filters');
  const saveAlert = h('button', { class: 'text-button', type: 'button' }, 'Save alert');

  const runSearch = async () => {
    void undefined;
    const url = new URL(filtersToUrl(state.filters), window.location.origin);
    const response = await api.get<SearchResult>(`/api/jobs/search?${url.searchParams.toString()}`);
    if (response.fallback === 'by_city' && response.cities) {
      countLineEl.textContent = '';
      const outageAlert = h('div', { class: 'alert-band', role: 'alert' }, 'Search is unavailable right now. Showing all jobs by city instead.');
      main.prepend(outageAlert);
      clear(resultsList);
      const byCity = h('ul', { role: 'list', 'aria-label': 'Jobs by city' });
      for (const city of response.cities) {
        byCity.appendChild(h('li', {}, h('h3', {}, `${city.city_name} (${city.total})`)));
        for (const job of city.jobs) {
          byCity.appendChild(jobRow(job));
        }
      }
      main.appendChild(byCity);
      return;
    }
    facets = response.facets;
    total = response.total;
    buildFacets();
    countLineEl.textContent = countLine(response.total);
    clear(resultsList);
    for (const job of response.hits) {
      resultsList.appendChild(jobRow(job));
    }
    announce(lastChangeLabel ? `${lastChangeLabel} ${countLine(response.total)}.` : countLine(response.total));
    lastChangeLabel = null;
    nextLink.style.display = response.page * response.page_size < response.total ? '' : 'none';
    prevLink.style.display = response.page > 1 ? '' : 'none';
  };

  const debouncedSearch = (() => {
    let timer = 0;
    return () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void runSearch(), 300);
    };
  })();

  function toggleFacet(facet: 'city' | 'role' | 'remote' | 'band', id: string, label: string): void {
    const list = state.filters[facet];
    const index = list.indexOf(id);
    if (index >= 0) {
      list.splice(index, 1);
      lastChangeLabel = `Filter removed: ${label}.`;
    } else {
      list.push(id);
      lastChangeLabel = `Filter added: ${label}.`;
    }
    state.filters.page = 1;
    window.history.replaceState(null, '', filtersToUrl(state.filters));
    buildFacets();
    debouncedSearch();
  }

  const facetGroups: { key: 'city' | 'role' | 'remote' | 'band'; label: string; values: { id: string; name: string }[]; facetKey: string }[] = [
    { key: 'city', label: 'City', values: CITIES.map((c) => ({ id: c.id, name: c.name })), facetKey: 'city' },
    { key: 'role', label: 'Role', values: ROLE_FAMILIES.map((r) => ({ id: r.id, name: r.name })), facetKey: 'role_family' },
    { key: 'remote', label: 'Work pattern', values: WORK_PATTERNS.map((w) => ({ id: w.id, name: w.name })), facetKey: 'remote' },
    { key: 'band', label: 'Pay band', values: PAY_BANDS.map((b) => ({ id: b.id, name: b.name })), facetKey: 'pay_band' },
  ];

  const facetHost = h('aside', { class: 'facet-list', 'aria-label': 'Filters' });

  function buildFacets(): void {
    clear(facetHost);
    for (const group of facetGroups) {
      const chips: HTMLButtonElement[] = [];
      for (const value of group.values) {
        const facetMap = facets as unknown as Record<string, Record<string, number>>;
        const count = facetMap[group.facetKey]?.[value.id] ?? 0;
        const item = chip({
          label: value.name,
          pressed: state.filters[group.key].includes(value.id),
          count,
          onToggle: () => toggleFacet(group.key, value.id, value.name),
          onRemove: () => {
            const before = state.filters[group.key].length;
            toggleFacet(group.key, value.id, value.name);
            if (state.filters[group.key].length < before) {
              moveFocusToNextChip(facetHost, item, clearButton);
            }
          },
        });
        chips.push(item);
      }
      facetHost.appendChild(chipGroup(group.label, chips));
    }
    clearButton.addEventListener('click', () => {
      state.filters.city = [];
      state.filters.role = [];
      state.filters.remote = [];
      state.filters.band = [];
      state.filters.page = 1;
      window.history.replaceState(null, '', filtersToUrl(state.filters));
      debouncedSearch();
      buildFacets();
    });
    facetHost.appendChild(clearButton);
    facetHost.appendChild(saveAlert);
  }

  saveAlert.addEventListener('click', async () => {
    try {
      const saved = await api.post<{ id: string; label: string }>('/api/alerts', {
        q: state.filters.q,
        city: state.filters.city,
        role: state.filters.role,
        remote: state.filters.remote,
        band: state.filters.band,
      });
      toast(`Alert saved for ${saved.label}`);
      announce(`Alert saved for ${saved.label}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        ctx.navigate('/sign-in');
        return;
      }
      alertBand(apiErrorMessage(err));
    }
  });

  const titleBox = combobox({
    label: 'Job title',
    value: state.filters.q,
    fetchOptions: async (text) => {
      const result = await api.get<{ options: string[] }>(`/api/jobs/suggest?q=${encodeURIComponent(text)}`);
      return result.options.map((option) => ({ name: option }));
    },
    onSelect: (choice) => {
      state.filters.q = choice.name;
      state.filters.page = 1;
      window.history.replaceState(null, '', filtersToUrl(state.filters));
      debouncedSearch();
    },
    onFreeText: (text) => {
      state.filters.q = text;
      state.filters.page = 1;
      window.history.replaceState(null, '', filtersToUrl(state.filters));
      debouncedSearch();
    },
  });

  buildFacets();

  if (isPhone) {
    const filtersButton = h('button', { class: 'text-button', type: 'button' }, 'Filters');
    filtersButton.addEventListener('click', () => {
      openDialog('Filters', (dialog) => {
        const sheet = h('div', { class: 'filter-sheet', 'data-motion': 'filter-sheet', 'data-motion-ms': '280', 'data-state': 'open' });
        const clone = facetHost.cloneNode(true) as HTMLElement;
        sheet.appendChild(clone);
        const show = h('button', { class: 'solid-button', type: 'button' }, `Show 1 job`);
        show.addEventListener('click', () => dialog.close());
        sheet.appendChild(show);
        let startY = 0;
        sheet.addEventListener('touchstart', (event) => {
          startY = event.touches[0].clientY;
        });
        sheet.addEventListener('touchend', (event) => {
          const delta = event.changedTouches[0].clientY - startY;
          if (delta >= 80) dialog.close();
        });
        return sheet;
      }, filtersButton);
    });
    main.appendChild(filtersButton);
    main.appendChild(titleBox.root);
  } else {
    main.appendChild(h('div', { class: 'search-layout' }, facetHost, h('div', {}, titleBox.root, countLineEl, resultsList, prevLink, nextLink)));
  }

  if (isPhone) {
    main.appendChild(countLineEl);
    main.appendChild(resultsList);
    main.appendChild(prevLink);
    main.appendChild(nextLink);
  }

  nextLink.addEventListener('click', (event) => {
    event.preventDefault();
    state.filters.page += 1;
    window.history.replaceState(null, '', filtersToUrl(state.filters));
    void runSearch();
  });
  prevLink.addEventListener('click', (event) => {
    event.preventDefault();
    state.filters.page -= 1;
    window.history.replaceState(null, '', filtersToUrl(state.filters));
    void runSearch();
  });

  await runSearch();

  onReload(() => void runSearch());
  live.subscribe((event) => {
    if (event.type === 'alert.matched') {
      void runSearch();
    }
  });
}

function jobRow(job: JobSummary): HTMLElement {
  const item = h('li', { 'data-id': job.id });
  item.appendChild(
    h('a', { href: `/jobs/${job.id}` }, `${job.title} at ${job.company_name}`),
  );
  item.appendChild(h('p', { class: 'muted' }, `${job.city_name} · ${workPatternName(job.remote)}`));
  item.appendChild(h('p', { class: 'figures' }, rangeText(job.pay_low, job.pay_high)));
  return item;
}

export function jobPage(ctx: PageContext): HTMLElement {
  const main = h('main', {});
  void buildJob(main, ctx);
  return main;
}

async function buildJob(main: HTMLElement, ctx: PageContext): Promise<void> {
  const id = ctx.params['1'] ?? ctx.params.id ?? '';
  const job = await api.get<JobDetail>(`/api/jobs/${id}`).catch(() => null);
  if (!job) {
    main.appendChild(h('h1', {}, 'Page not found'));
    main.appendChild(h('p', {}, 'It may have been removed, or the link is wrong.'));
    main.appendChild(h('p', {}, h('a', { href: '/jobs' }, 'Search lab jobs')));
    return;
  }
  main.appendChild(h('h1', {}, job.title));
  main.appendChild(h('p', {}, h('a', { href: `/companies/${job.company_slug}` }, job.company_name)));
  main.appendChild(h('p', {}, `${job.city_name} · ${workPatternName(job.remote)}`));
  main.appendChild(h('p', { class: 'figures' }, rangeText(job.pay_low, job.pay_high)));
  main.appendChild(h('p', {}, job.description));

  const applyButton = h('a', { class: 'solid-button', href: `/jobs/${job.id}/apply` }, 'Apply now');
  const saveButton = h('button', { class: 'text-button', type: 'button', 'aria-pressed': 'false' }, 'Save job');

  if (job.status === 'closed') {
    main.appendChild(h('p', { class: 'muted' }, 'This job is closed.'));
  } else {
    main.appendChild(applyButton);
  }
  main.appendChild(saveButton);

  let saved = false;
  if (ctx.me) {
    const savedJobs = await api.get<{ jobs: JobSummary[] }>('/api/saved-jobs').catch(() => ({ jobs: [] }));
    saved = savedJobs.jobs.some((item) => item.id === job.id);
    updateSaveButton();
  }

  function updateSaveButton(): void {
    saveButton.setAttribute('aria-pressed', saved ? 'true' : 'false');
    saveButton.textContent = saved ? 'Saved' : 'Save job';
    saveButton.setAttribute('data-motion', 'save-toggle');
    saveButton.setAttribute('data-motion-ms', document.documentElement.getAttribute('data-motion-pref') === 'reduced' ? '0' : '200');
    saveButton.setAttribute('data-state', 'done');
  }

  saveButton.addEventListener('click', async () => {
    if (!ctx.me) {
      ctx.navigate('/sign-in');
      return;
    }
    try {
      if (saved) {
        await api.delete(`/api/saved-jobs/${job.id}`);
        saved = false;
        announce(`Removed ${job.title} from saved jobs.`);
      } else {
        await api.put(`/api/saved-jobs/${job.id}`);
        saved = true;
        announce(`Saved ${job.title} at ${job.company_name}.`);
      }
      updateSaveButton();
    } catch (err) {
      alertBand(apiErrorMessage(err));
    }
  });

  // A pinned apply bar on the phone.
  const bar = h('div', { role: 'region', 'aria-label': 'Apply bar', class: 'apply-bar' },
    h('a', { class: 'text-button', href: `/jobs/${job.id}/apply` }, 'Apply now'),
    saveButton,
  );
  main.appendChild(bar);
}

export function applyPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  const id = ctx.params['1'] ?? ctx.params.id ?? '';
  const idempotencyKey = crypto.randomUUID();
  void buildApply(main, ctx, id, idempotencyKey);
  return main;
}

async function buildApply(main: HTMLElement, ctx: PageContext, jobId: string, idempotencyKey: string): Promise<void> {
  const job = await api.get<JobDetail>(`/api/jobs/${jobId}`).catch(() => null);
  if (!job) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return;
  }
  const me = ctx.me as Me | null;
  if (!me) {
    ctx.navigate('/sign-in');
    return;
  }
  main.appendChild(h('h1', {}, `Apply for ${job.title} at ${job.company_name}`));

  const fields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  const errors: Record<string, HTMLElement> = {};
  const names: [string, string, string][] = [
    ['candidate_name', 'Full name', 'text'],
    ['contact_email', 'Contact email', 'email'],
    ['phone', 'Phone (optional)', 'tel'],
  ];
  for (const [name, label, type] of names) {
    const input = h('input', { type, id: name }) as HTMLInputElement;
    fields[name] = input;
    const error = h('p', { id: `error-${name}`, class: 'field-error', hidden: 'hidden' });
    errors[name] = error;
    input.setAttribute('aria-describedby', `error-${name}`);
    main.appendChild(h('div', { class: 'field-row' }, h('label', { for: name }, label), input, error));
  }
  const note = h('textarea', { id: 'cover_note', rows: '4' }) as HTMLTextAreaElement;
  fields.cover_note = note;
  const noteError = h('p', { id: 'error-cover_note', class: 'field-error', hidden: 'hidden' });
  errors.cover_note = noteError;
  main.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'cover_note' }, 'Note to the employer (optional)'), note, noteError));

  const file = h('input', { type: 'file', id: 'resume' }) as HTMLInputElement;
  file.setAttribute('aria-describedby', 'error-resume');
  const fileError = h('p', { id: 'error-resume', class: 'field-error', hidden: 'hidden' });
  errors.resume = fileError;
  main.appendChild(h('div', { class: 'field-row' }, h('label', { for: 'resume' }, 'Resume (PDF, up to 5 MB)'), file, fileError));

  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Send application');
  const caption = h('span', { class: 'pending-caption' });
  const pending = pendingButton(submit, caption);
  const retryHost = h('div', {});

  async function send(): Promise<void> {
    pending.setWorking('Sending your application');
    const form = new FormData();
    form.set('candidate_name', fields.candidate_name.value);
    form.set('contact_email', fields.contact_email.value);
    form.set('phone', fields.phone.value);
    form.set('cover_note', note.value);
    if (file.files && file.files.length > 0) {
      form.set('resume', file.files[0]);
    }
    try {
      const result = await api.form<{ id: string }>(`/api/jobs/${jobId}/applications`, form, {
        'Idempotency-Key': idempotencyKey,
      });
      clear(main);
      const heading = h('h1', { tabindex: '-1' }, 'Application sent');
      main.appendChild(heading);
      heading.focus();
      main.appendChild(h('p', {}, h('a', { href: `/applications/${result.id}` }, 'Your application')));
    } catch (err) {
      pending.clear();
      if (err instanceof ApiFailure) {
        if (err.status === 503) {
          alertBand(err.body.message);
          clear(retryHost);
          const retry = h('button', { class: 'solid-button', type: 'button' }, 'Try again');
          retry.addEventListener('click', () => void send());
          retryHost.appendChild(retry);
          return;
        }
        for (const name of Object.keys(errors)) {
          const message = err.fieldError(name);
          if (message) {
            errors[name].textContent = message;
            errors[name].removeAttribute('hidden');
          } else {
            errors[name].setAttribute('hidden', 'hidden');
          }
        }
        if (!err.body.fields) alertBand(err.body.message);
      }
    }
  }

  submit.addEventListener('click', () => void send());
  main.appendChild(submit);
  main.appendChild(caption);
  main.appendChild(retryHost);
}
