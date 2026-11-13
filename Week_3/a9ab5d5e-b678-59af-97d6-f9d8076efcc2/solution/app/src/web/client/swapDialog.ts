import { ApiFailure, Me, api, householdPath, newIdempotencyKey } from './api';
import { registerDialogSnapshot, say } from './app';
import { openModal } from './dialogs';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from './dom';
import { formatDmy, nextDayOf, parseDmy } from '../../lib/format';

interface SwapFields {
  firstNight: string;
  lastNight: string;
  makeupFirstNight: string;
  makeupLastNight: string;
  toParent: string;
  note: string;
}

const DATE_MESSAGE = 'Enter a real date as DD/MM/YYYY.';

export function openSwapDialog(options: {
  me: Me;
  opener: HTMLElement | null;
  firstNight?: string | null;
  values?: Partial<SwapFields>;
  onSent?: () => void;
}): void {
  const me = options.me;
  const firstNight = textbox('First night', {
    value: options.values?.firstNight ?? (options.firstNight ? formatDmy(options.firstNight) : ''),
  });
  const lastNight = textbox('Last night', { value: options.values?.lastNight ?? '' });
  const makeupFirst = textbox('Make-up first night', { value: options.values?.makeupFirstNight ?? '' });
  const makeupLast = textbox('Make-up last night', { value: options.values?.makeupLastNight ?? '' });
  const note = textbox('Note', { value: options.values?.note ?? '' });
  const planningRadio = el('input', { type: 'radio', name: 'who-has', value: 'planning' });
  const otherRadio = el('input', { type: 'radio', name: 'who-has', value: 'other' });
  if ((options.values?.toParent ?? 'other') === 'planning') planningRadio.checked = true;
  else otherRadio.checked = true;
  const who = el('div', { role: 'radiogroup', 'aria-label': 'Who has the child', class: 'radiogroup' }, [
    el('label', { class: 'radio' }, [planningRadio, el('span', { text: me.household.planningName })]),
    el('label', { class: 'radio' }, [otherRadio, el('span', { text: me.household.otherName })]),
  ]);
  const saveDraft = el('button', { type: 'button', class: 'plain-button', text: 'Save draft' });
  const sendRequest = el('button', { type: 'button', class: 'pill', text: 'Send request' });
  const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel' });

  const modal = openModal({
    title: 'Request a swap',
    content: [
      labelled('First night', firstNight),
      labelled('Last night', lastNight),
      labelled('Make-up first night', makeupFirst),
      labelled('Make-up last night', makeupLast),
      who,
      labelled('Note', note),
    ],
    actions: [saveDraft, sendRequest, cancel],
    opener: options.opener,
    onClose: () => registerDialogSnapshot(null),
  });

  registerDialogSnapshot(() => ({
    kind: 'swap',
    values: {
      firstNight: firstNight.value,
      lastNight: lastNight.value,
      makeupFirstNight: makeupFirst.value,
      makeupLastNight: makeupLast.value,
      toParent: planningRadio.checked ? 'planning' : 'other',
      note: note.value,
    },
  }));

  cancel.addEventListener('click', () => modal.close());
  saveDraft.addEventListener('click', () => {
    if (!isPending(saveDraft)) void submit(false);
  });
  sendRequest.addEventListener('click', () => {
    if (!isPending(sendRequest)) void submit(true);
  });

  function clearErrors(): void {
    for (const control of [firstNight, lastNight, makeupFirst, makeupLast, note]) fieldError(control, null);
    modal.showAlert(null);
  }

  function readBody(): { nights: string; makeupNights: string | null; toParent: string; note: string | null } | null {
    const first = parseDmy(firstNight.value);
    const last = parseDmy(lastNight.value);
    if (!first) {
      fieldError(firstNight, DATE_MESSAGE);
      modal.showAlert(DATE_MESSAGE);
      firstNight.focus();
      return null;
    }
    if (!last) {
      fieldError(lastNight, DATE_MESSAGE);
      modal.showAlert(DATE_MESSAGE);
      lastNight.focus();
      return null;
    }
    let makeupNights: string | null = null;
    if (makeupFirst.value.trim() !== '' || makeupLast.value.trim() !== '') {
      const makeupStart = parseDmy(makeupFirst.value);
      const makeupEnd = parseDmy(makeupLast.value);
      if (!makeupStart) {
        fieldError(makeupFirst, DATE_MESSAGE);
        modal.showAlert(DATE_MESSAGE);
        makeupFirst.focus();
        return null;
      }
      if (!makeupEnd) {
        fieldError(makeupLast, DATE_MESSAGE);
        modal.showAlert(DATE_MESSAGE);
        makeupLast.focus();
        return null;
      }
      makeupNights = `${makeupStart}/${nextDayOf(makeupEnd)}`;
    }
    return {
      nights: `${first}/${nextDayOf(last)}`,
      makeupNights,
      toParent: planningRadio.checked ? 'planning' : 'other',
      note: note.value.trim() === '' ? null : note.value,
    };
  }

  const fieldControls: Record<string, HTMLElement> = {
    nights: firstNight,
    makeupNights: makeupFirst,
    note,
    toParent: planningRadio,
  };

  function showFailure(error: ApiFailure): void {
    if (error.code === 'swap_overlaps') {
      modal.showAlert('Those nights are already in another request.');
      say('Those nights are already in another request.');
      return;
    }
    if (error.code === 'swap_run_too_long' || error.code === 'swap_nights_changed') {
      const message = error.field('nights') ?? error.problem.title;
      modal.showAlert(message);
      say(message);
      return;
    }
    const field = error.firstFieldError;
    if (field) {
      const control = fieldControls[field.field];
      if (control) {
        fieldError(control, field.message);
        control.focus();
      }
      modal.showAlert(field.message);
      say(field.message);
      return;
    }
    modal.showAlert(error.problem.title);
    say(error.problem.title);
  }

  async function submit(send: boolean): Promise<void> {
    clearErrors();
    const body = readBody();
    if (!body) return;
    const button = send ? sendRequest : saveDraft;
    pendingButton(button, true, send ? 'Sending...' : 'Saving...');
    try {
      const created = await api<{ id: string }>('POST', householdPath('/swaps'), {
        json: body,
        idempotencyKey: newIdempotencyKey(),
      });
      if (!send) {
        say('Draft saved.');
        modal.close();
        options.onSent?.();
        return;
      }
      await api('POST', householdPath(`/swaps/${created.data.id}/send`), {
        ifMatch: created.etag ?? undefined,
        idempotencyKey: newIdempotencyKey(),
      });
      say('Request sent. An email notice is on its way.');
      modal.close();
      options.onSent?.();
    } catch (error) {
      if (error instanceof ApiFailure) showFailure(error);
    } finally {
      pendingButton(button, false, '');
    }
  }
}
