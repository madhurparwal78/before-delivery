import type { FormDetail } from '../../shared/types.ts';
import { M48, M49, M42 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import { alertText, announce } from '../lib/live.ts';
import { fieldError, selectField, textField } from './field.ts';
import type { Context } from './context.ts';

// Form settings: closing time, response limit, closed message, who gets a copy, and closing or reopening the form.

type Result = { state: FormDetail['state']; closed_reason: FormDetail['closed_reason'] };

export function openSettings({ store }: Context, opener: HTMLElement): void {
  const { settings } = store.detail;
  const rev = (): number => store.rev;
  const closes = textField({ name: 'Closing time', rev });
  const limit = textField({ name: 'Response limit', rev });
  const message = textField({ name: 'Closed message', rev, multiline: true });
  const copy = selectField('Send a copy to', [], () => undefined);
  closes.input.value = settings.closes_at?.replace('T', ' ') ?? '';
  limit.input.value = settings.response_limit === null ? '' : String(settings.response_limit);
  message.input.value = settings.closed_message ?? '';
  const emailQuestions = store.questions().filter((q) => (q.type === 'short_text' || q.type === 'long_text') && q.pattern === 'email');
  copy.setChoices([{ value: '', label: '' }, ...emailQuestions.map((q) => ({ value: q.key, label: q.label }))]);
  copy.select.value = settings.copy_to ?? '';

  const closeNow = h('button', { type: 'button' }, 'Close now');
  const reopen = h('button', { type: 'button' }, 'Reopen form');
  const save = h('button', { type: 'button' }, 'Save settings');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const problem = h('p', { class: 'error-text', hidden: true });
  const dialog = dialogShell('Form settings', closes.element, limit.element, message.element, copy.element, problem,
    h('div', { class: 'dialog-actions' }, save, closeNow, reopen, cancel));
  const open = openDialog(dialog, opener, { onClose: () => stopListening() });
  const stopListening = store.detailed.listen(() => available());
  available();

  function available(): void {
    const { state } = store.detail;
    closeNow.toggleAttribute('disabled', state !== 'open');
    reopen.toggleAttribute('disabled', state !== 'closed');
  }

  function refuse(error: ApiFailure): void {
    alertText(error.message);
    const fields: Record<string, [HTMLElement, HTMLElement]> = {
      closes_at: [closes.element, closes.input], response_limit: [limit.element, limit.input], copy_to: [copy.element, copy.select],
    };
    let beside = false;
    for (const [key, [field, control]] of Object.entries(fields)) {
      const item = error.items.find((candidate) => candidate.key === key);
      fieldError(field, control, item?.message ?? null);
      beside ||= item !== undefined;
    }
    problem.hidden = beside;
    problem.textContent = error.message;
  }

  async function act<T>(request: Promise<T>, done: (result: T) => void): Promise<void> {
    try {
      const result = await request;
      problem.hidden = true;
      done(result);
      open.close();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      refuse(error);
    }
  }

  const path = `/api/forms/${store.detail.id}`;
  save.addEventListener('click', () => {
    const body = {
      closes_at: closes.value().trim() || null,
      response_limit: limit.value().trim() || null,
      closed_message: message.value().trim() || null,
      copy_to: copy.select.value || null,
    };
    void act(api<Result & { settings: FormDetail['settings'] }>('PUT', `${path}/settings`, body), (result) => {
      store.updateState({ state: result.state, closed_reason: result.closed_reason, settings: result.settings });
      announce(M48);
    });
  });
  closeNow.addEventListener('click', () => {
    void act(api<Result>('POST', `${path}/close`, {}), (result) => {
      store.updateState({ state: result.state, closed_reason: result.closed_reason });
      announce(M49);
    });
  });
  reopen.addEventListener('click', () => {
    void act(api<{ state: 'open'; edition: number }>('POST', `${path}/reopen`, {}), (result) => {
      store.updateState({ state: result.state, closed_reason: null, edition: result.edition });
      announce(M42(result.edition));
    });
  });
  cancel.addEventListener('click', () => open.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      save.click();
    }
  });
}
