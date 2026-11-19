import { formatCost } from '../../shared/cost.js';
import {
  forkCount as forkCountCopy,
  likeCount as likeCountCopy,
  pageText,
  readingProgress,
  stageStatus,
  stepCounter,
} from '../../shared/copy.js';
import { PHASE_NAMES, type GuideReading, type Question, type SessionUser } from '../../shared/types.js';
import { attr, escapeText, paragraphs, tag } from './html.js';

export interface ReaderView {
  guide: GuideReading;
  questions: Question[];
  viewer: SessionUser | null;
  step: number;
  /** Set when the address asked for a step past the end. */
  pastTheEnd: boolean;
  /** True when the address carried a step, so nothing tweens or counts. */
  settled: boolean;
  liked: boolean;
  soundHidden: boolean;
  storageOut: boolean;
  mode: 'reader' | 'embed';
}

function stageBlock(view: ReaderView): string {
  const step = view.guide.steps[view.step - 1];
  const explode = view.settled ? (step?.explode ?? 0) : (view.guide.steps[0]?.explode ?? 0);
  const camera = view.settled ? step?.camera : view.guide.steps[0]?.camera;
  const status = view.storageOut ? stageStatus.storageOutReader : stageStatus.loading;
  return `<div class="stage-holder">
${tag(
    'div',
    {
      class: 'stage',
      role: 'application',
      'aria-label': 'Model stage',
      tabindex: 0,
      'data-step': view.step,
      'data-explode': explode.toFixed(3),
      'data-yaw': String(camera?.yaw ?? 0),
      'data-pitch': String(camera?.pitch ?? 0),
      'data-zoom': '1.00',
      'data-state': view.storageOut ? 'error' : 'loading',
      'data-model': view.guide.model_id ?? '',
    },
    '<canvas class="stage-canvas"></canvas><div class="callout-layer"></div>',
  )}
${tag('div', { class: 'stage-status', role: 'status', 'aria-label': 'Stage status' }, escapeText(status))}
${freeLookSwitch()}
${partsList(view)}
${runningFigures(view)}
</div>`;
}

function freeLookSwitch(): string {
  return tag('button', {
    type: 'button',
    class: 'free-look',
    role: 'switch',
    'aria-label': 'Free look',
    'aria-checked': 'false',
  }, 'Free look');
}

function partsList(view: ReaderView): string {
  const step = view.guide.steps[view.step - 1];
  const byId = new Map(view.guide.parts.map((part) => [part.id, part]));
  const items = (step?.focus_parts ?? [])
    .map((id, index) => tag('li', { value: index + 1 }, escapeText(byId.get(id)?.name ?? '')))
    .join('');
  return tag('ol', { class: 'parts-list', 'aria-label': 'Parts' }, items);
}

function runningFigures(view: ReaderView): string {
  const step = view.guide.steps[view.step - 1];
  const cost = view.settled
    ? (step?.parts_cost_text ?? formatCost(0, view.guide.currency))
    : (view.guide.steps[0]?.parts_cost_text ?? formatCost(0, view.guide.currency));
  return `${tag(
    'p',
    { class: 'parts-cost', 'data-figure': 'parts-cost', 'aria-hidden': 'true' },
    escapeText(cost),
  )}${tag(
    'div',
    { class: 'step-counter', role: 'status', 'aria-label': 'Step counter' },
    escapeText(stepCounter(view.step, view.guide.step_count)),
  )}`;
}

function readerBar(view: ReaderView): string {
  if (view.mode === 'embed') {
    return `<div class="reader-bar">
${view.soundHidden ? '' : soundButton()}
${stepButtons(view)}
${tag('a', { class: 'open-on', href: `/g/${attr(view.guide.slug)}?step=${view.step}` }, 'Open on Pennywasher')}
</div>`;
  }
  return `<div class="reader-bar">
${tag(
    'button',
    { type: 'button', class: 'bar-button', 'aria-label': 'Like', 'aria-pressed': view.liked ? 'true' : 'false' },
    'Like',
  )}
${tag('button', { type: 'button', class: 'bar-button', 'aria-label': 'Fork guide' }, 'Fork guide')}
${tag('button', { type: 'button', class: 'bar-button', 'aria-label': 'Add to collection' }, 'Add to collection')}
${tag('button', { type: 'button', class: 'bar-button', 'aria-label': 'Ask the author' }, 'Ask the author')}
${view.soundHidden ? '' : soundButton()}
${stepButtons(view)}
</div>`;
}

function soundButton(): string {
  return tag(
    'button',
    { type: 'button', class: 'bar-button', 'aria-label': 'Workshop sound', 'aria-pressed': 'false' },
    'Workshop sound',
  );
}

function stepButtons(view: ReaderView): string {
  const last = view.guide.step_count;
  return `${tag(
    'button',
    {
      type: 'button',
      class: 'bar-button step-button',
      'aria-label': 'Previous step',
      'data-move': '-1',
      'aria-disabled': view.step <= 1 ? 'true' : 'false',
    },
    'Previous step',
  )}${tag(
    'button',
    {
      type: 'button',
      class: 'bar-button step-button',
      'aria-label': 'Next step',
      'data-move': '1',
      'aria-disabled': view.step >= last ? 'true' : 'false',
    },
    'Next step',
  )}`;
}

function stepsNavigation(view: ReaderView): string {
  const links = view.guide.steps
    .map((step) =>
      tag(
        'a',
        {
          href: `${view.mode === 'embed' ? '/embed/' : '/g/'}${attr(view.guide.slug)}?step=${step.number}`,
          'aria-label': `Step ${step.number}: ${step.title}`,
          'data-step-link': step.number,
        },
        String(step.number),
      ),
    )
    .join('');
  return tag('nav', { class: 'steps-nav', 'aria-label': 'Steps' }, links);
}

function questionsFor(view: ReaderView, stepNumber: number): string {
  const items = view.questions
    .filter((question) => question.step === stepNumber)
    .map((question) =>
      tag(
        'li',
        { 'data-question': question.id },
        tag('p', { class: 'question-text' }, paragraphs(question.text)),
        question.answer === null
          ? ''
          : tag('p', { class: 'answer-text' }, paragraphs(question.answer.text)),
      ),
    )
    .join('');
  return tag('ul', { class: 'questions', 'aria-label': 'Questions on this step' }, items);
}

function stepPanels(view: ReaderView): string {
  return view.guide.steps
    .map((step) =>
      tag(
        'section',
        {
          class: 'step-panel',
          'data-step-panel': step.number,
          'data-phase': step.phase,
          hidden: step.number !== view.step,
        },
        tag('p', { class: 'phase-name' }, escapeText(PHASE_NAMES[step.phase])),
        tag('h2', {}, escapeText(step.title)),
        tag('div', { class: 'step-text' }, paragraphs(step.text)),
        questionsFor(view, step.number),
        stepsNavigation(view),
      ),
    )
    .join('');
}

function phaseFields(view: ReaderView): string {
  const fields = view.guide.steps
    .map((step) =>
      tag('div', {
        class: 'phase-field',
        'data-phase': step.phase,
        'data-field-step': step.number,
        style: `top:calc(var(--vh) * ${(step.number + 0.65).toFixed(2)})`,
      }),
    )
    .join('');
  return tag('div', { class: 'phase-fields', 'aria-hidden': 'true' }, fields);
}

function guideHeader(view: ReaderView): string {
  const credit =
    view.guide.forked_from === null
      ? ''
      : tag(
          'p',
          { class: 'fork-credit' },
          escapeText(
            pageText.forkCredit(
              view.guide.forked_from.title,
              view.guide.forked_from.author_name,
              view.guide.forked_from.version,
            ),
          ),
        );
  const zero = view.settled;
  return tag(
    'section',
    { class: 'guide-header' },
    tag('h1', {}, escapeText(view.guide.title)),
    tag('p', { class: 'author-name' }, escapeText(view.guide.author.name)),
    tag(
      'ul',
      { class: 'tag-list' },
      view.guide.tags.map((label) => tag('li', {}, escapeText(label))).join(''),
    ),
    tag(
      'div',
      { class: 'live-count', role: 'status', 'aria-label': 'Like count' },
      escapeText(likeCountCopy(view.guide.like_count)),
    ),
    tag(
      'div',
      { class: 'live-count', role: 'status', 'aria-label': 'Fork count' },
      escapeText(forkCountCopy(view.guide.fork_count)),
    ),
    credit,
    tag(
      'dl',
      { class: 'summary-figures' },
      tag('dt', {}, 'Parts cost'),
      tag(
        'dd',
        { 'data-figure': 'total-cost' },
        escapeText(zero ? view.guide.total_cost_text : formatCost(0, view.guide.currency)),
      ),
      tag('dt', {}, 'Parts'),
      tag('dd', { 'data-figure': 'part-count' }, escapeText(zero ? String(view.guide.part_count) : '0')),
      tag('dt', {}, 'Steps'),
      tag('dd', { 'data-figure': 'step-count' }, escapeText(zero ? String(view.guide.step_count) : '0')),
    ),
  );
}

function spine(view: ReaderView): string {
  const sections = view.guide.steps
    .map((step) => tag('div', { class: 'spine-section', 'data-spine-step': step.number }))
    .join('');
  return tag(
    'div',
    { class: 'spine', 'aria-hidden': 'true' },
    tag('div', { class: 'spine-section' }),
    sections,
    tag('div', { class: 'spine-section' }),
  );
}

function closingTotal(view: ReaderView): string {
  return tag(
    'section',
    { class: 'closing-total', 'data-phase': 'closing_total' },
    tag('h2', {}, 'Parts for this repair'),
    tag(
      'p',
      { 'data-figure': 'closing-total' },
      escapeText(view.guide.total_cost_text),
    ),
  );
}

function statusRegions(view: ReaderView): string {
  const step = view.guide.steps[view.step - 1];
  const progress =
    step === undefined
      ? ''
      : readingProgress(step.number, view.guide.step_count, step.title, step.parts_cost_text);
  const notice = view.pastTheEnd ? pageText.pastTheEnd(view.guide.step_count) : '';
  return `${tag(
    'div',
    { class: 'reading-progress', role: 'status', 'aria-label': 'Reading progress' },
    escapeText(progress),
  )}${
    view.mode === 'embed'
      ? ''
      : `${tag('div', { class: 'guide-status', role: 'status', 'aria-label': 'Guide status' }, escapeText(notice))}${tag(
          'div',
          { class: 'question-alerts', role: 'status', 'aria-label': 'Question alerts' },
          '',
        )}`
  }`;
}

function unconfirmedControls(view: ReaderView): string {
  if (view.mode === 'embed' || view.viewer === null || view.viewer.confirmed) return '';
  return tag(
    'button',
    { type: 'button', class: 'bar-button resend-confirmation', 'aria-label': 'Resend confirmation' },
    'Resend confirmation',
  );
}

function dialogs(view: ReaderView): string {
  if (view.mode === 'embed') return '';
  return `${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Ask the author', 'aria-modal': 'true', hidden: true },
    tag('p', { class: 'asking-about' }, `Asking about step ${view.step}`),
    tag('label', {}, 'Your question', tag('textarea', { 'aria-label': 'Your question', rows: 4 }, '')),
    tag('div', { class: 'ask-status', role: 'status', 'aria-label': 'Ask status' }, ''),
    tag('button', { type: 'button', 'data-action': 'send-question' }, 'Send question'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Fork guide', 'aria-modal': 'true', hidden: true },
    tag(
      'button',
      { type: 'button', 'data-action': 'confirm-fork' },
      `Fork version ${view.guide.published_version ?? 1}`,
    ),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}${tag(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': 'Add to collection', 'aria-modal': 'true', hidden: true },
    tag('label', {}, 'Collection', tag('select', { 'aria-label': 'Collection' }, '')),
    tag('label', {}, 'New collection title', tag('input', { type: 'text', 'aria-label': 'New collection title' })),
    tag('button', { type: 'button', 'data-action': 'add-to-collection' }, 'Add'),
    tag('button', { type: 'button', 'data-action': 'cancel' }, 'Cancel'),
  )}`;
}

export function renderReaderBody(view: ReaderView): string {
  if (view.mode === 'embed') {
    return `<main class="embed" data-mode="embed">
${readerBar(view)}
${stageBlock(view)}
${stepPanels(view)}
${statusRegions(view)}
</main>`;
  }
  return `<main class="reader" data-mode="reader" style="--steps:${view.guide.step_count}">
${guideHeader(view)}
${readerBar(view)}
${stageBlock(view)}
${unconfirmedControls(view)}
${stepPanels(view)}
${phaseFields(view)}
${spine(view)}
${closingTotal(view)}
${statusRegions(view)}
${dialogs(view)}
</main>`;
}
