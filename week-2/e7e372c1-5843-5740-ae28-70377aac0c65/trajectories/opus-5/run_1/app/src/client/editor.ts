/** The restatement editor, its dialogs and its audit trail. */
import {
  ApiResult,
  clearRestatement,
  getAudit,
  getBoard,
  getRestatement,
  patchRestatement,
  postSession,
  releaseRestatement,
  returnRestatement,
  sha256Of,
  submitRestatement,
  uploadExhibit,
  withdrawRestatement,
} from './api';
import {
  STAFF_COPY,
  differentUserLine,
  releaseQueuedLine,
  releaseTimingOpenLine,
  releasedNowLine,
  uploadVerifiedLine,
} from './copy';
import { ModalDialog } from './dialog';
import { clear, element, setText } from './dom';
import { newYorkFields } from './format';
import { ROW_KEYS, ROW_LABELS, RowKey, SHARE_EVENT_KINDS, SHARE_EVENT_LABELS } from '../shared/labels';
import { staffChrome } from './staff';
import { AuditEntryPayload, RestatementPayload, ShareEventPayload, StaffUserPayload } from './types';

const BOARD_CADENCE_MS = 3000;

interface ShareEventRow {
  root: HTMLElement;
  kind: HTMLSelectElement;
  shares: HTMLInputElement;
  effectiveDate: HTMLInputElement;
}

interface InterruptedAction {
  userId: string;
  run: () => Promise<void>;
  opener: HTMLElement;
}

function labelled(
  id: string,
  labelText: string,
  control: HTMLElement,
  className = 'field',
): HTMLElement {
  control.setAttribute('id', id);
  return element('div', {
    className,
    children: [element('label', { text: labelText, attributes: { for: id } }), control],
  });
}

export function mountEditor(root: HTMLElement, user: StaffUserPayload, id: string): void {
  const chrome = staffChrome(root, user);
  const heading = element('h1', { className: 'editor-heading', attributes: { tabindex: '-1' } });
  const correctionNote = element('p', { className: 'editor-correction-note' });
  const errorSummary = element('div', { className: 'editor-errors' });
  const rowFields = element('div', { className: 'editor-rows' });
  const eventsList = element('div', { className: 'editor-events' });
  const filingFields = element('div', { className: 'editor-filing' });
  const exhibitArea = element('div', { className: 'editor-exhibit' });
  const actionArea = element('div', { className: 'editor-actions' });
  const auditBody = element('tbody', { attributes: { role: 'rowgroup' } });

  const weekEnding = element('input', { attributes: { type: 'text', readonly: 'readonly' } });
  const correctionReason = element('textarea', { attributes: { rows: '3' } });
  const correctionReasonField = labelled('correction-reason', 'Correction reason', correctionReason);
  const rowInputs = new Map<RowKey, HTMLInputElement>();
  const accession = element('input', { attributes: { type: 'text', inputmode: 'numeric' } });
  const exhibitPage = element('input', { attributes: { type: 'number', min: '1', max: '500' } });
  const exhibitStateText = element('p', { className: 'exhibit-state' });
  const exhibitFile = element('input', { attributes: { type: 'file', accept: 'application/pdf' } });
  const uploadStatus = element('div', {
    className: 'exhibit-upload-status',
    attributes: { role: 'status', 'aria-label': 'Exhibit upload', 'aria-live': 'polite' },
  });

  rowFields.appendChild(labelled('week-ending', 'Week ending', weekEnding));
  for (const key of ROW_KEYS) {
    const input = element('input', { attributes: { type: 'text', inputmode: 'decimal' } });
    rowInputs.set(key, input);
    rowFields.appendChild(labelled(`row-${key}`, ROW_LABELS[key], input));
  }
  filingFields.appendChild(labelled('accession', 'Accession number', accession));
  filingFields.appendChild(labelled('exhibit-page', 'Exhibit page', exhibitPage));
  exhibitArea.appendChild(exhibitStateText);
  exhibitArea.appendChild(labelled('exhibit-file', 'Exhibit PDF', exhibitFile));
  exhibitArea.appendChild(uploadStatus);

  const addEvent = element('button', {
    className: 'staff-action',
    text: 'Add share-count event',
    attributes: { type: 'button' },
  });

  chrome.main.appendChild(heading);
  chrome.main.appendChild(correctionNote);
  chrome.main.appendChild(errorSummary);
  chrome.main.appendChild(rowFields);
  chrome.main.appendChild(correctionReasonField);
  chrome.main.appendChild(
    element('section', {
      className: 'editor-events-section',
      children: [element('h2', { text: 'Share-count events' }), eventsList, addEvent],
    }),
  );
  chrome.main.appendChild(filingFields);
  chrome.main.appendChild(exhibitArea);
  chrome.main.appendChild(actionArea);
  chrome.main.appendChild(
    element('section', {
      className: 'editor-audit',
      children: [
        element('h2', { text: 'Audit trail' }),
        element('div', {
          className: 'audit-scroll',
          attributes: { role: 'region', 'aria-label': 'Audit trail region', tabindex: '0' },
          children: [
            element('table', {
              className: 'audit-table',
              attributes: { role: 'table', 'aria-label': 'Audit trail' },
              children: [
                element('thead', {
                  attributes: { role: 'rowgroup' },
                  children: [
                    element('tr', {
                      attributes: { role: 'row' },
                      children: ['Version', 'Action', 'By', 'At (ET)', 'Note'].map((column) =>
                        element('th', {
                          attributes: { scope: 'col', role: 'columnheader' },
                          text: column,
                        }),
                      ),
                    }),
                  ],
                }),
                auditBody,
              ],
            }),
          ],
        }),
      ],
    }),
  );

  let restatement: RestatementPayload | null = null;
  let version = 0;
  let uploadsInFlight = 0;
  let interrupted: InterruptedAction | null = null;
  const eventRows: ShareEventRow[] = [];
  const checklist = new Map<RowKey, HTMLInputElement>();
  let returnNote: HTMLTextAreaElement | null = null;

  // --- Field error summary ---

  function fieldElementFor(key: string): HTMLElement | null {
    if (key.startsWith('rows.')) return rowInputs.get(key.slice(5) as RowKey) ?? null;
    if (key.startsWith('share_events.')) {
      const parts = key.split('.');
      const row = eventRows[Number(parts[1])];
      if (row === undefined) return null;
      if (parts[2] === 'kind') return row.kind;
      if (parts[2] === 'shares') return row.shares;
      if (parts[2] === 'effective_date') return row.effectiveDate;
      return row.kind;
    }
    if (key === 'accession') return accession;
    if (key === 'exhibit_page') return exhibitPage;
    if (key === 'correction_reason') return correctionReason;
    if (key === 'week_ending') return weekEnding;
    if (key === 'note') return returnNote;
    return null;
  }

  function showFieldErrors(fields: Record<string, string> | null): void {
    clear(errorSummary);
    errorSummary.removeAttribute('role');
    errorSummary.removeAttribute('aria-label');
    if (fields === null || Object.keys(fields).length === 0) return;
    errorSummary.setAttribute('role', 'alert');
    errorSummary.setAttribute('aria-label', STAFF_COPY.draftProblem);
    errorSummary.appendChild(element('h2', { text: STAFF_COPY.draftProblem }));
    const list = element('ul', { attributes: { role: 'list' } });
    for (const [key, message] of Object.entries(fields)) {
      const link = element('a', { text: message, attributes: { href: '#' } });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        fieldElementFor(key)?.focus();
      });
      list.appendChild(element('li', { children: [link] }));
    }
    errorSummary.appendChild(list);
  }

  // --- Share-count events ---

  function addEventRow(event: ShareEventPayload | null): void {
    const index = eventRows.length;
    const kind = element('select', { attributes: { 'aria-label': 'Event type' } });
    for (const option of SHARE_EVENT_KINDS) {
      kind.appendChild(
        element('option', { text: SHARE_EVENT_LABELS[option], attributes: { value: option } }),
      );
    }
    if (event !== null) kind.value = event.kind;
    const shares = element('input', {
      attributes: { type: 'text', inputmode: 'numeric', 'aria-label': 'Shares' },
    });
    const effectiveDate = element('input', {
      attributes: { type: 'text', 'aria-label': 'Effective date', placeholder: 'YYYY-MM-DD' },
    });
    if (event !== null) {
      shares.value = event.shares;
      effectiveDate.value = event.effective_date;
    }
    const remove = element('button', {
      className: 'staff-action',
      text: 'Remove event',
      attributes: { type: 'button' },
    });
    const row = element('div', {
      className: 'editor-event',
      children: [
        element('span', { className: 'editor-event-index', text: `Event ${index + 1}` }),
        kind,
        shares,
        effectiveDate,
        remove,
      ],
    });
    const entry: ShareEventRow = { root: row, kind, shares, effectiveDate };
    remove.addEventListener('click', () => {
      const position = eventRows.indexOf(entry);
      if (position >= 0) eventRows.splice(position, 1);
      row.remove();
    });
    eventRows.push(entry);
    eventsList.appendChild(row);
  }

  addEvent.addEventListener('click', () => addEventRow(null));

  function eventsPayload(): { kind: string; shares: string; effective_date: string }[] {
    return eventRows.map((row) => ({
      kind: row.kind.value,
      shares: row.shares.value.trim(),
      effective_date: row.effectiveDate.value.trim(),
    }));
  }

  // --- Exhibit state ---

  function exhibitStateCopy(): string {
    if (uploadsInFlight > 0) return STAFF_COPY.exhibitPending;
    if (restatement === null || restatement.exhibit === null) return STAFF_COPY.noExhibit;
    return restatement.exhibit.status === 'verified'
      ? STAFF_COPY.exhibitVerified
      : STAFF_COPY.exhibitRejected;
  }

  function renderExhibitState(): void {
    setText(exhibitStateText, exhibitStateCopy());
    const send = actionArea.querySelector<HTMLButtonElement>('[data-action="send"]');
    if (send !== null) send.disabled = uploadsInFlight > 0;
  }

  // --- Applying a restatement response ---

  function applyFields(payload: RestatementPayload): void {
    weekEnding.value = payload.week_ending;
    for (const key of ROW_KEYS) {
      const input = rowInputs.get(key);
      if (input !== undefined) input.value = payload.rows[key] ?? '';
    }
    accession.value = payload.accession ?? '';
    exhibitPage.value = payload.exhibit_page === null ? '' : String(payload.exhibit_page);
    correctionReason.value = payload.correction_reason ?? '';
    clear(eventsList);
    eventRows.length = 0;
    for (const event of payload.share_events) addEventRow(event);
  }

  function applyRestatement(payload: RestatementPayload, refillFields: boolean): void {
    const previousState = restatement?.state ?? null;
    restatement = payload;
    version = Math.max(version, payload.version);
    setText(heading, `Week ending ${payload.week_ending}`);
    setText(
      correctionNote,
      payload.correction_reason === null ? '' : `Correction: ${payload.correction_reason}`,
    );
    correctionReasonField.hidden = payload.supersedes === null;
    if (refillFields || previousState !== payload.state) applyFields(payload);
    renderActions();
    renderExhibitState();
    void refreshAudit();
  }

  async function reread(refillFields = false): Promise<void> {
    const result = await getRestatement(id);
    if (result.kind === 'success') applyRestatement(result.value.restatement, refillFields);
  }

  async function refreshAudit(): Promise<void> {
    const result = await getAudit(id);
    if (result.kind !== 'success') return;
    clear(auditBody);
    for (const entry of result.value.entries as AuditEntryPayload[]) {
      const fields = newYorkFields(entry.at);
      auditBody.appendChild(
        element('tr', {
          attributes: { role: 'row' },
          children: [
            element('td', {
              attributes: { role: 'cell', 'data-label': 'Version' },
              text: String(entry.version),
            }),
            element('td', { attributes: { role: 'cell', 'data-label': 'Action' }, text: entry.action }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'By' },
              text: entry.actor === null ? 'Tracewell' : entry.actor.name,
            }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'At (ET)' },
              text: `${fields.date} ${fields.time}`,
            }),
            element('td', {
              attributes: { role: 'cell', 'data-label': 'Note' },
              text: entry.note ?? '',
            }),
          ],
        }),
      );
    }
  }

  // --- The sign-in dialog ---

  const signInDialog = new ModalDialog('Sign in to continue', (session) => {
    const email = element('input', { attributes: { type: 'email', 'aria-label': 'Email' } });
    const password = element('input', { attributes: { type: 'password', 'aria-label': 'Password' } });
    const status = element('div', {
      attributes: { role: 'status', 'aria-label': 'Sign-in status', 'aria-live': 'polite' },
    });
    const submit = element('button', { text: 'Sign in', attributes: { type: 'button' } });
    const cancel = element('button', { text: 'Cancel', attributes: { type: 'button' } });
    submit.addEventListener('click', () => {
      void (async () => {
        const result = await postSession(email.value, password.value);
        if (!session.isCurrent()) return;
        if (result.kind !== 'success') {
          setText(status, STAFF_COPY.signInFailed);
          return;
        }
        const signedIn = result.value.user;
        const action = interrupted;
        session.close();
        if (action !== null && signedIn.id === action.userId) {
          interrupted = null;
          await action.run();
          return;
        }
        interrupted = null;
        setText(chrome.updates, differentUserLine(signedIn.name));
        await reread();
      })();
    });
    cancel.addEventListener('click', () => {
      interrupted = null;
      session.close();
      setText(chrome.updates, STAFF_COPY.sessionEndedUpdates);
    });
    session.body.appendChild(element('p', { text: STAFF_COPY.sessionEndedDialog }));
    session.body.appendChild(element('label', { text: 'Email' }));
    session.body.appendChild(email);
    session.body.appendChild(element('label', { text: 'Password' }));
    session.body.appendChild(password);
    session.body.appendChild(element('div', { children: [submit, cancel] }));
    session.body.appendChild(status);
    return email;
  });

  function handleEndedSession(action: InterruptedAction): void {
    interrupted = action;
    setText(chrome.updates, '');
    signInDialog.open(action.opener);
  }

  // --- Analyst actions ---

  async function performSave(body: Record<string, unknown>, opener: HTMLElement): Promise<void> {
    const result = await patchRestatement(id, body);
    if (result.kind === 'success') {
      showFieldErrors(null);
      applyRestatement(result.value.restatement, true);
      setText(chrome.updates, STAFF_COPY.draftSaved);
      return;
    }
    if (result.kind === 'network') {
      setText(chrome.updates, STAFF_COPY.unexpected);
      return;
    }
    if (result.status === 401) {
      handleEndedSession({ userId: user.id, opener, run: () => performSave(body, opener) });
      return;
    }
    if (result.code === 'version_conflict') {
      setText(chrome.updates, STAFF_COPY.versionConflict);
      return;
    }
    if (result.code === 'validation_failed') {
      showFieldErrors(result.fields);
      return;
    }
    setText(chrome.updates, STAFF_COPY.unexpected);
  }

  /** A member the analyst has not filled in is left out, so a part-filled draft saves. */
  function saveBody(): Record<string, unknown> {
    const rows: Record<string, string> = {};
    for (const key of ROW_KEYS) {
      const typed = rowInputs.get(key)?.value.trim() ?? '';
      if (typed !== '') rows[key] = typed;
    }
    const body: Record<string, unknown> = {
      version,
      rows,
      share_events: eventsPayload().filter(
        (event) => event.shares !== '' || event.effective_date !== '',
      ),
    };
    if (accession.value.trim() !== '') body.accession = accession.value.trim();
    if (exhibitPage.value.trim() !== '') body.exhibit_page = Number(exhibitPage.value);
    if (restatement !== null && restatement.supersedes !== null && correctionReason.value !== '') {
      body.correction_reason = correctionReason.value;
    }
    return body;
  }

  async function performSend(opener: HTMLElement): Promise<void> {
    const result = await submitRestatement(id);
    if (result.kind === 'success') {
      showFieldErrors(null);
      applyRestatement(result.value.restatement, true);
      setText(chrome.updates, STAFF_COPY.sentToCounsel);
      return;
    }
    if (result.kind === 'network') {
      setText(chrome.updates, STAFF_COPY.unexpected);
      return;
    }
    if (result.status === 401) {
      handleEndedSession({ userId: user.id, opener, run: () => performSend(opener) });
      return;
    }
    if (result.code === 'exhibit_not_verified') {
      setText(chrome.updates, STAFF_COPY.sendRefusedExhibit);
      return;
    }
    if (result.code === 'validation_failed') {
      showFieldErrors(result.fields);
      return;
    }
    setText(chrome.updates, STAFF_COPY.unexpected);
  }

  // --- Counsel actions ---

  async function performClear(checked: RowKey[], sentVersion: number, opener: HTMLElement): Promise<void> {
    const result = await clearRestatement(id, checked, sentVersion);
    if (result.kind === 'success') {
      applyRestatement(result.value.restatement, true);
      setText(chrome.updates, STAFF_COPY.cleared);
      return;
    }
    if (result.kind === 'network') {
      setText(chrome.updates, STAFF_COPY.unexpected);
      return;
    }
    if (result.status === 401) {
      handleEndedSession({
        userId: user.id,
        opener,
        run: () => performClear(checked, sentVersion, opener),
      });
      return;
    }
    if (result.code === 'version_conflict') {
      setText(chrome.updates, STAFF_COPY.versionConflict);
      return;
    }
    if (result.code === 'validation_failed') {
      showFieldErrors(result.fields);
      return;
    }
    setText(chrome.updates, STAFF_COPY.unexpected);
  }

  async function performReturn(note: string): Promise<void> {
    const result = await returnRestatement(id, note);
    if (result.kind === 'success') {
      applyRestatement(result.value.restatement, true);
      setText(chrome.updates, STAFF_COPY.returned);
      return;
    }
    if (result.kind === 'failure' && result.code === 'validation_failed') {
      showFieldErrors(result.fields);
      return;
    }
    if (result.kind === 'failure' && result.status === 401) {
      setText(chrome.updates, STAFF_COPY.sessionEndedUpdates);
      return;
    }
    setText(chrome.updates, STAFF_COPY.unexpected);
  }

  // --- Release and withdraw dialogs ---

  const releaseDialog = new ModalDialog('Release restatement', (session) => {
    const current = restatement;
    const idempotencyKey = `release-${id}-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const confirm = element('input', {
      attributes: {
        type: 'checkbox',
        'aria-label': 'I confirm this restatement is cleared for release',
      },
    }) as HTMLInputElement;
    const timing = element('div', {
      attributes: { role: 'status', 'aria-label': 'Release timing', 'aria-live': 'polite' },
    });
    const releaseStatus = element('div', {
      attributes: { role: 'status', 'aria-label': 'Release status', 'aria-live': 'polite' },
    });
    const release = element('button', { text: 'Release', attributes: { type: 'button' } });
    const cancel = element('button', { text: 'Cancel', attributes: { type: 'button' } });
    release.disabled = true;
    let answered = false;
    confirm.addEventListener('change', () => {
      if (!answered) release.disabled = !confirm.checked;
    });

    async function readTiming(): Promise<void> {
      const board = await getBoard();
      if (!session.isCurrent() || board.kind !== 'success') return;
      const equity = board.value.clocks.equity;
      if (equity.status === 'open' && equity.closes_at !== null) {
        const fields = newYorkFields(equity.closes_at);
        setText(timing, releaseTimingOpenLine(fields.shortTime, fields.date));
      } else {
        setText(timing, STAFF_COPY.releaseTimingClosed);
      }
    }
    void readTiming();
    const timingTimer = window.setInterval(() => {
      if (!session.isCurrent()) {
        window.clearInterval(timingTimer);
        return;
      }
      void readTiming();
    }, BOARD_CADENCE_MS);

    function outcomeCopy(result: ApiResult<{ outcome: 'queued' | 'published'; restatement: RestatementPayload }>): string {
      if (result.kind === 'network') return STAFF_COPY.releaseUnconfirmed;
      if (result.kind === 'success') {
        const payload = result.value.restatement;
        if (result.value.outcome === 'queued' && payload.release_at !== null) {
          const fields = newYorkFields(payload.release_at);
          return releaseQueuedLine(fields.shortTime, fields.date);
        }
        if (payload.published_at !== null) {
          const fields = newYorkFields(payload.published_at);
          return releasedNowLine(fields.time, fields.date);
        }
        return STAFF_COPY.unexpected;
      }
      if (result.code === 'preparer_cannot_release' || result.code === 'clearer_cannot_release') {
        return STAFF_COPY.releaseRefusedTwoPerson;
      }
      if (result.status === 409) return STAFF_COPY.releaseRefusedStateChanged;
      return STAFF_COPY.unexpected;
    }

    release.addEventListener('click', () => {
      release.disabled = true;
      void (async () => {
        const result = await releaseRestatement(id, idempotencyKey);
        if (result.kind === 'failure' && result.status === 401) {
          setText(chrome.updates, STAFF_COPY.sessionEndedUpdates);
          if (session.isCurrent()) session.close();
          return;
        }
        const copy = outcomeCopy(result);
        if (!session.isCurrent()) {
          setText(chrome.updates, copy);
          await reread(true);
          return;
        }
        if (result.kind === 'network') {
          setText(releaseStatus, copy);
          release.disabled = !confirm.checked;
          return;
        }
        answered = true;
        setText(releaseStatus, copy);
        release.disabled = true;
        if (result.kind === 'success') applyRestatement(result.value.restatement, true);
        else await reread(true);
      })();
    });
    cancel.addEventListener('click', () => session.close());

    session.body.appendChild(
      element('p', {
        text:
          current === null
            ? ''
            : `Week ending ${current.week_ending} \u00b7 prepared by ${current.prepared_by.name} \u00b7 ` +
              `cleared by ${current.cleared_by?.name ?? '\u2014'} \u00b7 accession ${current.accession ?? '\u2014'}`,
      }),
    );
    session.body.appendChild(
      element('label', {
        children: [confirm, element('span', { text: 'I confirm this restatement is cleared for release' })],
      }),
    );
    session.body.appendChild(timing);
    session.body.appendChild(element('div', { children: [release, cancel] }));
    session.body.appendChild(releaseStatus);
    return confirm;
  });

  const withdrawDialog = new ModalDialog('Withdraw release', (session) => {
    const current = restatement;
    const note = element('textarea', { attributes: { rows: '3', 'aria-label': 'Withdraw note' } });
    const withdraw = element('button', { text: 'Withdraw', attributes: { type: 'button' } });
    const cancel = element('button', { text: 'Cancel', attributes: { type: 'button' } });
    withdraw.disabled = true;
    note.addEventListener('input', () => {
      withdraw.disabled = note.value.length < 10 || note.value.length > 500;
    });
    const sentVersion = version;
    withdraw.addEventListener('click', () => {
      withdraw.disabled = true;
      void (async () => {
        const result = await withdrawRestatement(id, sentVersion, note.value);
        let copy: string;
        if (result.kind === 'success') copy = STAFF_COPY.withdrawn;
        else if (result.kind === 'network') copy = STAFF_COPY.unexpected;
        else if (result.status === 401) copy = STAFF_COPY.sessionEndedUpdates;
        else if (result.status === 409) copy = STAFF_COPY.withdrawRefused;
        else copy = STAFF_COPY.unexpected;
        if (result.kind === 'network') {
          if (session.isCurrent()) {
            setText(chrome.updates, STAFF_COPY.unexpected);
            withdraw.disabled = false;
          }
          return;
        }
        const wasCurrent = session.isCurrent();
        if (wasCurrent) session.close();
        setText(chrome.updates, copy);
        await reread(true);
        if (wasCurrent) heading.focus();
      })();
    });
    cancel.addEventListener('click', () => session.close());
    session.body.appendChild(
      element('p', {
        text:
          current === null
            ? ''
            : `Week ending ${current.week_ending} \u00b7 queued release ${
                current.release_at === null
                  ? '\u2014'
                  : `${newYorkFields(current.release_at).date} ${newYorkFields(current.release_at).shortTime} ET`
              }`,
      }),
    );
    session.body.appendChild(element('label', { text: 'Withdraw note' }));
    session.body.appendChild(note);
    session.body.appendChild(element('div', { children: [withdraw, cancel] }));
    return note;
  });

  // --- The action area for the signed-in user and the current state ---

  function renderActions(): void {
    clear(actionArea);
    checklist.clear();
    returnNote = null;
    const current = restatement;
    if (current === null) return;
    const isPreparer = current.prepared_by.id === user.id;
    const editable = current.state === 'draft' || current.state === 'returned';

    if (user.roles.includes('treasury_analyst') && isPreparer && editable) {
      const save = element('button', {
        className: 'staff-action',
        text: 'Save draft',
        attributes: { type: 'button', 'data-action': 'save' },
      });
      const send = element('button', {
        className: 'staff-action',
        text: 'Send to disclosure counsel',
        attributes: { type: 'button', 'data-action': 'send' },
      });
      save.addEventListener('click', () => {
        void performSave(saveBody(), save);
      });
      send.addEventListener('click', () => {
        void performSend(send);
      });
      actionArea.appendChild(element('div', { children: [save, send] }));
    }

    if (user.roles.includes('disclosure_counsel') && current.state === 'in_review') {
      const list = element('div', { className: 'review-checklist' });
      for (const key of ROW_KEYS) {
        const box = element('input', {
          attributes: { type: 'checkbox', 'aria-label': `Matches exhibit: ${ROW_LABELS[key]}` },
        }) as HTMLInputElement;
        checklist.set(key, box);
        list.appendChild(
          element('label', {
            children: [box, element('span', { text: `Matches exhibit: ${ROW_LABELS[key]}` })],
          }),
        );
      }
      const note = element('textarea', { attributes: { rows: '3', 'aria-label': 'Return note' } });
      returnNote = note;
      const returnButton = element('button', {
        className: 'staff-action',
        text: 'Return to analyst',
        attributes: { type: 'button' },
      });
      const clearButton = element('button', {
        className: 'staff-action',
        text: 'Clear for release',
        attributes: { type: 'button' },
      });
      returnButton.addEventListener('click', () => {
        void performReturn(note.value);
      });
      clearButton.addEventListener('click', () => {
        const checked = ROW_KEYS.filter((key) => checklist.get(key)?.checked === true);
        void performClear([...checked], version, clearButton);
      });
      actionArea.appendChild(list);
      actionArea.appendChild(element('label', { text: 'Return note' }));
      actionArea.appendChild(note);
      actionArea.appendChild(element('div', { children: [returnButton, clearButton] }));
    }

    if (user.roles.includes('disclosure_officer') && current.state === 'cleared') {
      const button = element('button', {
        className: 'staff-action',
        text: 'Release restatement',
        attributes: { type: 'button' },
      });
      button.addEventListener('click', () => releaseDialog.open(button));
      actionArea.appendChild(button);
    }

    if (user.roles.includes('disclosure_officer') && current.state === 'queued') {
      const button = element('button', {
        className: 'staff-action',
        text: 'Withdraw release',
        attributes: { type: 'button' },
      });
      button.addEventListener('click', () => withdrawDialog.open(button));
      actionArea.appendChild(button);
    }
  }

  // --- Exhibit upload ---

  async function upload(file: File): Promise<void> {
    uploadsInFlight += 1;
    renderExhibitState();
    setText(uploadStatus, STAFF_COPY.uploadInProgress);
    const sha256 = await sha256Of(file);
    const outcome = await uploadExhibit(id, file, sha256);
    uploadsInFlight -= 1;
    switch (outcome.kind) {
      case 'verified':
        setText(uploadStatus, uploadVerifiedLine(sha256));
        if (outcome.restatement !== undefined) applyRestatement(outcome.restatement, false);
        else await reread();
        break;
      case 'mismatch':
        setText(uploadStatus, STAFF_COPY.uploadHashMismatch);
        await reread();
        break;
      case 'not_pdf':
        setText(uploadStatus, STAFF_COPY.uploadNotPdf);
        renderExhibitState();
        break;
      case 'not_filing_safe':
        setText(uploadStatus, STAFF_COPY.uploadNotFilingSafe);
        renderExhibitState();
        break;
      case 'too_large':
        setText(uploadStatus, STAFF_COPY.uploadTooLarge);
        renderExhibitState();
        break;
      case 'no_accession':
        setText(uploadStatus, STAFF_COPY.uploadNoAccession);
        renderExhibitState();
        break;
      case 'vault_down':
        setText(uploadStatus, STAFF_COPY.uploadVaultDown);
        renderExhibitState();
        break;
      case 'unauthenticated':
        renderExhibitState();
        setText(chrome.updates, STAFF_COPY.sessionEndedUpdates);
        break;
      case 'unexpected':
        setText(uploadStatus, STAFF_COPY.unexpected);
        renderExhibitState();
        break;
    }
    if (outcome.kind !== 'verified' && outcome.kind !== 'mismatch') exhibitFile.value = '';
  }

  exhibitFile.addEventListener('change', () => {
    const files = Array.from(exhibitFile.files ?? []);
    for (const file of files) void upload(file);
  });

  void (async () => {
    const result = await getRestatement(id);
    if (result.kind !== 'success') {
      setText(chrome.updates, STAFF_COPY.unexpected);
      return;
    }
    applyRestatement(result.value.restatement, true);
  })();
}
