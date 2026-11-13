import {
  atThresholdReports,
  belowThresholdReports,
  money,
  monthYear,
  moneyRange,
  OUTCOME_LABELS,
  reviewCountLine,
  reviewCountText,
  workPatternName,
  type Outcome,
} from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post } from '../core/api';
import { el, focus, on } from '../core/dom';
import { onLive } from '../core/live';
import { replaceQuery, type Cleanup, type PageContext } from '../core/router';
import { currentUser, pageAlert, toastAndAnnounce, working } from '../core/shell';
import { isPhone, splitStage } from '../widgets/layout';
import { specimenTile, type PayRow } from '../widgets/tile';

interface Review {
  id: string;
  title: string;
  overall: number;
  work_life: number;
  pay: number;
  management: number;
  pros: string;
  cons: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
  reply: { company_name: string; body: string; posted_month: string } | null;
}

interface InterviewNote {
  id: string;
  role_name: string;
  difficulty: number;
  outcome: Outcome;
  text: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
}

interface JobSummary {
  id: string;
  title: string;
  company_name: string;
  city_name: string;
  remote: string;
  pay_low: number;
  pay_high: number;
}

export interface Company {
  slug: string;
  name: string;
  city_name: string;
  size: string;
  verified: boolean;
  mark_url: string | null;
  viewer_unlocked: boolean;
  rating: {
    overall: number | null;
    work_life: number | null;
    pay: number | null;
    management: number | null;
    review_count: number;
  };
  reviews: Review[];
  pay_rows: PayRow[];
  interview_notes: InterviewNote[];
  jobs: JobSummary[];
}

const TABS = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'pay', label: 'Pay' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'jobs', label: 'Jobs' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function ratingFigure(company: Company): HTMLElement {
  const overall = company.rating.overall;
  const headline = el('p', { class: 'rating-figure figures' }, [
    overall === null ? document.createTextNode('No ratings yet') : document.createTextNode(overall.toFixed(1)),
  ]);
  const sub = el('ul', { class: 'sub-ratings' });
  const parts: Array<[string, number | null]> = [
    ['Work-life balance', company.rating.work_life],
    ['Pay', company.rating.pay],
    ['Management', company.rating.management],
    ['Overall', company.rating.overall],
  ];
  for (const [label, value] of parts) {
    sub.append(
      el('li', { text: `${label} ${value === null ? 'No ratings yet' : value.toFixed(1)}`, class: 'figures' }),
    );
  }
  return el('div', { class: 'rating-block' }, [
    el('div', { class: 'rating-head' }, [
      headline,
      el('span', { class: 'review-count', text: reviewCountText(company.rating.review_count) }),
    ]),
    sub,
  ]);
}

function reviewArticle(review: Review, replyHost: (review: Review) => Node | null): HTMLElement {
  const article = el('article', { 'data-id': review.id, class: 'review' }, [
    el('h3', { text: review.title }),
    el('p', {
      class: 'review-meta figures',
      text: `Overall ${review.overall.toFixed(1)} · Work-life ${review.work_life.toFixed(1)} · Pay ${review.pay.toFixed(1)} · Management ${review.management.toFixed(1)}`,
    }),
    el('p', { class: 'review-byline', text: `${review.author_label} · ${monthYear(review.posted_month)}` }),
    el('blockquote', { class: 'review-body' }, [
      el('p', { text: `Pros: ${review.pros}${review.truncated ? '…' : ''}` }),
      el('p', { text: `Cons: ${review.cons}${review.truncated ? '…' : ''}` }),
    ]),
  ]);
  if (review.reply) {
    article.append(
      el(
        'div',
        { role: 'region', 'aria-label': `Response from ${review.reply.company_name}`, class: 'employer-reply' },
        [
          el('p', {
            class: 'reply-meta',
            text: `${review.reply.company_name} replied in ${monthYear(review.reply.posted_month)}`,
          }),
          el('p', { text: review.reply.body }),
        ],
      ),
    );
  }
  const host = replyHost(review);
  if (host) article.append(host);
  return article;
}

function payTable(company: Company): HTMLElement {
  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { scope: 'col', text: 'Role' }),
      el('th', { scope: 'col', text: 'City' }),
      el('th', { scope: 'col', text: 'Reports' }),
      el('th', { scope: 'col', text: 'Low' }),
      el('th', { scope: 'col', text: 'Median' }),
      el('th', { scope: 'col', text: 'High' }),
    ]),
  ]);
  const body = el('tbody');
  for (const row of company.pay_rows) body.append(payRowElement(row));
  return el('table', { 'aria-label': 'Pay by role', class: 'pay-table' }, [head, body]);
}

function payRowElement(row: PayRow): HTMLElement {
  /** The count is public once the threshold is met, even while the band stays shut. */
  const atThreshold = row.report_count >= row.threshold;
  const cells: Node[] = [
    el('td', { text: row.role_name }),
    el('td', { text: row.city_name }),
    el('td', {
      class: 'reports-cell',
      text: atThreshold ? atThresholdReports(row.report_count) : belowThresholdReports(row.report_count, row.threshold),
    }),
  ];
  if (row.band) {
    cells.push(
      el('td', { class: 'figures', 'data-part': 'low', text: money(row.band.low) }),
      el('td', { class: 'figures', 'data-part': 'median', text: money(row.band.median) }),
      el('td', { class: 'figures', 'data-part': 'high', text: money(row.band.high) }),
    );
  } else {
    cells.push(el('td', { colspan: '3', class: 'locked-band' }));
  }
  return el('tr', { 'data-id': `${row.role_family}:${row.city}`, class: 'pay-row' }, cells);
}

function interviewList(company: Company): HTMLElement {
  const list = el('ul', { 'aria-label': 'Interview notes', class: 'interview-list' });
  for (const note of company.interview_notes) {
    list.append(
      el('li', { 'data-id': note.id, class: 'interview-note' }, [
        el('p', {
          class: 'figures',
          text: `${note.role_name} · Difficulty ${note.difficulty.toFixed(1)} · ${OUTCOME_LABELS[note.outcome]}`,
        }),
        el('p', { class: 'note-text', text: `${note.text}${note.truncated ? '…' : ''}` }),
        el('p', { class: 'review-byline', text: `${note.author_label} · ${monthYear(note.posted_month)}` }),
      ]),
    );
  }
  return list;
}

function jobList(company: Company): HTMLElement {
  const list = el('ul', { 'aria-label': 'Open jobs', class: 'plain-list' });
  for (const job of company.jobs) {
    list.append(
      el('li', { 'data-id': job.id }, [
        el('a', { href: `/jobs/${job.id}`, text: `${job.title} at ${job.company_name}` }),
        el('p', {
          class: 'figures',
          text: `${job.city_name} · ${workPatternName(job.remote)} · ${moneyRange(job.pay_low, job.pay_high)}`,
        }),
      ]),
    );
  }
  return list;
}

function unlockPanel(): HTMLElement {
  return el('div', { role: 'region', 'aria-label': 'Contribute once to unlock', class: 'inverted-band' }, [
    el('p', { text: 'Share one review, pay report or interview note to unlock full pay and review detail.' }),
    el('a', { href: '/contribute', class: 'solid-button on-accent', text: 'Share something' }),
  ]);
}

export async function renderCompany(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const slug = ctx.params['slug'] as string;
  let company = await get<Company>(`/api/companies/${slug}`);

  let alert: (message: string | null) => HTMLElement | null = () => null;
  const user = currentUser();
  const isTeam = (user?.role === 'employer_admin' || user?.role === 'recruiter') && user.company_slug === slug;

  const tile = specimenTile();
  const glasswareCaption = (): string =>
    `${company.name}, ${company.city_name}. ${reviewCountLine(company.rating.review_count)}`;
  tile.showGlassware(company.name, glasswareCaption());

  const heading = el('h1', { text: company.name });
  const verified = el('p', { class: 'verified-mark' });
  const ratingHost = el('div');
  const reviewsHost = el('div');
  const payHost = el('div');
  const interviewsHost = el('div');
  const jobsHost = el('div');
  const unlockHost = el('div');

  const replyFor = (review: Review): Node | null => {
    if (!isTeam || !company.verified || review.reply) return null;
    const host = el('div', { class: 'reply-form' });
    const button = el('button', { type: 'button', class: 'solid-button', text: `Reply to ${review.title}` });
    on(button, 'click', () => {
      const field = el('textarea', { 'aria-label': 'Your public reply', class: 'textbox', rows: '4' });
      const submit = el('button', { type: 'button', class: 'solid-button', text: 'Post reply' });
      host.replaceChildren(field, submit);
      focus(field);
      on(submit, 'click', () => {
        const done = working(submit);
        void post(`/api/employer/reviews/${review.id}/reply`, { body: field.value })
          .then(() => {
            toastAndAnnounce('Reply posted.');
            host.replaceChildren();
          })
          .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
          .finally(done);
      });
    });
    host.append(button);
    return host;
  };

  const paintSections = (): void => {
    verified.textContent = company.verified ? 'Verified employer' : '';
    ratingHost.replaceChildren(ratingFigure(company));
    const reviews = el('ul', { 'aria-label': 'Reviews', class: 'review-list' });
    for (const review of company.reviews) {
      reviews.append(el('li', {}, [reviewArticle(review, replyFor)]));
    }
    reviewsHost.replaceChildren(reviews);
    payHost.replaceChildren(payTable(company));
    interviewsHost.replaceChildren(interviewList(company));
    jobsHost.replaceChildren(jobList(company));
    unlockHost.replaceChildren(...(company.viewer_unlocked ? [] : [unlockPanel()]));
  };

  const sectionNodes: Record<TabId, HTMLElement> = {
    reviews: el('section', { class: 'reading-section', id: 'section-reviews' }, [
      el('h2', { text: 'Reviews' }),
      reviewsHost,
    ]),
    pay: el('section', { class: 'reading-section', id: 'section-pay' }, [el('h2', { text: 'Pay' }), payHost]),
    interviews: el('section', { class: 'reading-section', id: 'section-interviews' }, [
      el('h2', { text: 'Interviews' }),
      interviewsHost,
    ]),
    jobs: el('section', { class: 'reading-section', id: 'section-jobs' }, [el('h2', { text: 'Jobs' }), jobsHost]),
  };

  const phone = isPhone();
  const reading = el('div', {}, [heading, verified, ratingHost, unlockHost]);
  let selectTab: ((id: TabId, moveFocus: boolean) => void) | null = null;

  if (phone) {
    const tablist = el('div', { role: 'tablist', 'aria-label': 'Company sections', class: 'tablist' });
    const panel = el('div', { role: 'tabpanel', class: 'tabpanel' });
    const tabButtons = new Map<TabId, HTMLElement>();
    let selected: TabId = 'reviews';

    selectTab = (id: TabId, moveFocus: boolean): void => {
      selected = id;
      for (const [tabId, button] of tabButtons) {
        const active = tabId === id;
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
      panel.replaceChildren(sectionNodes[id]);
      panel.setAttribute('aria-label', TABS.find((tab) => tab.id === id)?.label ?? '');
      const query = new URLSearchParams(window.location.search);
      query.set('tab', id);
      replaceQuery(query);
      if (moveFocus) focus(tabButtons.get(id));
    };

    for (const [index, tab] of TABS.entries()) {
      const button = el('button', {
        type: 'button',
        role: 'tab',
        class: 'tab',
        text: tab.label,
        'aria-selected': 'false',
        tabindex: '-1',
      });
      on(button, 'click', () => selectTab?.(tab.id, false));
      on(button, 'keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = TABS[(index + step + TABS.length) % TABS.length];
        if (next) selectTab?.(next.id, true);
      });
      tabButtons.set(tab.id, button);
      tablist.append(button);
    }

    let startX = 0;
    on(
      panel,
      'touchstart',
      (event) => {
        startX = (event as TouchEvent).changedTouches[0]?.clientX ?? 0;
      },
      { passive: true },
    );
    on(
      panel,
      'touchend',
      (event) => {
        const endX = (event as TouchEvent).changedTouches[0]?.clientX ?? 0;
        const distance = endX - startX;
        if (Math.abs(distance) < 60) return;
        const index = TABS.findIndex((tab) => tab.id === selected);
        const next = TABS[distance < 0 ? index + 1 : index - 1];
        if (next) selectTab?.(next.id, false);
      },
      { passive: true },
    );

    reading.append(tablist, panel);
    const stacked = el('div', { class: 'stacked-stage' }, [
      el('div', { class: 'phone-band' }, [tile.element]),
      el('div', { class: 'reading-column' }, [reading]),
    ]);
    container.append(stacked);
    alert = pageAlert(reading);
    const requested = ctx.query.get('tab');
    selectTab(TABS.some((tab) => tab.id === requested) ? (requested as TabId) : 'reviews', false);
  } else {
    reading.append(sectionNodes.reviews, sectionNodes.pay, sectionNodes.interviews, sectionNodes.jobs);
    const field = el('div', {}, [tile.element]);
    container.append(splitStage(reading, field));
    alert = pageAlert(reading);
  }

  paintSections();

  if (!phone) {
    const requested = ctx.query.get('tab');
    /** The scroll waits for the page to be attached to the document. */
    if (requested && requested in sectionNodes) {
      requestAnimationFrame(() => sectionNodes[requested as TabId].scrollIntoView({ block: 'start' }));
    }
  }

  /** As each pay row's centre crosses the window's middle the tile shows that band. */
  const updateTile = (): void => {
    const middle = window.innerHeight / 2;
    let chosen: PayRow | null = null;
    for (const [index, node] of [...payHost.querySelectorAll('.pay-row')].entries()) {
      const box = node.getBoundingClientRect();
      if (box.top + box.height / 2 <= middle) chosen = company.pay_rows[index] ?? null;
    }
    if (chosen) tile.showPayRow(chosen, company.viewer_unlocked);
    else tile.showGlassware(company.name, glasswareCaption());
  };
  const stopScroll = on(window, 'scroll', updateTile, { passive: true });
  requestAnimationFrame(updateTile);

  const stopLive = onLive((messages) => {
    for (const message of messages) {
      if (message.type === 'member.unlocked') {
        announce('Full pay and review detail is now unlocked.');
        void get<Company>(`/api/companies/${slug}`).then((fresh) => {
          company = fresh;
          paintSections();
          updateTile();
        });
      }
      if (message.type === 'company.changed' && message.data['slug'] === slug) {
        const fresh = message.data['company'] as Company;
        const resolved = fresh.pay_rows.filter((row) => {
          const before = company.pay_rows.find((old) => old.role_family === row.role_family && old.city === row.city);
          return row.band !== null && (!before || before.band === null);
        });
        company = fresh;
        paintSections();
        for (const row of resolved) {
          announce(`Pay range now shown for ${row.role_name}`);
          if (tile.band() === `${row.role_family}:${row.city}`) tile.resolvePayRow(row, company.viewer_unlocked);
        }
        updateTile();
      }
    }
  });

  return () => {
    stopScroll();
    stopLive();
  };
}

export async function renderReviewLink(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const slug = ctx.params['slug'] as string;
  const company = await get<Company>(`/api/companies/${slug}`);
  const review = await get<Review>(`/api/companies/${slug}/reviews/${ctx.params['id'] as string}`);
  const reading = el('div', {}, [
    el('h1', { text: company.name }),
    el('ul', { 'aria-label': 'Reviews', class: 'review-list' }, [el('li', {}, [reviewArticle(review, () => null)])]),
  ]);
  const tile = specimenTile();
  tile.showGlassware(
    company.name,
    `${company.name}, ${company.city_name}. ${reviewCountLine(company.rating.review_count)}`,
  );
  container.append(splitStage(reading, el('div', {}, [tile.element])));
  return () => undefined;
}
