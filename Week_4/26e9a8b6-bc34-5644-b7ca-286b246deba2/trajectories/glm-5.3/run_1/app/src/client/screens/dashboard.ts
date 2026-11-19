// Dashboard: a stack of full-bleed shelves with big type rows.

import { el, announceExpiring } from '../dom';
import { api, LiveConnection } from '../api';
import { COPY } from '../../shared/copy';

interface DashboardJson {
  drafts: { id: string; slug: string; title: string; state: string }[];
  published: { id: string; slug: string; title: string; state: string }[];
  forks: { id: string; slug: string; title: string; state: string }[];
  collections: { id: string; slug: string; title: string; visibility: string }[];
  questions: { id: string; guide_id: string; step: number; text: string; asked_by: string; guide_title?: string }[];
  questions_next_cursor: string | null;
}

export function renderDashboard(main: HTMLElement): void {
  main.textContent = '';
  api<DashboardJson>('/api/dashboard').then((data) => {
    build(main, data);
  }).catch(() => {
    window.location.href = '/signin?next=/dashboard';
  });
}

function build(main: HTMLElement, data: DashboardJson): void {
  const questionAlerts = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'question-alerts' });
  main.append(questionAlerts);

  const shelfQuestions = el('section', { class: 'shelf shelf--red', 'aria-labelledby': 'heading-questions' });
  shelfQuestions.append(el('h2', { id: 'heading-questions' }, 'Questions'));
  const questionsList = el('div', { role: 'list', 'aria-label': 'Questions' });
  if (data.questions.length === 0) {
    shelfQuestions.append(el('p', { class: 'giant' }, COPY.fixed.emptyQuestions));
  }
  for (const question of data.questions) {
    const item = el('div', { role: 'listitem', class: 'shelf-row' });
    item.append(el('p', {}, question.text));
    const answer = el('button', { class: 'pw-btn' }, 'Answer');
    answer.addEventListener('click', () => {
      void openAnswerDialog(question, item);
    });
    item.append(answer);
    questionsList.append(item);
  }
  shelfQuestions.append(questionsList);
  const loadMore = el('button', { class: 'pw-btn' }, 'Load more questions');
  if (data.questions_next_cursor === null) loadMore.setAttribute('aria-disabled', 'true');
  shelfQuestions.append(loadMore);
  main.append(shelfQuestions);

  const shelfDrafts = shelf('Drafts', 'shelf--bone', data.drafts, COPY.fixed.emptyDrafts, false);
  const shelfPublished = shelf('Published', 'shelf--mustard', data.published, COPY.fixed.emptyPublished, true);
  const shelfForks = shelf('Forks', 'shelf--slate', data.forks, COPY.fixed.emptyForks, false);
  const shelfCollections = el('section', { class: 'shelf shelf--maroon', 'aria-labelledby': 'heading-collections' });
  shelfCollections.append(el('h2', { id: 'heading-collections' }, 'Collections'));
  if (data.collections.length === 0) {
    shelfCollections.append(el('p', { class: 'giant' }, COPY.fixed.emptyCollections));
  }
  for (const collection of data.collections) {
    const row = el('a', { class: 'shelf-row', href: `/c/${collection.slug}` }, collection.title);
    shelfCollections.append(row);
  }
  main.append(shelfDrafts, shelfPublished, shelfForks, shelfCollections);

  const bar = el('div', { class: 'dashboard-tools' });
  const start = el('button', { class: 'pw-btn' }, 'Start a guide');
  const signOut = el('button', { class: 'pw-btn' }, 'Sign out');
  bar.append(start, signOut);
  main.append(bar);

  start.addEventListener('click', () => {
    const dialog = el('dialog', { 'aria-label': 'Start a guide' });
    const body = el('div', { class: 'dialog__body' });
    const title = el('input', { type: 'text', 'aria-label': 'Title' }) as HTMLInputElement;
    const currency = el('select', { 'aria-label': 'Currency' }) as HTMLSelectElement;
    for (const code of ['EUR', 'GBP', 'USD', 'JPY']) {
      currency.append(el('option', { value: code }, code));
    }
    const create = el('button', { class: 'pw-btn' }, 'Create');
    const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
    body.append(title, currency, create, cancel);
    dialog.append(body);
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    create.addEventListener('click', async () => {
      try {
        const result = await api<{ id: string; slug: string }>('/api/guides', {
          body: { title: title.value, currency: currency.value },
        });
        window.location.href = `/edit/${result.slug}`;
      } catch (error) {
        const err = error as { code?: string };
        announceExpiring('guide-status', err.code === 'unconfirmed' ? COPY.guide.unconfirmed : COPY.guide.failed);
        dialog.close();
      }
    });
  });

  signOut.addEventListener('click', async () => {
    await api('/api/session', { method: 'DELETE' });
    window.location.href = '/';
  });

  // New questions arrive live on the open dashboard.
  const live = new LiveConnection(null, {
    onEvent: (event) => {
      if (event.type === 'question') {
        announceExpiring('question-alerts', COPY.questionAlerts.toAuthor('', Number(event.step ?? 0)));
        void refreshQuestions();
      }
    },
  });
  live.start();
  window.addEventListener('pagehide', () => live.stop());
}

function shelf(name: string, colour: string, guides: { id: string; slug: string; title: string; state: string }[], emptyCopy: string, withdrawnLabel: boolean): HTMLElement {
  const section = el('section', { class: `shelf ${colour}`, 'aria-labelledby': `heading-${name}`.toLowerCase() });
  section.append(el('h2', { id: `heading-${name}`.toLowerCase() }, name));
  if (guides.length === 0) {
    section.append(el('p', { class: 'giant' }, emptyCopy));
  }
  for (const guide of guides) {
    const row = el('a', { class: 'shelf-row', href: `/edit/${guide.slug}` }, guide.title);
    if (withdrawnLabel && guide.state === 'withdrawn') {
      row.append(el('span', { class: 'pw-chip' }, 'Withdrawn'));
    }
    section.append(row);
  }
  return section;
}

async function refreshQuestions(): Promise<void> {
  // The shelf refreshes by reload-free refetch of the dashboard.
  try {
    const data = await api<DashboardJson>('/api/dashboard');
    const questionsList = document.querySelector('[aria-label="Questions"]');
    if (!questionsList) return;
    questionsList.textContent = '';
    for (const question of data.questions) {
      const item = el('div', { role: 'listitem', class: 'shelf-row' });
      item.append(el('p', {}, question.text));
      questionsList.append(item);
    }
  } catch {
    // A dropped connection retries with the live stream.
  }
}

async function openAnswerDialog(question: { id: string; step: number }, item: HTMLElement): Promise<void> {
  const dialog = el('dialog', { 'aria-label': 'Answer question' });
  const body = el('div', { class: 'dialog__body' });
  const text = el('textarea', { 'aria-label': 'Your answer' }) as HTMLTextAreaElement;
  const send = el('button', { class: 'pw-btn' }, 'Send answer');
  const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
  body.append(text, send, cancel);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  send.addEventListener('click', async () => {
    try {
      await api(`/api/questions/${question.id}/answer`, { body: { text: text.value } });
      item.remove();
      dialog.close();
    } catch {
      announceExpiring('guide-status', COPY.guide.failed);
    }
  });
}
