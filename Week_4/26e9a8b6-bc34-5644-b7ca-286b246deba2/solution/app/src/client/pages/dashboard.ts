import { ApiFailure, del, get, post } from '../api';
import { guideStatus, pageText, questionAlert } from '../../shared/copy';
import { CURRENCIES, type DashboardQuestion, type GuideRow, type User } from '../../shared/types';
import { dialogButtons, openDialog } from '../dialog';
import { h, replace } from '../dom';
import { Live } from '../live';
import { Status } from '../status';

interface DashboardData {
  drafts: GuideRow[]; published: GuideRow[]; forks: GuideRow[]; collections: { id: string; slug: string; title: string }[];
  questions: DashboardQuestion[]; questions_next_cursor: string | null;
}

export function mountDashboard(root: HTMLElement, _user: User | null): void {
  const alerts = new Status('Question alerts', 'status');
  const questionList = h('ul', { 'aria-label': 'Questions', class: 'rows' });
  const emptyQuestions = h('p', { class: 'shelf-empty', hidden: true }, pageText.emptyQuestions);
  const more = h('button', { type: 'button', class: 'button', hidden: true }, 'Load more questions');
  const shelves = { drafts: h('div', {}), published: h('div', {}), forks: h('div', {}), collections: h('div', {}) };
  let questions: DashboardQuestion[] = [];
  let cursor: string | null = null;

  const shelf = (kind: string, title: string, ...children: Node[]) => h('section', { class: `shelf shelf-${kind}` }, h('h2', {}, title), ...children);
  const start = h('button', { type: 'button', class: 'button' }, 'Start a guide');
  const signOut = h('button', { type: 'button', class: 'button quiet' }, 'Sign out');
  /** Hidden until the first answer is in, so filling the shelves never pushes anything already on screen. */
  const board = h('div', { hidden: true },
    shelf('questions', 'Questions', alerts.element, questionList, emptyQuestions, more),
    shelf('drafts', 'Drafts', shelves.drafts), shelf('published', 'Published', shelves.published),
    shelf('forks', 'Forks', shelves.forks), shelf('collections', 'Collections', shelves.collections));
  root.append(
    h('div', { class: 'dashboard-top' }, h('a', { class: 'wordmark', href: '/' }, 'Pennywasher'), h('div', { class: 'dialog-actions' }, start, signOut)),
    board);

  function rows(host: HTMLElement, items: { href: string; title: string; note?: string }[], empty: string): void {
    replace(host, items.length
      ? h('ul', { class: 'rows' }, ...items.map((i) => h('li', { class: 'row' }, h('a', { href: i.href }, i.title), i.note ? h('span', { class: 'row-note' }, i.note) : null)))
      : h('p', { class: 'shelf-empty' }, empty));
  }

  function renderQuestions(): void {
    replace(questionList, ...questions.map((q) =>
      h('li', { class: 'question-row' },
        h('p', { class: 'row' }, q.text),
        h('p', { class: 'question-meta' }, `${q.guide_title}, step ${q.step}, asked by ${q.asked_by}`),
        q.answer ? h('p', { class: 'question-meta' }, `Answered: ${q.answer.text}`) : answerButton(q))));
    emptyQuestions.hidden = questions.length > 0;
    more.hidden = cursor === null;
  }

  function answerButton(question: DashboardQuestion): HTMLButtonElement {
    const button = h('button', { type: 'button', class: 'button' }, 'Answer');
    button.addEventListener('click', () => {
      const text = h('textarea', { id: 'answer-text', class: 'field-input', rows: 4 });
      const status = h('p', { class: 'status', role: 'status', 'aria-label': 'Answer status', 'data-tone': 'error' });
      const send = h('button', { type: 'button', class: 'button' }, 'Send answer');
      const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
      const dialog = openDialog('Answer question', [
        h('h2', {}, 'Answer question'), h('p', {}, question.text),
        h('label', { class: 'cell', for: 'answer-text' }, h('span', { class: 'cell-label' }, 'Your answer'), text), status, dialogButtons(send, cancel)]);
      cancel.addEventListener('click', dialog.close);
      send.addEventListener('click', async () => {
        try {
          const answered = await post<DashboardQuestion>(`/api/questions/${question.id}/answer`, { text: text.value });
          questions = questions.map((q) => (q.id === question.id ? { ...q, answer: answered.answer } : q));
          dialog.close();
          renderQuestions();
        } catch (error) {
          status.textContent = guideStatus.failure;
        }
      });
    });
    return button;
  }

  async function load(): Promise<void> {
    const data = await get<DashboardData>('/api/dashboard');
    const known = new Set(questions.map((q) => q.id));
    questions = [...data.questions.filter((q) => !known.has(q.id)), ...questions.map((q) => data.questions.find((n) => n.id === q.id) ?? q)];
    cursor ??= data.questions_next_cursor;
    renderQuestions();
    rows(shelves.drafts, data.drafts.map((g) => ({ href: `/edit/${g.slug}`, title: g.title })), pageText.emptyDrafts);
    rows(shelves.published, data.published.map((g) => ({ href: `/edit/${g.slug}`, title: g.title, note: g.state === 'withdrawn' ? 'Withdrawn' : undefined })), pageText.emptyPublished);
    rows(shelves.forks, data.forks.map((g) => ({ href: `/edit/${g.slug}`, title: g.title })), pageText.emptyForks);
    rows(shelves.collections, data.collections.map((c) => ({ href: `/c/${c.slug}`, title: c.title })), pageText.emptyCollections);
    board.hidden = false;
  }

  more.addEventListener('click', async () => {
    const page = await get<DashboardData>(`/api/dashboard?cursor=${encodeURIComponent(cursor ?? '')}`);
    questions = [...questions, ...page.questions.filter((q) => !questions.some((k) => k.id === q.id))];
    cursor = page.questions_next_cursor;
    renderQuestions();
  });
  signOut.addEventListener('click', async () => {
    await del('/api/session');
    location.assign('/');
  });
  const openStart = () => {
    const title = h('input', { id: 'start-title', class: 'field-input', type: 'text', autocomplete: 'off' });
    const currency = h('select', { id: 'start-currency', class: 'field-input' }, ...CURRENCIES.map((c) => h('option', { value: c }, c)));
    const status = h('p', { class: 'status', role: 'status', 'aria-label': 'Start status', 'data-tone': 'error' });
    const create = h('button', { type: 'button', class: 'button' }, 'Create');
    const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
    const dialog = openDialog('Start a guide', [
      h('h2', {}, 'Start a guide'),
      h('div', { class: 'form' },
        h('label', { class: 'cell', for: 'start-title' }, h('span', { class: 'cell-label' }, 'Title'), title),
        h('label', { class: 'cell', for: 'start-currency' }, h('span', { class: 'cell-label' }, 'Currency'), currency)),
      status, dialogButtons(create, cancel)]);
    cancel.addEventListener('click', dialog.close);
    create.addEventListener('click', async () => {
      try {
        const made = await post<{ slug: string }>('/api/guides', { title: title.value, currency: currency.value });
        location.assign(`/edit/${made.slug}`);
      } catch (error) {
        status.textContent = error instanceof ApiFailure && error.code === 'unconfirmed' ? guideStatus.unconfirmed : guideStatus.failure;
      }
    });
  };
  start.addEventListener('click', openStart);
  void load().then(() => {
    if (new URLSearchParams(location.search).has('start')) openStart();
  });
  new Live({
    catchUp: () => void load(),
    onEvent: (event) => {
      if (event.type !== 'alert_question') return;
      alerts.set(questionAlert.toAuthor(event.guide_title, event.step));
      void load();
    },
  });
}
