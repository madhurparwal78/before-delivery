import { pageText, searchStatus } from '../../shared/copy.js';
import { CURRENCIES, type GuideReading, type Question, type SessionUser } from '../../shared/types.js';
import type { Dashboard } from '../domain/engagement.js';
import type { SearchPage } from '../domain/search.js';
import { attr, escapeText, paragraphs, tag } from './html.js';

export function renderHomeBody(guide: GuideReading | null): string {
  const hero = `<section class="hero">
<div class="hero-top"><a class="hero-start" href="/dashboard?start=1">Start a guide</a></div>
${tag(
    'h1',
    { class: 'waterline' },
    tag('span', { class: 'waterline-line' }, 'TAKE IT'),
    tag(
      'span',
      { class: 'waterline-cut' },
      tag('span', { class: 'waterline-above' }, 'APART.'),
      tag('span', { class: 'waterline-below', 'aria-hidden': 'true' }, 'APART.'),
    ),
  )}
${tag('p', { class: 'hero-supporting' }, escapeText(pageText.heroSupporting))}
</section>`;
  const firstStep = guide?.steps[0];
  const preview =
    guide === null || firstStep === undefined
      ? ''
      : `<section class="home-guide" data-phase="${attr(firstStep.phase)}">
${tag(
          'div',
          {
            class: 'stage',
            role: 'application',
            'aria-label': 'Model stage',
            tabindex: 0,
            'data-step': 1,
            'data-explode': firstStep.explode.toFixed(3),
            'data-yaw': String(firstStep.camera.yaw),
            'data-pitch': String(firstStep.camera.pitch),
            'data-zoom': '1.00',
            'data-state': 'loading',
            'data-model': guide.model_id ?? '',
          },
          '<canvas class="stage-canvas"></canvas><div class="callout-layer"></div>',
        )}
${tag('div', { class: 'stage-status', role: 'status', 'aria-label': 'Stage status' }, '')}
${tag('h2', {}, escapeText(firstStep.title))}
${tag('div', { class: 'step-text' }, paragraphs(firstStep.text))}
${tag('a', { href: `/g/${attr(guide.slug)}` }, 'Read this guide')}
${tag('a', { href: '/search' }, 'Find a guide')}
</section>`;
  return `<main class="home">${hero}${preview}</main>`;
}

function guideRow(row: { slug: string; title: string; state?: string }): string {
  return tag(
    'li',
    { class: 'type-row' },
    tag('a', { href: `/edit/${attr(row.slug)}` }, escapeText(row.title)),
    row.state === 'withdrawn' ? tag('span', { class: 'row-note' }, 'Withdrawn') : '',
  );
}

function shelf(
  heading: string,
  phase: string,
  rows: readonly { slug: string; title: string; state?: string }[],
  empty: string,
  extra = '',
): string {
  const body =
    rows.length === 0
      ? tag('p', { class: 'empty-shelf' }, escapeText(empty))
      : tag('ul', { class: 'shelf-rows' }, rows.map(guideRow).join(''));
  return tag(
    'section',
    { class: 'shelf', 'data-shelf': phase },
    tag('h2', {}, escapeText(heading)),
    extra,
    body,
  );
}

function questionRow(question: Question, guideTitle: string): string {
  return tag(
    'li',
    { class: 'type-row', 'data-question': question.id },
    tag('p', {}, escapeText(`${guideTitle} step ${question.step}`)),
    tag('p', { class: 'question-text' }, paragraphs(question.text)),
    question.answer === null
      ? tag('button', { type: 'button', 'aria-label': 'Answer', 'data-answer': question.id }, 'Answer')
      : tag('p', { class: 'answer-text' }, paragraphs(question.answer.text)),
  );
}

export function renderDashboardBody(
  dashboard: Dashboard,
  titles: ReadonlyMap<string, string>,
): string {
  const questions =
    dashboard.questions.length === 0
      ? tag('p', { class: 'empty-shelf' }, escapeText(pageText.emptyQuestions))
      : tag(
          'ul',
          { class: 'shelf-rows', 'aria-label': 'Questions' },
          dashboard.questions
            .map((question) => questionRow(question, titles.get(question.guide_id) ?? ''))
            .join(''),
        );
  return `<main class="dashboard">
${tag('div', { class: 'question-alerts', role: 'status', 'aria-label': 'Question alerts' }, '')}
${tag('button', { type: 'button', 'aria-label': 'Start a guide', 'data-tool': 'Start a guide' }, 'Start a guide')}
${tag('button', { type: 'button', 'aria-label': 'Sign out' }, 'Sign out')}
${tag(
    'section',
    { class: 'shelf', 'data-shelf': 'questions' },
    tag('h2', {}, 'Questions'),
    questions,
    tag('button', { type: 'button', 'aria-label': 'Load more questions' }, 'Load more questions'),
  )}
${shelf('Drafts', 'drafts', dashboard.drafts, pageText.emptyDrafts)}
${shelf('Published', 'published', dashboard.published, pageText.emptyPublished)}
${shelf('Forks', 'forks', dashboard.forks, pageText.emptyForks)}
${tag(
    'section',
    { class: 'shelf', 'data-shelf': 'collections' },
    tag('h2', {}, 'Collections'),
    dashboard.collections.length === 0
      ? tag('p', { class: 'empty-shelf' }, escapeText(pageText.emptyCollections))
      : tag(
          'ul',
          { class: 'shelf-rows' },
          dashboard.collections
            .map((collection) =>
              tag(
                'li',
                { class: 'type-row' },
                tag('a', { href: `/c/${attr(collection.slug)}` }, escapeText(collection.title)),
              ),
            )
            .join(''),
        ),
  )}
${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Start a guide', 'aria-modal': 'true', hidden: true },
    tag('label', { class: 'cell' }, 'Title', tag('input', { type: 'text', 'aria-label': 'Title' })),
    tag(
      'label',
      { class: 'cell' },
      'Currency',
      tag(
        'select',
        { 'aria-label': 'Currency' },
        CURRENCIES.map((code) => tag('option', { value: code }, code)).join(''),
      ),
    ),
    tag('button', { type: 'button', 'data-action': 'create-guide' }, 'Create'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}
${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Answer question', 'aria-modal': 'true', hidden: true },
    tag('label', { class: 'cell' }, 'Your answer', tag('textarea', { 'aria-label': 'Your answer', rows: 4 }, '')),
    tag('button', { type: 'button', 'data-action': 'send-answer' }, 'Send answer'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}
</main>`;
}

export function renderSearchBody(
  page: SearchPage,
  q: string,
  tags: readonly string[],
): string {
  const chips = tags
    .map((label) =>
      tag(
        'span',
        { class: 'tag-chip', 'data-tag': label },
        escapeText(label),
        tag(
          'button',
          { type: 'button', 'aria-label': `Remove tag ${label}`, 'data-remove-tag': label },
          'Remove',
        ),
      ),
    )
    .join('');
  const results = page.items
    .map((item) =>
      tag(
        'li',
        { class: 'type-row', 'data-result': item.id },
        tag('a', { href: `/g/${attr(item.slug)}` }, escapeText(item.title)),
        tag('span', { class: 'row-note' }, escapeText(item.author_name)),
        tag('span', { class: 'row-note' }, escapeText(item.parts_cost_text)),
      ),
    )
    .join('');
  return `<main class="search">
${tag('label', { class: 'cell' }, 'Search guides', tag('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search guides',
    value: q,
  }))}
${tag('label', { class: 'cell' }, 'Filter by tag', tag('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Filter by tag',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
  }))}
${tag('div', { class: 'tag-chips' }, chips)}
${tag('p', { class: 'result-count', 'data-figure': 'result-count' }, String(page.total))}
${tag(
    'div',
    { class: 'search-status', role: 'status', 'aria-label': 'Search status' },
    escapeText(page.total === 0 ? searchStatus.none : searchStatus.found(page.total)),
  )}
${tag('ul', { class: 'search-results' }, results)}
${tag('button', { type: 'button', 'aria-label': 'Load more', hidden: page.next_cursor === null }, 'Load more')}
</main>`;
}

export interface CollectionView {
  title: string;
  slug: string;
  owner: boolean;
  items: { guide_id: string; title: string; slug: string; position: number }[];
}

export function renderCollectionBody(view: CollectionView): string {
  const rows = view.items
    .map((item) =>
      tag(
        'li',
        {
          class: 'type-row',
          'data-guide': item.guide_id,
          tabindex: view.owner ? 0 : undefined,
        },
        tag('a', { href: `/g/${attr(item.slug)}` }, escapeText(item.title)),
      ),
    )
    .join('');
  return `<main class="collection" data-collection="${attr(view.slug)}">
${tag('h1', {}, escapeText(view.title))}
${tag('ul', { class: 'collection-rows', 'aria-label': 'Guides in this collection' }, rows)}
${tag('div', { class: 'collection-status', role: 'status', 'aria-label': 'Collection status' }, '')}
</main>`;
}

export type AuthKind = 'signin' | 'signup' | 'confirm';

export interface AuthView {
  kind: AuthKind;
  next: string;
  status: string;
  viewer: SessionUser | null;
}

export function renderAuthBody(view: AuthView): string {
  const statusRegion = tag(
    'div',
    { class: 'account-status', role: 'status', 'aria-label': 'Account status' },
    escapeText(view.status),
  );
  if (view.kind === 'confirm') {
    return `<main class="auth">
${tag('h1', {}, 'Confirm your email')}
${statusRegion}
${tag('button', { type: 'button', 'aria-label': 'Send a new link' }, 'Send a new link')}
</main>`;
  }
  const isSignUp = view.kind === 'signup';
  return `<main class="auth" data-next="${attr(view.next)}">
${tag('h1', {}, isSignUp ? 'Create an account' : 'Sign in')}
${isSignUp ? tag('label', { class: 'cell' }, 'Name', tag('input', { type: 'text', 'aria-label': 'Name' })) : ''}
${tag('label', { class: 'cell' }, 'Email', tag('input', { type: 'email', 'aria-label': 'Email' }))}
${tag('label', { class: 'cell' }, 'Password', tag('input', { type: 'password', 'aria-label': 'Password' }))}
${tag('button', { type: 'button', 'aria-label': isSignUp ? 'Sign up' : 'Sign in' }, isSignUp ? 'Sign up' : 'Sign in')}
${statusRegion}
${isSignUp ? '' : tag('a', { href: '/signup' }, 'Create an account')}
</main>`;
}

export function renderNoticeBody(message: string): string {
  return `<main class="notice">
${tag('section', { class: 'notice-band' }, tag('h1', {}, escapeText(message)), tag('a', { href: '/' }, 'Pennywasher'))}
</main>`;
}
