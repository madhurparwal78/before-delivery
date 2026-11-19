import { ApiFailure, del, get, post, put, readLimits } from '../api';
import { askStatus, collectionStatus, guideStatus } from '../../shared/copy';
import type { GuideReading, Question, User } from '../../shared/types';
import { dialogButtons, openDialog } from '../dialog';
import { h } from '../dom';
import { goToSignIn } from '../nav';
import type { Status } from '../status';

export interface ActionContext {
  guide: GuideReading;
  user: User | null;
  currentStep(): number;
  guideStatus: Status;
  collectionStatus: Status;
  resend: HTMLButtonElement;
  onAsked(question: Question): void;
  setLiked(liked: boolean): void;
}

function refuse(context: ActionContext, error: unknown): void {
  if (error instanceof ApiFailure && error.code === 'unconfirmed') {
    context.guideStatus.set(guideStatus.unconfirmed, 'error');
    context.resend.hidden = false;
    return;
  }
  context.guideStatus.set(guideStatus.failure, 'error');
}

/** Actions that need a session send a signed-out reader to sign in and back to this exact path. */
function needsSession(context: ActionContext): boolean {
  if (context.user) return false;
  goToSignIn();
  return true;
}

export async function toggleLike(context: ActionContext, button: HTMLButtonElement): Promise<void> {
  if (needsSession(context)) return;
  const liked = button.getAttribute('aria-pressed') === 'true';
  try {
    if (liked) await del(`/api/guides/${context.guide.id}/like`);
    else await put(`/api/guides/${context.guide.id}/like`);
    context.setLiked(!liked);
    context.guideStatus.set(liked ? guideStatus.likeRemoved : guideStatus.liked);
  } catch (error) {
    refuse(context, error);
  }
}

export function forkDialog(context: ActionContext): void {
  if (needsSession(context)) return;
  if (!context.user?.confirmed) return refuse(context, new ApiFailure(403, { error: 'unconfirmed' }, 0));
  const confirm = h('button', { type: 'button', class: 'button' }, `Fork version ${context.guide.published_version}`);
  const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
  const dialog = openDialog('Fork guide', [
    h('h2', {}, 'Fork guide'),
    h('p', {}, 'You get your own copy to adapt. It credits this guide and its author, and later changes here never touch it.'),
    dialogButtons(confirm, cancel),
  ]);
  cancel.addEventListener('click', dialog.close);
  confirm.addEventListener('click', async () => {
    context.guideStatus.set(guideStatus.forking);
    try {
      const fork = await post<{ slug: string }>(`/api/guides/${context.guide.id}/forks`);
      location.assign(`/edit/${fork.slug}`);
    } catch (error) {
      dialog.close();
      refuse(context, error);
    }
  });
}

export async function collectionDialog(context: ActionContext): Promise<void> {
  if (needsSession(context)) return;
  if (!context.user?.confirmed) return refuse(context, new ApiFailure(403, { error: 'unconfirmed' }, 0));
  const { collections } = await get<{ collections: { id: string; title: string }[] }>('/api/dashboard');
  const select = h('select', { id: 'collection-choice', class: 'field-input' },
    ...collections.map((c) => h('option', { value: c.id }, c.title)));
  const fresh = h('input', { id: 'collection-new', class: 'field-input', type: 'text', autocomplete: 'off' });
  const add = h('button', { type: 'button', class: 'button' }, 'Add');
  const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
  const notice = h('p', { class: 'status', role: 'status', 'aria-label': 'Add status' });
  const dialog = openDialog('Add to collection', [
    h('h2', {}, 'Add to collection'),
    h('div', { class: 'form' },
      h('label', { class: 'cell', for: 'collection-choice' }, h('span', { class: 'cell-label' }, 'Collection'), select),
      h('label', { class: 'cell', for: 'collection-new' }, h('span', { class: 'cell-label' }, 'New collection title'), fresh)),
    notice,
    dialogButtons(add, cancel),
  ]);
  select.setAttribute('aria-label', 'Collection');
  cancel.addEventListener('click', dialog.close);
  add.addEventListener('click', async () => {
    try {
      const title = fresh.value.trim();
      const target = title
        ? await post<{ id: string; title: string }>('/api/collections', { title, visibility: 'public' })
        : collections.find((c) => c.id === select.value);
      if (!target) return void (notice.textContent = guideStatus.failure);
      await post(`/api/collections/${target.id}/items`, { guide_id: context.guide.id });
      dialog.close();
      context.collectionStatus.set(collectionStatus.added(target.title));
    } catch (error) {
      notice.textContent = error instanceof ApiFailure && error.code === 'already_in_collection' ? collectionStatus.already : guideStatus.failure;
    }
  });
}

export async function askDialog(context: ActionContext): Promise<void> {
  if (needsSession(context)) return;
  if (!context.user?.confirmed) return refuse(context, new ApiFailure(403, { error: 'unconfirmed' }, 0));
  const limits = await readLimits();
  const step = context.currentStep();
  const text = h('textarea', { id: 'question-text', class: 'field-input', rows: 4 });
  const status = h('p', { class: 'status', role: 'status', 'aria-label': 'Ask status', 'data-tone': 'info' });
  const send = h('button', { type: 'button', class: 'button' }, 'Send question');
  const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
  const dialog = openDialog('Ask the author', [
    h('h2', {}, 'Ask the author'),
    h('p', {}, `Asking about step ${step}`),
    h('label', { class: 'cell', for: 'question-text' }, h('span', { class: 'cell-label' }, 'Your question'), text),
    status,
    dialogButtons(send, cancel),
  ]);
  const say = (message: string, tone: 'info' | 'error' = 'error') => {
    status.textContent = message;
    status.dataset.tone = tone;
  };
  cancel.addEventListener('click', dialog.close);
  send.addEventListener('click', async () => {
    say(askStatus.sending, 'info');
    try {
      const asked = await post<Question>(`/api/guides/${context.guide.id}/questions`, { step, text: text.value });
      dialog.close();
      context.guideStatus.set(guideStatus.questionSent);
      context.onAsked(asked);
    } catch (error) {
      if (!(error instanceof ApiFailure)) return say(guideStatus.failure);
      if (error.code === 'rate_limited') say(askStatus.rateLimited(error.retryAfter));
      else if (error.code === 'too_long') say(askStatus.tooLong(Number(error.body.limit ?? limits.question_text_max)));
      else if (error.code === 'invalid') say(askStatus.empty);
      else say(guideStatus.failure);
    }
  });
}

export async function resendConfirmation(context: ActionContext): Promise<void> {
  try {
    await post('/api/account/resend');
    context.guideStatus.set(guideStatus.resent(context.user?.email ?? ''));
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'rate_limited') context.guideStatus.set(guideStatus.resendLimited(error.retryAfter), 'error');
    else context.guideStatus.set(guideStatus.failure, 'error');
  }
}

