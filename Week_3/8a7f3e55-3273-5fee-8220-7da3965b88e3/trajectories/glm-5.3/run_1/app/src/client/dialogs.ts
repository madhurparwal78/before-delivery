// The app's dialogs: New request, Assign interpreter, Complete assignment, Cancel booking,
// Withdraw/Release confirmations and Sign in to continue. Dialogs trap Tab, close on Escape
// except while pending, and hand focus back to the opener.
import type { Booking, InterpreterChoice, QuoteInfo, MaterialInfo } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError, errorCopyFor } from './shell.js';
import { ApiFailure, NetworkFailure, newIdempotencyKey } from './api.js';
import { h, focusNode, focusable, trapTab, countCodePoints, formatCents } from './dom.js';
import { ERROR_COPY, PENDING_COPY, SUCCESS_COPY, quoteCopy } from './copy.js';
import { TEXT_LIMITS, FIELD_MESSAGES, STATUS_LABELS } from '../shared/terms.js';

interface DialogHandle {
  close: () => void;
  root: HTMLElement;
}

const openDialogs: DialogHandle[] = [];

/** Close the topmost dialog without acting. */
function escapeTop(): void {
  const top = openDialogs[openDialogs.length - 1];
  if (top) top.close();
}

/** A dialog host with the published sizes: full viewport in compact, 480px centred otherwise. */
function openDialog(name: string, build: (root: HTMLElement, close: () => void) => void, opts: { onOpen?: () => void } = {}): DialogHandle {
  const backdrop = h('div', { class: 'dialog-backdrop' });
  const root = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': name });
  root.setAttribute('aria-label', name);
  backdrop.append(root);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const remove = () => {
      backdrop.remove();
      const index = openDialogs.findIndex((d) => d.root === root);
      if (index !== -1) openDialogs.splice(index, 1);
    };
    if (reduce) {
      remove();
    } else {
      root.classList.add('fading');
      setTimeout(remove, 150);
    }
  };
  build(root, close);
  trapTab(root, () => {
    // Escape closes the dialog; callers that must not close handle it in their own keydown.
    close();
    afterDialogClosed();
  });
  document.body.append(backdrop);
  openDialogs.push({ close, root });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('animating');
  }
  opts.onOpen?.();
  return { close, root };
}

/** After a dialog closes, focus returns to its opener if that still exists. */
function afterDialogClosed(): void {
  // Each dialog sets its own focus target; nothing to do by default.
}

function fieldMessage(key: string): string {
  return (FIELD_MESSAGES as Record<string, string>)[key] ?? 'Check this field.';
}

// ---------- New request ----------

export interface NewRequestResult {
  (booking: Booking): void;
}

export async function openNewRequestDialog(onCreated: (booking: Booking) => void): Promise<void> {
  let idemKey = newIdempotencyKey();
  const contracts = await api.call<{ contracts: Array<{ id: string; org_name: string }> }>('/api/contracts');
  const handle = openDialog('New request', (root, close) => {
    const form = h('form', {});
    const fields: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
    const errors: Record<string, HTMLElement> = {};
    const hints: Record<string, HTMLElement> = {};

    const addField = (
      key: string, label: string, kind: 'text' | 'date' | 'time' | 'number' | 'textarea' | 'select',
      options?: { hint?: boolean; choices?: Array<[string, string]> },
    ) => {
      const wrap = h('div', {});
      const labelText = h('label', {}, label);
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (kind === 'textarea') {
        input = h('textarea', { 'aria-label': label }) as unknown as HTMLTextAreaElement;
      } else if (kind === 'select') {
        const select = h('select', { 'aria-label': label }) as unknown as HTMLSelectElement;
        for (const [value, text] of options?.choices ?? []) {
          select.append(h('option', { value }, text));
        }
        input = select;
      } else {
        input = h('input', { type: kind === 'number' ? 'number' : kind, 'aria-label': label }) as HTMLInputElement;
      }
      if (options?.hint) {
        input.id = `field-${key}`;
        labelText.setAttribute('for', `field-${key}`);
        const hint = h('div', { class: 'char-hint', id: `hint-${key}` });
        hints[key] = hint;
        input.setAttribute('aria-describedby', `hint-${key}`);
        wrap.append(labelText, input, hint);
      } else {
        wrap.append(labelText, input);
      }
      const error = h('div', { class: 'field-error', 'aria-live': 'polite' });
      errors[key] = error;
      wrap.append(error);
      fields[key] = input;
      form.append(wrap);
      return input;
    };

    if (app.me?.role === 'coordinator') {
      addField('org_id', 'Organisation', 'select', { choices: contracts.contracts.map((c) => [c.id, c.org_name]) });
    }
    addField('setting', 'Setting', 'select', {
      choices: [['medical', 'medical'], ['educational', 'educational'], ['legal', 'legal'], ['workplace', 'workplace']],
    });
    addField('title', 'Title', 'text', { hint: true });
    addField('location', 'Location', 'text');
    addField('onsite_contact_name', 'On-site contact name', 'text');
    addField('onsite_contact_phone', 'On-site contact phone', 'text');
    addField('consumer_name', 'Deaf consumer name', 'text');
    addField('start_date', 'Start date', 'date');
    addField('start_time', 'Start time', 'time');
    addField('duration_minutes', 'Length (minutes)', 'number');
    addField('requester_notes', 'Notes for the agency', 'textarea', { hint: true });

    const updateHint = (key: 'title' | 'requester_notes') => {
      const value = (fields[key] as HTMLInputElement | HTMLTextAreaElement).value;
      const limit = key === 'title' ? TEXT_LIMITS.title : TEXT_LIMITS.requester_notes;
      const count = countCodePoints(value);
      const thousands = count.toLocaleString('en-US');
      hints[key].textContent = `${thousands} of ${limit.toLocaleString('en-US')} characters`;
    };
    updateHint('title');
    updateHint('requester_notes');
    fields.title.addEventListener('input', () => updateHint('title'));
    fields.requester_notes.addEventListener('input', () => updateHint('requester_notes'));

    const closeButton = h('button', { type: 'button' }, 'Close');
    closeButton.addEventListener('click', () => {
      close();
      focusOpener();
    });
    const submit = h('button', { type: 'submit' }, 'Submit request');
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(submit, closeButton);
    form.append(actions);
    root.append(h('h2', {}, 'New request'), h('div', { class: 'dialog-copy' }, `Times in ${app.agency?.time_zone ?? ''}`), form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      for (const key of Object.keys(errors)) errors[key].textContent = '';
      const body = {
        setting: (fields.setting as HTMLSelectElement).value,
        title: (fields.title as HTMLInputElement).value,
        location: (fields.location as HTMLInputElement).value,
        onsite_contact_name: (fields.onsite_contact_name as HTMLInputElement).value,
        onsite_contact_phone: (fields.onsite_contact_phone as HTMLInputElement).value,
        consumer_name: (fields.consumer_name as HTMLInputElement).value,
        start: `${(fields.start_date as HTMLInputElement).value}T${(fields.start_time as HTMLInputElement).value}`,
        duration_minutes: Number((fields.duration_minutes as HTMLInputElement).value),
        requester_notes: (fields.requester_notes as HTMLTextAreaElement).value,
        ...(app.me?.role === 'coordinator' ? { org_id: (fields.org_id as HTMLSelectElement).value } : {}),
      };
      submit.disabled = true;
      submit.textContent = PENDING_COPY.submitRequest;
      announceStatus(PENDING_COPY.submitRequest);
      clearError();
      try {
        const created = await api.call<Booking>('/api/bookings', {
          method: 'POST',
          body,
          idempotencyKey: idemKey,
          tag: 'new-request',
        });
        announceStatus(SUCCESS_COPY.submitted(created.ref));
        close();
        onCreated(created);
        focusOpener();
      } catch (err) {
        submit.disabled = false;
        submit.textContent = 'Submit request';
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => { void submit.click(); });
          submit.disabled = true;
          submit.textContent = 'Submit request';
          return;
        }
        if (err instanceof ApiFailure && err.code === 'validation' && err.body.fields) {
          announceError(ERROR_COPY.validation);
          for (const [key, message] of Object.entries(err.body.fields)) {
            const mapped = mapFieldKey(key);
            if (errors[mapped]) errors[mapped].textContent = message;
          }
          const firstError = Object.entries(err.body.fields)
            .map(([key]) => mapFieldKey(key))
            .find((mapped) => fields[mapped]);
          if (firstError) fields[firstError].focus();
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          return;
        }
        announceError(ERROR_COPY.network);
      }
    });
  });
  const opener = document.activeElement as HTMLElement | null;
  const focusOpener = () => {
    if (opener && document.contains(opener)) opener.focus();
    else focusNode(handle.root);
  };
  focusable(handle.root)[0]?.focus();
}

function mapFieldKey(key: string): string {
  if (key === 'start') return 'start_date';
  return key;
}

// ---------- Assign interpreter ----------

export async function openAssignDialog(bookingId: string, seat: number, refresh: () => void | Promise<void>): Promise<void> {
  const handle = openDialog(`Assign interpreter`, (root, close) => {
    root.setAttribute('aria-label', `Assign interpreter seat ${seat}`);
    const status = h('div', { class: 'inline-status', role: 'status', 'aria-label': 'Assign status' }, '');
    const radios = h('div', { class: 'radios', role: 'radiogroup' });
    const searchWrap = h('div', {});
    const search = h('input', { type: 'search', 'aria-label': 'Find interpreter', class: 'search-box' }) as HTMLInputElement;
    const searchError = h('div', { class: 'field-error' });
    searchWrap.append(search, searchError);
    const closeButton = h('button', { type: 'button' }, 'Close');
    const assign = h('button', { type: 'button' }, 'Assign');
    assign.disabled = true;
    root.append(h('h2', {}, `Assign seat ${seat}`), searchWrap, radios, status);
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(assign, closeButton);
    root.append(actions);

    let chosen: string | null = null;
    let searchSeq = 0;
    let lastResults: InterpreterChoice[] = [];

    const refreshList = async () => {
      const q = search.value;
      const seq = ++searchSeq;
      if (countCodePoints(q) > TEXT_LIMITS.search_q) {
        searchError.textContent = FIELD_MESSAGES.q;
        radios.replaceChildren();
        assign.disabled = true;
        chosen = null;
        return;
      }
      searchError.textContent = '';
      try {
        const result = await api.call<{ interpreters: InterpreterChoice[] }>(
          `/api/interpreters?booking_id=${encodeURIComponent(bookingId)}&q=${encodeURIComponent(q)}`,
          { tag: 'assign-search' },
        );
        if (seq !== searchSeq) return; // an earlier search's answer is thrown away
        lastResults = result.interpreters;
        renderChoices();
      } catch {
        // The list stays as it is when the search cannot be answered.
      }
    };

    const renderChoices = () => {
      radios.replaceChildren();
      let firstEnabled: HTMLElement | null = null;
      if (lastResults.length === 0) {
        radios.append(h('div', { class: 'empty-row' }, `No interpreter matches "${search.value.trim()}".`));
      }
      for (const choice of lastResults) {
        const label = h('label', { class: 'radio-row' });
        const radio = h('input', { type: 'radio', name: 'interpreter', value: choice.id }) as HTMLInputElement;
        if (choice.id === chosen) radio.checked = true;
        if (choice.busy) {
          radio.disabled = true;
          radio.checked = false;
        }
        if (choice.id === chosen && choice.busy) chosen = null;
        label.append(radio, h('span', {}, choice.name));
        const creds = choice.credentials.map((c) => c.code).join(', ');
        label.append(h('span', { class: 'credentials' }, creds));
        if (choice.busy) label.append(h('span', { class: 'busy-note' }, 'Busy at this time'));
        radio.addEventListener('change', () => {
          chosen = choice.id;
          assign.disabled = false;
        });
        radios.append(label);
        if (!choice.busy && firstEnabled === null) firstEnabled = radio;
      }
      if (chosen === null) assign.disabled = true;
      if (chosen !== null && !lastResults.some((c) => c.id === chosen)) {
        chosen = null;
        assign.disabled = true;
      }
      if (firstEnabled) firstEnabled.focus();
      else closeButton.focus();
    };

    let debounce: number | null = null;
    search.addEventListener('input', () => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = window.setTimeout(() => { void refreshList(); }, 300);
    });

    radios.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key !== 'ArrowDown' && keyboard.key !== 'ArrowUp') return;
      const inputs = Array.from(radios.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      if (inputs.length === 0) return;
      const current = inputs.findIndex((input) => input.checked);
      const next = keyboard.key === 'ArrowDown'
        ? Math.min(current + 1, inputs.length - 1)
        : Math.max(current - 1, 0);
      inputs.forEach((input, index) => { input.checked = index === next; });
      chosen = inputs[next].value;
      assign.disabled = false;
      inputs[next].focus();
      keyboard.preventDefault();
    });

    closeButton.addEventListener('click', () => {
      close();
      focusOpener();
    });

    assign.addEventListener('click', async () => {
      if (chosen === null) return;
      assign.disabled = true;
      assign.textContent = PENDING_COPY.assign;
      announceStatus(PENDING_COPY.assign);
      clearError();
      try {
        const updated = await api.call<Booking>(`/api/bookings/${bookingId}/assign`, {
          method: 'POST',
          body: { interpreter_id: chosen, seat },
          tag: 'assign',
        });
        const holderName = updated.seats.find((s) => s.seat === seat)?.holder?.name ?? '';
        announceStatus(SUCCESS_COPY.assign(holderName, seat, updated.ref));
        close();
        await refresh();
        focusSeatsHeading();
      } catch (err) {
        assign.textContent = 'Assign';
        assign.disabled = chosen === null;
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => assign.click());
          return;
        }
        if (err instanceof ApiFailure && (err.code === 'schedule_conflict' || err.code === 'not_qualified' || err.code === 'seat_filled' || err.code === 'already_holding')) {
          announceError(errorCopyFor(err));
          chosen = null;
          await refreshList();
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          return;
        }
        announceError(ERROR_COPY.network);
        assign.disabled = false;
      }
    });

    void refreshList();
  });
  const opener = document.activeElement as HTMLElement | null;
  const focusOpener = () => {
    if (opener && document.contains(opener)) opener.focus();
  };
  const focusSeatsHeading = () => {
    const heading = document.querySelector<HTMLElement>('section[aria-label="Seats"] h3');
    focusNode(heading);
  };
}

// ---------- Complete assignment ----------

export async function openCompleteDialog(booking: Booking, refresh: () => void | Promise<void>): Promise<void> {
  let idemKey = newIdempotencyKey();
  const handle = openDialog('Complete assignment', (root, close) => {
    const worked = h('input', { type: 'number', 'aria-label': 'Worked minutes', value: String(booking.duration_minutes) }) as HTMLInputElement;
    const mileage = h('input', { type: 'number', 'aria-label': 'Mileage (miles)', value: '0' }) as HTMLInputElement;
    const workedError = h('div', { class: 'field-error' });
    const mileageError = h('div', { class: 'field-error' });
    const closeButton = h('button', { type: 'button' }, 'Close');
    const submit = h('button', { type: 'submit' }, 'Record completion');
    const form = h('form', {});
    const wrapWorked = h('div', {});
    wrapWorked.append(h('label', {}, 'Worked minutes'), worked, workedError);
    const wrapMileage = h('div', {});
    wrapMileage.append(h('label', {}, 'Mileage (miles)'), mileage, mileageError);
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(submit, closeButton);
    form.append(wrapWorked, wrapMileage, actions);
    root.append(h('h2', {}, 'Complete assignment'), form);

    closeButton.addEventListener('click', () => { close(); focusOpener(); });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      workedError.textContent = '';
      mileageError.textContent = '';
      const body = { worked_minutes: Number(worked.value), mileage_miles: Number(mileage.value) };
      submit.disabled = true;
      submit.textContent = PENDING_COPY.recordCompletion;
      announceStatus(PENDING_COPY.recordCompletion);
      clearError();
      try {
        const updated = await api.call<Booking>(`/api/bookings/${booking.id}/complete`, {
          method: 'POST',
          body,
          idempotencyKey: idemKey,
          tag: 'complete',
        });
        const lineRef = updated.charge?.line_ref ?? '';
        announceStatus(SUCCESS_COPY.completed(booking.ref, lineRef));
        close();
        await refresh();
        focusOpener();
      } catch (err) {
        submit.disabled = false;
        submit.textContent = 'Record completion';
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => submit.click());
          return;
        }
        if (err instanceof ApiFailure && err.code === 'validation' && err.body.fields) {
          announceError(ERROR_COPY.validation);
          if (err.body.fields.worked_minutes) workedError.textContent = err.body.fields.worked_minutes;
          if (err.body.fields.mileage_miles) mileageError.textContent = err.body.fields.mileage_miles;
          (err.body.fields.worked_minutes ? worked : mileage).focus();
          return;
        }
        if (err instanceof ApiFailure && err.code === 'invalid_transition') {
          announceError(errorCopyFor(err));
          close();
          await refresh();
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          return;
        }
        announceError(ERROR_COPY.network);
      }
    });
    worked.addEventListener('input', () => { idemKey = newIdempotencyKey(); });
    mileage.addEventListener('input', () => { idemKey = newIdempotencyKey(); });
  });
  const opener = document.activeElement as HTMLElement | null;
  const focusOpener = () => {
    if (opener && document.contains(opener)) opener.focus();
  };
  focusNode(handle.root.querySelector('input'));
}

// ---------- Cancel booking ----------

export async function openCancelDialog(bookingId: string, refresh: () => void | Promise<void>): Promise<void> {
  // Each opening fetches its own quote; an answer that belongs to an earlier opening is
  // discarded and never shown.
  let openingSeq = ++cancelOpenings;
  const handle = openDialog('Cancel booking', (root, close) => {
    const quoteStatus = h('div', { class: 'inline-status', role: 'status', 'aria-label': 'Cancellation quote', tabindex: '-1' }, 'Checking the cancellation window…');
    const keep = h('button', { type: 'button' }, 'Keep booking');
    const confirm = h('button', { type: 'button' }, 'Checking the cancellation window…');
    confirm.disabled = true;
    let quote: QuoteInfo | null = null;
    let pending = false;
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(keep, confirm);
    root.append(h('h2', {}, 'Cancel booking'), quoteStatus, actions);

    const mySeq = openingSeq;
    const fetchQuote = async () => {
      try {
        const result = await api.call<QuoteInfo>(`/api/bookings/${bookingId}/cancellation-quote`, { tag: `cancel-quote-${mySeq}` });
        if (mySeq !== openingSeq) return; // an earlier opening's answer is discarded
        quote = result;
        quoteStatus.textContent = quoteCopy(result);
        confirm.textContent = 'Confirm cancellation';
        confirm.disabled = false;
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => { void fetchQuote(); });
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          close();
          return;
        }
        announceError(ERROR_COPY.network);
      }
    };
    void fetchQuote();

    keep.addEventListener('click', () => {
      close();
      focusOpener();
    });

    confirm.addEventListener('click', async () => {
      if (quote === null || pending) return;
      pending = true;
      confirm.disabled = true;
      confirm.textContent = PENDING_COPY.cancel;
      announceStatus(PENDING_COPY.cancel);
      clearError();
      try {
        const updated = await api.call<Booking>(`/api/bookings/${bookingId}/cancel`, {
          method: 'POST',
          body: { quoted_charge_cents: quote.charge_cents },
          tag: 'cancel',
        });
        const finalStatus = updated.status;
        if (finalStatus === 'cancelled_late') {
          announceStatus(SUCCESS_COPY.cancelledWithCharge(updated.ref, quote.charge_cents));
        } else {
          announceStatus(SUCCESS_COPY.cancelledNoCharge(updated.ref));
        }
        close();
        await refresh();
        focusDetailHeading();
      } catch (err) {
        pending = false;
        confirm.textContent = 'Confirm cancellation';
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => confirm.click());
          return;
        }
        if (err instanceof ApiFailure && err.code === 'quote_changed' && err.body.quote) {
          quote = err.body.quote;
          quoteStatus.textContent = quoteCopy(quote);
          confirm.textContent = 'Confirm new charge';
          confirm.disabled = false;
          quoteStatus.focus();
          announceError(ERROR_COPY.quote_changed);
          return;
        }
        if (err instanceof ApiFailure && err.code === 'invalid_transition') {
          announceError(errorCopyFor(err));
          close();
          await refresh();
          focusDetailHeading();
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          confirm.disabled = false;
          return;
        }
        announceError(ERROR_COPY.network);
        confirm.disabled = false;
      }
    });
  });
  const opener = document.activeElement as HTMLElement | null;
  const focusOpener = () => {
    if (opener && document.contains(opener)) opener.focus();
  };
  const focusDetailHeading = () => {
    const heading = document.querySelector<HTMLElement>('section[aria-label="Assignment detail"] h2');
    focusNode(heading);
  };
  keepFocusFirst(handle.root);
}

let cancelOpenings = 0;

function keepFocusFirst(root: HTMLElement): void {
  focusable(root)[0]?.focus();
}

// ---------- Withdraw / Release ----------

export async function openReleaseDialog(bookingId: string, seat: number, holderName: string | null, refresh: () => void | Promise<void>, opts: { interpreter?: boolean } = {}): Promise<void> {
  const isInterpreter = opts.interpreter ?? false;
  const name = `Release seat ${seat}`;
  const handle = openDialog(isInterpreter ? 'Withdraw from assignment' : name, (root, close) => {
    const copy = isInterpreter
      ? `You will stop holding seat ${seat} on ${bookingId}.`
      : `${holderName ?? 'The interpreter'} will stop holding seat ${seat} on ${bookingId}.`;
    const keepBtn = h('button', { type: 'button' }, isInterpreter ? 'Keep seat' : 'Keep holder');
    const confirm = h('button', { type: 'button' }, isInterpreter ? 'Confirm withdrawal' : 'Confirm release');
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(keepBtn, confirm);
    root.append(h('h2', {}, isInterpreter ? 'Withdraw from assignment' : `Release seat ${seat}`), h('p', { class: 'dialog-copy' }, copy), actions);

    keepBtn.addEventListener('click', () => {
      close();
      focusOpener();
    });

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      confirm.textContent = PENDING_COPY.release;
      announceStatus(PENDING_COPY.release);
      clearError();
      try {
        const updated = await api.call<Booking>(`/api/bookings/${bookingId}/seats/${seat}/release`, {
          method: 'POST',
          tag: 'release',
        });
        announceStatus(SUCCESS_COPY.release(seat, updated.ref));
        close();
        await refresh();
        if (isInterpreter) {
          focusListFirstRow();
        } else {
          const heading = document.querySelector<HTMLElement>('section[aria-label="Seats"] h3');
          focusNode(heading);
        }
      } catch (err) {
        confirm.disabled = false;
        confirm.textContent = isInterpreter ? 'Confirm withdrawal' : 'Confirm release';
        if (err instanceof ApiFailure && err.code === 'unauthenticated') {
          void openSessionDialog(err, () => confirm.click());
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          return;
        }
        announceError(ERROR_COPY.network);
      }
    });
  });
  const opener = document.activeElement as HTMLElement | null;
  const focusOpener = () => {
    if (opener && document.contains(opener)) opener.focus();
  };
  focusNode(handle.root.querySelector('button'));
}

function focusListFirstRow(): void {
  const firstRow = document.querySelector<HTMLElement>('.list-pane .row');
  if (firstRow) {
    firstRow.focus();
    return;
  }
  const region = document.querySelector<HTMLElement>('[aria-label="Open calls"]');
  focusNode(region);
}

// ---------- Sign in to continue ----------

export async function openSessionDialog(err: ApiFailure, resend: () => void): Promise<void> {
  const email = app.me?.email ?? '';
  const handle = openDialog('Sign in to continue', (root, close) => {
    const copy = 'Your session has ended. Sign in again to finish this action.';
    const password = h('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
    const signIn = h('button', { type: 'button' }, 'Sign in and continue');
    const signOut = h('button', { type: 'button' }, 'Sign out');
    const actions = h('div', { class: 'dialog-actions' });
    actions.append(signIn, signOut);
    root.append(h('h2', {}, 'Sign in to continue'), h('p', { class: 'dialog-copy' }, copy), h('div', {}, email), password, actions);
    password.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        signIn.click();
      }
    });
    let pending = false;
    signIn.addEventListener('click', async () => {
      if (pending) return;
      pending = true;
      clearError();
      try {
        await api.call('/api/session', { method: 'POST', body: { email, password: password.value }, tag: 're-session' });
        close();
        resend();
      } catch (failure) {
        pending = false;
        if (failure instanceof ApiFailure && failure.code === 'invalid_credentials') {
          announceError(errorCopyFor(failure));
          password.value = '';
          password.focus();
          return;
        }
        if (failure instanceof NetworkFailure) {
          announceError(ERROR_COPY.network);
          return;
        }
        if (failure instanceof ApiFailure) {
          announceError(errorCopyFor(failure));
        }
      }
    });
    signOut.addEventListener('click', async () => {
      try {
        await api.call('/api/session', { method: 'DELETE' });
      } catch {
        // The cookie is no longer usable either way.
      }
      app.me = null;
      window.history.replaceState(null, '', '/');
      close();
      const { renderHome } = await import('./shell.js');
      renderHome();
    });
    password.focus();
    // Escape does nothing in this dialog.
    root.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') event.stopPropagation();
    });
  }, { onOpen: () => { /* focus handled inside */ } });
  void handle;
}
