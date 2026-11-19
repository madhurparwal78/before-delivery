import {
  accountStatus,
  collectionStatus,
  questionAlerts,
  searchStatus,
  stageStatus,
} from '../shared/copy.js';
import { MOTION } from '../shared/scrollmap.js';
import type { GuideReading, Question, SessionUser } from '../shared/types.js';
import { call } from './api.js';
import { byLabel, need, requireDialog, Status, trackViewportHeight } from './dom.js';
import { wholeFigure } from './figures.js';
import { Delay } from './motion.js';
import { LiveConnection, newClientId } from './live.js';
import { Stage, webglAvailable } from './stage.js';
import { PHASE_FIELD } from '../shared/palette.js';

export function startHome(guide: GuideReading | null): void {
  trackViewportHeight();
  if (guide === null || !webglAvailable()) return;
  const element = document.querySelector<HTMLElement>('.home-guide .stage');
  if (element === null) return;
  const stageStatusRegion = new Status('Stage status');
  const stage = new Stage({
    element,
    canvas: need<HTMLCanvasElement>('.stage-canvas', element),
  });
  const first = guide.steps[0];
  if (guide.model_id === null || first === undefined) {
    stageStatusRegion.say(stageStatus.noModel);
    return;
  }
  stageStatusRegion.say(stageStatus.loading);
  void (async () => {
    try {
      await stage.load(`/api/models/${guide.model_id}.glb`, guide.parts, 1);
      stage.setColours(PHASE_FIELD[first.phase], null, null);
      stage.setFocus(first.focus_parts);
      stage.applyPose({
        explode: first.explode,
        yaw: first.camera.yaw,
        pitch: first.camera.pitch,
        zoom: 1,
      });
      stage.setState('ready');
      stageStatusRegion.say(stageStatus.ready);
    } catch {
      stage.setState('error');
      stageStatusRegion.say(stageStatus.storageOutReader);
    }
  })();
}

interface DashboardData {
  dashboard: {
    questions: Question[];
    questions_next_cursor: string | null;
  };
  viewer: SessionUser;
  titles: Record<string, string>;
  openStart: boolean;
}

export function startDashboard(data: DashboardData): void {
  trackViewportHeight();
  const alerts = new Status('Question alerts');
  const startDialog = requireDialog('Start a guide');
  const answerDialog = requireDialog('Answer question');
  let answering: string | null = null;
  let cursor = data.dashboard.questions_next_cursor;

  const startButton = document.querySelector<HTMLElement>('[data-tool="Start a guide"]');
  startButton?.addEventListener('click', () => startDialog.open(startButton));
  if (data.openStart) startDialog.open(startButton);

  document.querySelector<HTMLElement>('[data-action="create-guide"]')?.addEventListener('click', () => {
    const title = byLabel<HTMLInputElement>('Title', startDialog.element);
    const currency = byLabel<HTMLSelectElement>('Currency', startDialog.element);
    void (async () => {
      const reply = await call<{ slug: string }>('POST', '/api/guides', {
        title: title?.value ?? '',
        currency: currency?.value ?? 'EUR',
      });
      if (reply.status === 201) window.location.href = `/edit/${reply.body.slug}`;
    })();
  });

  function wireAnswerButtons(): void {
    for (const button of document.querySelectorAll<HTMLElement>('[data-answer]')) {
      button.addEventListener('click', () => {
        answering = button.getAttribute('data-answer');
        answerDialog.open(button);
      });
    }
  }
  wireAnswerButtons();

  document.querySelector<HTMLElement>('[data-action="send-answer"]')?.addEventListener('click', () => {
    const field = byLabel<HTMLTextAreaElement>('Your answer', answerDialog.element);
    if (answering === null || field === null) return;
    void (async () => {
      const reply = await call('POST', `/api/questions/${answering}/answer`, { text: field.value });
      if (reply.status === 201) {
        answerDialog.close();
        field.value = '';
        window.location.reload();
      }
    })();
  });

  byLabel<HTMLElement>('Load more questions')?.addEventListener('click', () => {
    if (cursor === null) return;
    void (async () => {
      const reply = await call<{ items: Question[]; next_cursor: string | null }>(
        'GET',
        `/api/dashboard`,
      );
      if (reply.status !== 200) return;
      cursor = reply.body.next_cursor;
    })();
  });

  byLabel<HTMLElement>('Sign out')?.addEventListener('click', () => {
    void (async () => {
      await call('DELETE', '/api/session');
      window.location.href = '/';
    })();
  });

  const live = new LiveConnection(null, newClientId());
  live.on((event) => {
    if (event.kind === 'question') {
      const question = event['question'] as Question;
      alerts.say(questionAlerts.toAuthor(String(event['guide_title']), question.step));
      addQuestionRow(question, String(event['guide_title']));
    }
  });
  live.start();

  function addQuestionRow(question: Question, guideTitle: string): void {
    const list = byLabel<HTMLElement>('Questions');
    if (list === null) return;
    if (list.querySelector(`[data-question="${question.id}"]`) !== null) return;
    const item = document.createElement('li');
    item.className = 'type-row';
    item.setAttribute('data-question', question.id);
    const where = document.createElement('p');
    where.textContent = `${guideTitle} step ${question.step}`;
    const text = document.createElement('p');
    text.className = 'question-text';
    text.textContent = question.text;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Answer');
    button.setAttribute('data-answer', question.id);
    button.textContent = 'Answer';
    button.addEventListener('click', () => {
      answering = question.id;
      answerDialog.open(button);
    });
    item.append(where, text, button);
    list.prepend(item);
    document.querySelector<HTMLElement>('.shelf[data-shelf="questions"] .empty-shelf')?.remove();
  }
}

interface SearchResults {
  items: {
    id: string;
    slug: string;
    title: string;
    author_name: string;
    parts_cost_text: string;
  }[];
  total: number;
  next_cursor: string | null;
}

export function startSearch(data: { results: SearchResults; q: string; tags: string[] }): void {
  trackViewportHeight();
  const status = new Status('Search status');
  const box = byLabel<HTMLInputElement>('Search guides');
  const tagBox = byLabel<HTMLInputElement>('Filter by tag');
  const list = need<HTMLElement>('.search-results');
  const chips = need<HTMLElement>('.tag-chips');
  const loadMore = byLabel<HTMLElement>('Load more');
  const count = wholeFigure(
    document.querySelector<HTMLElement>('[data-figure="result-count"]'),
    data.results.total,
  );
  const delay = new Delay();
  let tags = [...data.tags];
  let cursor = data.results.next_cursor;
  let suggestions: string[] = [];
  let highlighted = -1;

  function addressFor(): string {
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('tag');
    if ((box?.value ?? '').length > 0) url.searchParams.set('q', box?.value ?? '');
    for (const tag of tags) url.searchParams.append('tag', tag);
    return url.toString();
  }

  function renderChips(): void {
    chips.replaceChildren(
      ...tags.map((label) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.setAttribute('data-tag', label);
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `Remove tag ${label}`);
        button.textContent = 'Remove';
        button.addEventListener('click', () => {
          tags = tags.filter((candidate) => candidate !== label);
          renderChips();
          void run(true);
        });
        chip.append(document.createTextNode(label), button);
        return chip;
      }),
    );
  }

  function renderResults(results: SearchResults, append: boolean): void {
    const rows = results.items.map((item) => {
      const row = document.createElement('li');
      row.className = 'type-row';
      row.setAttribute('data-result', item.id);
      const link = document.createElement('a');
      link.href = `/g/${item.slug}`;
      link.textContent = item.title;
      const author = document.createElement('span');
      author.className = 'row-note';
      author.textContent = item.author_name;
      const cost = document.createElement('span');
      cost.className = 'row-note';
      cost.textContent = item.parts_cost_text;
      row.append(link, author, cost);
      return row;
    });
    if (append) list.append(...rows);
    else list.replaceChildren(...rows);
    count.setAtOnce(results.total);
    status.say(results.total === 0 ? searchStatus.none : searchStatus.found(results.total));
    cursor = results.next_cursor;
    if (loadMore !== null) loadMore.hidden = cursor === null;
  }

  async function run(immediate: boolean): Promise<void> {
    window.history.replaceState({}, '', addressFor());
    status.say(searchStatus.searching);
    const url = new URL('/api/search', window.location.origin);
    if ((box?.value ?? '').length > 0) url.searchParams.set('q', box?.value ?? '');
    for (const tag of tags) url.searchParams.append('tag', tag);
    const reply = await call<SearchResults & { error?: string; limit?: number }>(
      'GET',
      `${url.pathname}${url.search}`,
    );
    if (reply.status === 422) {
      status.say(
        reply.body.error === 'query_too_long'
          ? searchStatus.queryOverLimit(reply.body.limit ?? 0)
          : searchStatus.tagsOverLimit(reply.body.limit ?? 0),
      );
      return;
    }
    if (reply.status === 503) {
      status.say(searchStatus.timeout);
      return;
    }
    if (reply.status !== 200) return;
    renderResults(reply.body, false);
    if (immediate) return;
  }

  box?.addEventListener('input', () => {
    delay.schedule(MOTION.searchDelay, () => void run(false));
  });

  tagBox?.addEventListener('input', () => {
    void (async () => {
      const reply = await call<{ items: string[] }>(
        'GET',
        `/api/tags?prefix=${encodeURIComponent(tagBox.value)}`,
      );
      suggestions = reply.status === 200 ? reply.body.items : [];
      highlighted = -1;
      tagBox.setAttribute('aria-expanded', suggestions.length > 0 ? 'true' : 'false');
    })();
  });

  tagBox?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(suggestions.length - 1, highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = highlighted >= 0 ? suggestions[highlighted] : tagBox.value.trim();
      if (chosen === undefined || chosen.length === 0) return;
      if (!tags.includes(chosen)) tags.push(chosen);
      tagBox.value = '';
      suggestions = [];
      highlighted = -1;
      tagBox.setAttribute('aria-expanded', 'false');
      renderChips();
      void run(true);
    } else if (event.key === 'Backspace' && tagBox.value.length === 0 && tags.length > 0) {
      event.preventDefault();
      tags = tags.slice(0, -1);
      renderChips();
      void run(true);
    }
  });

  loadMore?.addEventListener('click', () => {
    if (cursor === null) return;
    void (async () => {
      const url = new URL('/api/search', window.location.origin);
      if ((box?.value ?? '').length > 0) url.searchParams.set('q', box?.value ?? '');
      for (const tag of tags) url.searchParams.append('tag', tag);
      url.searchParams.set('cursor', cursor);
      const reply = await call<SearchResults>('GET', `${url.pathname}${url.search}`);
      if (reply.status === 200) renderResults(reply.body, true);
    })();
  });

  renderChips();
}

interface CollectionData {
  collection: { id: string; slug: string; items: { guide_id: string; title: string }[] };
  owner: boolean;
}

export function startCollection(data: CollectionData): void {
  trackViewportHeight();
  const status = new Status('Collection status');
  if (!data.owner) return;
  const list = need<HTMLElement>('.collection-rows');

  list.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-guide]');
    if (row === null || row === undefined) return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>('[data-guide]')];
    const index = rows.indexOf(row);
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    const title = row.textContent ?? '';
    if (target < 0) {
      status.say(collectionStatus.alreadyFirst(title));
      return;
    }
    if (target >= rows.length) {
      status.say(collectionStatus.alreadyLast(title));
      return;
    }
    void (async () => {
      const reply = await call(
        'POST',
        `/api/collections/${data.collection.id}/items/${row.getAttribute('data-guide')}/move`,
        { position: target + 1 },
      );
      if (reply.status !== 200) return;
      const sibling = rows[target];
      if (sibling === undefined) return;
      if (event.key === 'ArrowUp') list.insertBefore(row, sibling);
      else list.insertBefore(sibling, row);
      row.focus();
      status.say(collectionStatus.moved(title, target + 1));
    })();
  });
}

interface AuthData {
  page: string;
  next: string;
  viewer: SessionUser | null;
}

export function startAuth(data: AuthData): void {
  trackViewportHeight();
  const status = new Status('Account status');
  const email = byLabel<HTMLInputElement>('Email');
  const password = byLabel<HTMLInputElement>('Password');
  const name = byLabel<HTMLInputElement>('Name');

  byLabel<HTMLElement>('Sign in')?.addEventListener('click', () => {
    void (async () => {
      const reply = await call<{ error?: string }>('POST', '/api/session', {
        email: email?.value ?? '',
        password: password?.value ?? '',
      });
      if (reply.status === 200) {
        window.location.href = data.next;
        return;
      }
      if (reply.status === 429) status.say(accountStatus.signInLimited(reply.retryAfter));
      else status.say(accountStatus.badSignIn);
    })();
  });

  byLabel<HTMLElement>('Sign up')?.addEventListener('click', () => {
    void (async () => {
      const reply = await call<{ error?: string; user?: SessionUser }>('POST', '/api/accounts', {
        name: name?.value ?? '',
        email: email?.value ?? '',
        password: password?.value ?? '',
      });
      if (reply.status === 201) {
        window.location.href = '/confirm?sent=1';
        return;
      }
      if (reply.status === 503) {
        window.location.href = '/confirm?mail=failed';
        return;
      }
      if (reply.status === 409) status.say(accountStatus.emailTaken);
      else status.say(accountStatus.badSignIn);
    })();
  });

  byLabel<HTMLElement>('Send a new link')?.addEventListener('click', () => {
    if (data.viewer === null) {
      window.location.href = '/signin?next=/confirm';
      return;
    }
    void (async () => {
      const reply = await call<{ error?: string }>('POST', '/api/account/resend', {});
      if (reply.status === 200) status.say(accountStatus.waiting(data.viewer?.email ?? ''));
      else if (reply.status === 409) status.say(accountStatus.confirmed);
      else if (reply.status === 429) status.say(accountStatus.resendLimited(reply.retryAfter));
      else status.say(accountStatus.mailFailed);
    })();
  });

}
