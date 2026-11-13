// Company search and the company page with its reading column and specimen tile.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, toast } from '../feedback.js';
import { combobox } from '../controls.js';
import { live, onReload } from '../live.js';
import { tileFigure } from '../glassware.js';
import { countUp, MOTION, prefersReduced, runMotion } from '../motion.js';
import { CITIES, monthYear, rangeText, reviewCountText, rupees } from '../format.js';
import type { Company, CompanyHit, PayRow, Review } from '../types.js';
import type { PageContext } from '../app.js';

export function companiesPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'full-width' });
  void buildCompanies(main, ctx);
  return main;
}

async function buildCompanies(main: HTMLElement, ctx: PageContext): Promise<void> {
  const q = ctx.query.get('q') ?? '';
  const city = ctx.query.get('city') ?? '';

  const search = h('input', { type: 'search', id: 'company-search', role: 'searchbox', 'aria-label': 'Search companies', value: q }) as HTMLInputElement;
  const results = h('ul', { role: 'list', 'aria-label': 'Company results', class: 'results' });

  const cityChips = h('div', { role: 'group', 'aria-label': 'City' });
  for (const cityEntry of CITIES) {
    const chip = h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': city === cityEntry.id ? 'true' : 'false',
    }, cityEntry.name);
    chip.addEventListener('click', () => {
      const params = new URLSearchParams(window.location.search);
      const next = city === cityEntry.id ? '' : cityEntry.id;
      if (next) params.set('city', next);
      else params.delete('city');
      if (search.value) params.set('q', search.value);
      window.history.replaceState(null, '', `/companies?${params.toString()}`);
      void run();
    });
    cityChips.appendChild(chip);
  }

  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (search.value) params.set('q', search.value);
      else params.delete('q');
      window.history.replaceState(null, '', `/companies?${params.toString()}`);
      void run();
    }, 300);
  });

  async function run(): Promise<void> {
    const params = new URLSearchParams();
    if (search.value) params.set('q', search.value);
    const currentCity = new URLSearchParams(window.location.search).get('city');
    if (currentCity) params.set('city', currentCity);
    const response = await api.get<
      | { total: number; hits: CompanyHit[]; facets: { city: Record<string, number> } }
      | { fallback: string; cities: { city: string; city_name: string; total: number; companies: CompanyHit[] }[] }
    >(`/api/companies/search?${params.toString()}`);
    clear(results);
    if ('fallback' in response) {
      main.prepend(h('div', { class: 'alert-band', role: 'alert' }, 'Search is unavailable right now. Showing all companies by city instead.'));
      const byCity = h('ul', { role: 'list', 'aria-label': 'Companies by city' });
      for (const city of response.cities) {
        byCity.appendChild(h('li', {}, h('h3', {}, `${city.city_name} (${city.total})`)));
        for (const company of city.companies) {
          byCity.appendChild(companyRow(company));
        }
      }
      main.appendChild(byCity);
      return;
    }
    for (const hit of response.hits) {
      results.appendChild(companyRow(hit));
    }
  }

  main.appendChild(search);
  main.appendChild(cityChips);
  main.appendChild(results);
  await run();
  void ctx;
}

function companyRow(hit: CompanyHit): HTMLElement {
  const item = h('li', { 'data-id': hit.slug });
  item.appendChild(h('a', { href: `/companies/${hit.slug}` }, hit.name));
  item.appendChild(h('p', { class: 'muted' }, `${hit.city_name}${hit.verified ? ' · Verified employer' : ''}`));
  item.appendChild(
    h('p', { class: 'figures' }, `${hit.rating === null ? 'No ratings yet' : hit.rating.toFixed(1)} · ${reviewCountText(hit.review_count)}`),
  );
  return item;
}

export function companyPage(ctx: PageContext): HTMLElement {
  const main = h('main', {});
  void buildCompany(main, ctx);
  return main;
}

async function buildCompany(main: HTMLElement, ctx: PageContext): Promise<void> {
  const slug = ctx.params['1'] ?? ctx.params.slug ?? '';
  const isPhone = window.matchMedia('(max-width: 639px)').matches;
  const initialTab = (ctx.query.get('tab') ?? 'reviews') as 'reviews' | 'pay' | 'interviews' | 'jobs';

  const field = h('div', { class: 'field' });
  const reading = h('div', { class: 'reading-column' });
  main.appendChild(h('div', { class: 'split' }, reading, field));

  let company = await api.get<Company>(`/api/companies/${slug}`).catch(() => null);
  if (!company) {
    clear(main);
    main.appendChild(h('h1', {}, 'Page not found'));
    main.appendChild(h('p', {}, 'It may have been removed, or the link is wrong.'));
    main.appendChild(h('p', {}, h('a', { href: '/jobs' }, 'Search lab jobs')));
    return;
  }

  const tileHost = h('div', { class: 'tile-host' });
  field.appendChild(tileHost);

  function renderTile(bandKey: string | null): void {
    clear(tileHost);
    if (bandKey === null) {
      const caption = `${company!.name}, ${company!.city_name}. ${reviewCountText(company!.rating.review_count)}`;
      tileHost.appendChild(tileFigure(company!.name, caption, company!.slug));
      return;
    }
    const row = company!.pay_rows.find(
      (item) => `${item.role_family}:${item.city}` === bandKey,
    );
    if (!row) {
      tileHost.appendChild(tileFigure(company!.name, `${company!.city_name}. ${reviewCountText(company!.rating.review_count)}`, company!.slug));
      return;
    }
    const figure = h('figure', { class: 'tile-figure' });
    const tile = h('div', {
      class: 'tile',
      'data-band': bandKey,
      ...motionAttrsCrossfade(),
    });
    if (row.band === null) {
      tile.appendChild(h('div', { class: 'hatching', 'data-motion': 'band-unhatch', 'data-motion-ms': '320', 'data-state': 'covered' }));
      tile.appendChild(h('p', { class: 'tile-text' }, `${row.report_count} of ${row.threshold} reports. The range opens at ${row.threshold}.`));
      if (company!.viewer_unlocked === false && row.report_count >= row.threshold) {
        clear(tile);
        tile.appendChild(h('div', { class: 'hatching', 'data-motion': 'band-unhatch', 'data-motion-ms': '320', 'data-state': 'covered' }));
        tile.appendChild(h('p', { class: 'tile-text' }, 'Share one post to see this range.'));
      }
    } else if (company!.viewer_unlocked === false) {
      tile.appendChild(h('div', { class: 'hatching', 'data-motion': 'band-unhatch', 'data-motion-ms': '320', 'data-state': 'covered' }));
      tile.appendChild(h('p', { class: 'tile-text' }, 'Share one post to see this range.'));
    } else {
      const low = h('span', { class: 'figure-low' }, rupees(row.band.low));
      const median = h('span', { class: 'figure-median' }, rupees(row.band.median));
      const high = h('span', { class: 'figure-high' }, rupees(row.band.high));
      const figures = h('div', { class: 'band-figures' }, low, median, high);
      const tick = h('div', { class: 'median-tick', 'data-part': 'median-tick' });
      tile.appendChild(figures);
      tile.appendChild(h('p', { class: 'tile-text' }, `Median ${rupees(row.band.median)}`));
      tile.appendChild(tick);
    }
    figure.appendChild(tile);
    figure.appendChild(
      h('figcaption', { class: 'tile-caption' }, `${row.role_name}, ${row.city_name}. ${row.report_count} reports`),
    );
    tileHost.appendChild(figure);
  }

  function motionAttrsCrossfade(): Record<string, string> {
    return {
      'data-motion': 'band-crossfade',
      'data-motion-ms': prefersReduced() ? '0' : '420',
      'data-state': 'running',
    };
  }

  // The reading column.
  const heading = h('h1', {}, company.name);
  const verified = company.verified ? h('p', { class: 'muted' }, 'Verified employer') : null;
  const ratingFigure = h('p', { class: 'rating-figure figures' }, company.rating.overall === null ? 'No ratings yet' : company.rating.overall.toFixed(1));
  const ratingCount = h('p', { class: 'muted' }, reviewCountText(company.rating.review_count));
  const subRatings = h('p', { class: 'muted figures' }, `Work-life ${company.rating.work_life?.toFixed(1) ?? '—'} · Pay ${company.rating.pay?.toFixed(1) ?? '—'} · Management ${company.rating.management?.toFixed(1) ?? '—'}`);

  const reviewsList = h('ul', { role: 'list', 'aria-label': 'Reviews' });
  const payTable = h('table', {}, h('caption', { class: 'visually-hidden' }, 'Pay by role'));
  const notesList = h('ul', { role: 'list', 'aria-label': 'Interview notes' });
  const jobsList = h('ul', { role: 'list', 'aria-label': 'Open jobs' });

  const reviewsSection = h('section', { id: 'reviews', 'aria-labelledby': 'reviews-heading' },
    h('h2', { id: 'reviews-heading' }, 'Reviews'), reviewsList);
  const paySection = h('section', { id: 'pay', 'aria-labelledby': 'pay-heading' },
    h('h2', { id: 'pay-heading' }, 'Pay'), payTable);
  const notesSection = h('section', { id: 'interviews', 'aria-labelledby': 'interviews-heading' },
    h('h2', { id: 'interviews-heading' }, 'Interview notes'), notesList);
  const jobsSection = h('section', { id: 'jobs', 'aria-labelledby': 'jobs-heading' },
    h('h2', { id: 'jobs-heading' }, 'Open jobs'), jobsList);

  function renderContent(): void {
    ratingFigure.textContent = company!.rating.overall === null ? 'No ratings yet' : company!.rating.overall.toFixed(1);
    ratingCount.textContent = reviewCountText(company!.rating.review_count);
    subRatings.textContent = `Work-life ${company!.rating.work_life?.toFixed(1) ?? '—'} · Pay ${company!.rating.pay?.toFixed(1) ?? '—'} · Management ${company!.rating.management?.toFixed(1) ?? '—'}`;
    clear(reviewsList);
    for (const review of company!.reviews) {
      reviewsList.appendChild(reviewItem(review));
    }
    if (company!.reviews.length === 0) {
      reviewsList.appendChild(h('li', { class: 'muted' }, 'No reviews yet.'));
    }
    clear(payTable);
    payTable.appendChild(h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Role'), h('th', { scope: 'col' }, 'City'),
      h('th', { scope: 'col' }, 'Reports'), h('th', { scope: 'col' }, 'Low'),
      h('th', { scope: 'col' }, 'Median'), h('th', { scope: 'col' }, 'High'))));
    const tbody = h('tbody', {});
    for (const row of company!.pay_rows) {
      const rowEl = payRowItem(row, company!.viewer_unlocked);
      tbody.appendChild(rowEl);
    }
    payTable.appendChild(tbody);
    clear(notesList);
    for (const note of company!.interview_notes) {
      notesList.appendChild(noteItem(note));
    }
    if (company!.interview_notes.length === 0) {
      notesList.appendChild(h('li', { class: 'muted' }, 'No interview notes yet.'));
    }
    clear(jobsList);
    for (const job of company!.jobs) {
      const item = h('li', { 'data-id': job.id });
      item.appendChild(h('a', { href: `/jobs/${job.id}` }, job.title));
      item.appendChild(h('p', { class: 'muted' }, `${job.city_name} · ${job.remote}`));
      jobsList.appendChild(item);
    }
    if (company!.jobs.length === 0) {
      jobsList.appendChild(h('li', { class: 'muted' }, 'No open jobs right now.'));
    }
  }

  function payRowItem(row: PayRow, unlocked: boolean): HTMLElement {
    const tr = h('tr', { 'data-id': `${row.role_family}:${row.city}`, 'data-band': `${row.role_family}:${row.city}` });
    tr.appendChild(h('th', { scope: 'row' }, row.role_name));
    tr.appendChild(h('td', {}, row.city_name));
    const reportsCell = h('td', { class: 'figures' },
      row.report_count < row.threshold
        ? `${row.report_count} of ${row.threshold} reports. The range opens at ${row.threshold}.`
        : `${row.report_count} reports`);
    tr.appendChild(reportsCell);
    const cells = [row.band?.low ?? null, row.band?.median ?? null, row.band?.high ?? null];
    for (const value of cells) {
      tr.appendChild(h('td', { class: 'figures' }, value === null ? '—' : rupees(value)));
    }
    void unlocked;
    return tr;
  }

  function reviewItem(review: Review): HTMLElement {
    const article = h('article', { 'data-id': review.id, class: 'review' });
    article.appendChild(h('h3', {}, review.title));
    article.appendChild(
      h('p', { class: 'muted' }, `${review.author_label} · ${monthYear(review.posted_month)} · ${review.overall.toFixed(1)}`),
    );
    article.appendChild(h('p', {}, review.pros));
    article.appendChild(h('p', {}, review.cons));
    if (review.reply) {
      const reply = h('div', { role: 'region', 'aria-label': `Response from ${review.reply.company_name}`, class: 'employer-reply' },
        h('p', {}, `${review.reply.company_name} replied in ${monthYear(review.reply.posted_month)}`),
        h('p', {}, review.reply.body));
      article.appendChild(reply);
    }
    return article;
  }

  function noteItem(note: Company['interview_notes'][number]): HTMLElement {
    const item = h('li', { 'data-id': note.id });
    item.appendChild(h('p', { class: 'muted' }, `${note.role_name} · ${monthYear(note.posted_month)}`));
    item.appendChild(h('p', { class: 'note-text' }, note.text));
    return item;
  }

  // The locked panel.
  function maybeLockedPanel(): HTMLElement | null {
    if (company!.viewer_unlocked) return null;
    return h('div', { role: 'region', 'aria-label': 'Contribute once to unlock', class: 'unlocked-panel' },
      h('p', {}, 'Share one review, pay report or interview note to unlock full pay and review detail.'),
      h('p', {}, h('a', { href: '/contribute' }, 'Share something')));
  }

  renderContent();
  renderTile(null);

  // Employer reply controls for verified teams.
  if (ctx.me && (ctx.me.role === 'employer_admin' || ctx.me.role === 'recruiter') && ctx.me.company_slug === company.slug && company.verified) {
    company.reviews
      .filter((review) => review.reply === null)
      .forEach((review) => {
        const button = h('button', { class: 'text-button', type: 'button' }, `Reply to ${review.title}`);
        button.addEventListener('click', () => {
          const input = h('textarea', { rows: '3', 'aria-label': 'Your public reply' }) as HTMLTextAreaElement;
          const post = h('button', { class: 'solid-button', type: 'button' }, 'Post reply');
          const host = h('div', {}, input, post);
          articleHost(review).appendChild(host);
          post.addEventListener('click', async () => {
            try {
              await api.post(`/api/employer/reviews/${review.id}/reply`, { body: input.value });
              toast('Reply posted.');
              announce('Reply posted.');
              host.remove();
              await reloadCompany();
            } catch (err) {
              alertBand(apiErrorMessage(err));
            }
          });
        });
        articleHost(review).appendChild(button);
      });
  }

  function articleHost(review: Review): HTMLElement {
    const existing = reviewsList.querySelector<HTMLElement>(`[data-id="${review.id}"]`);
    return existing ?? reviewsList;
  }

  async function reloadCompany(): Promise<void> {
    company = await api.get<Company>(`/api/companies/${slug}`);
    renderContent();
    renderTile(currentBand);
  }

  // Sections in the reading column; on a phone they become tabs.
  let currentBand: string | null = null;
  reading.appendChild(heading);
  if (verified) reading.appendChild(verified);
  reading.appendChild(ratingFigure);
  reading.appendChild(ratingCount);
  reading.appendChild(subRatings);

  const tabsOrder = ['reviews', 'pay', 'interviews', 'jobs'] as const;
  const tabPanels: Record<string, HTMLElement> = {
    reviews: reviewsSection,
    pay: paySection,
    interviews: notesSection,
    jobs: jobsSection,
  };

  if (isPhone) {
    const tabList = h('div', { role: 'tablist', 'aria-label': 'Company sections' });
    let active = tabsOrder.includes(initialTab) ? initialTab : 'reviews';
    const panels = h('div', {});
    function selectTab(next: typeof tabsOrder[number], push = true): void {
      active = next;
      Array.from(tabList.children).forEach((child, index) => {
        const tab = child as HTMLElement;
        const selected = tabsOrder[index] === next;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
      });
      clear(panels);
      panels.appendChild(h('div', { role: 'tabpanel', id: `panel-${next}` }, tabPanels[next]));
      if (push) {
        window.history.replaceState(null, '', `/companies/${slug}?tab=${next}`);
      }
    }
    for (const tab of tabsOrder) {
      const label = tab === 'interviews' ? 'Interviews' : tab === 'pay' ? 'Pay' : tab === 'jobs' ? 'Jobs' : 'Reviews';
      const button = h('button', {
        role: 'tab',
        id: `tab-${tab}`,
        type: 'button',
        'aria-controls': `panel-${tab}`,
        class: 'chip',
      }, label);
      button.addEventListener('click', () => selectTab(tab));
      button.addEventListener('keydown', (event) => {
        const index = tabsOrder.indexOf(tab);
        if (event.key === 'ArrowRight' && index < tabsOrder.length - 1) {
          event.preventDefault();
          selectTab(tabsOrder[index + 1]);
          (tabList.children[index + 1] as HTMLElement).focus();
        } else if (event.key === 'ArrowLeft' && index > 0) {
          event.preventDefault();
          selectTab(tabsOrder[index - 1]);
          (tabList.children[index - 1] as HTMLElement).focus();
        }
      });
      tabList.appendChild(button);
    }
    let swipeStart = 0;
    panels.addEventListener('touchstart', (event) => {
      swipeStart = event.touches[0].clientX;
    });
    panels.addEventListener('touchend', (event) => {
      const delta = event.changedTouches[0].clientX - swipeStart;
      const index = tabsOrder.indexOf(active);
      if (delta <= -60 && index < tabsOrder.length - 1) selectTab(tabsOrder[index + 1]);
      else if (delta >= 60 && index > 0) selectTab(tabsOrder[index - 1]);
    });
    reading.appendChild(tabList);
    reading.appendChild(panels);
    selectTab(active, false);
  } else {
    reading.appendChild(reviewsSection);
    reading.appendChild(paySection);
    reading.appendChild(notesSection);
    reading.appendChild(jobsSection);
    const target = initialTab !== 'reviews' ? document.getElementById(initialTab) : null;
    if (target) target.scrollIntoView();
  }

  const locked = maybeLockedPanel();
  if (locked) reading.appendChild(locked);

  // The tile follows the pay row crossing the window's middle.
  reading.addEventListener('scroll', () => {
    const middle = reading.clientHeight / 2;
    let found: string | null = null;
    for (const row of company!.pay_rows) {
      const element = payTable.querySelector<HTMLElement>(`tr[data-id="${row.role_family}:${row.city}"]`);
      if (!element) continue;
      const top = element.offsetTop - reading.scrollTop;
      const bottom = top + element.offsetHeight;
      if (top <= middle && bottom >= middle) {
        found = `${row.role_family}:${row.city}`;
        break;
      }
    }
    if (found !== currentBand) {
      currentBand = found;
      renderTile(found);
      const tile = tileHost.querySelector('.tile');
      if (tile) runMotion(tile as HTMLElement, MOTION.bandCrossfade);
    }
  });

  // Live updates.
  live.subscribe((event) => {
    if (event.type === 'company.changed' && event.data.slug === slug) {
      company = event.data.company as Company;
      renderContent();
      renderTile(currentBand);
    }
    if (event.type === 'member.unlocked') {
      void reloadCompany();
      announce('Full pay and review detail is now unlocked.');
    }
  });
  onReload(() => void reloadCompany());

  // Watch for a pay row reaching the threshold: the band resolve signature.
  live.subscribe((event) => {
    if (event.type !== 'company.changed' || event.data.slug !== slug) return;
    const next = event.data.company as Company;
    const previousRows = new Map(company!.pay_rows.map((row) => [`${row.role_family}:${row.city}`, row]));
    for (const row of next.pay_rows) {
      const key = `${row.role_family}:${row.city}`;
      const before = previousRows.get(key);
      if (before && before.band === null && row.band !== null) {
        // The range just resolved.
        announce(`Pay range now shown for ${row.role_name}`);
        const tile = tileHost.querySelector('.tile') as HTMLElement | null;
        if (tile && currentBand === key) {
          const hatching = tile.querySelector('.hatching') as HTMLElement | null;
          if (hatching) {
            runMotion(hatching, MOTION.bandUnhatch);
          }
          const lowEl = h('span', {}, '0');
          countUp(lowEl, row.band.low, MOTION.bandCount.ms, rupees);
          const medianEl = h('span', {}, '0');
          countUp(medianEl, row.band.median, MOTION.bandCount.ms, rupees);
          const highEl = h('span', {}, '0');
          countUp(highEl, row.band.high, MOTION.bandCount.ms, rupees);
          window.setTimeout(() => {
            company = next;
            renderContent();
            renderTile(currentBand);
          }, prefersReduced() ? 0 : MOTION.bandCount.ms);
        }
      }
    }
    company = next;
    renderContent();
    renderTile(currentBand);
  });
}
