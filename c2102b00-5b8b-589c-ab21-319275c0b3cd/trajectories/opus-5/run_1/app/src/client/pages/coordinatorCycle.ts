import type {
  CloseResponse,
  Cycle,
  DailyRow,
  DocumentRecord,
  Flag,
  Line,
  Receipt,
  ShortResponse,
} from '../../shared/types.ts';
import { NoResponseError, errorCode, errorFields, newIdempotencyKey, request } from '../api.ts';
import { copy, fieldLabels, fieldOrder } from '../copy.ts';
import { clear, el, isBusy, setBusy, setText } from '../dom.ts';
import { Dialog } from '../dialog.ts';
import { clubFieldText, fieldTextToLocal } from '../clubTimeText.ts';
import type { Page, Shell } from './page.ts';

const REFRESH_MS = 10_000;

const NEXT_STATUS: Record<string, { to: string; label: string }> = {
  sealing: { to: 'ordered', label: 'Place order' },
  ordered: { to: 'received', label: 'Mark received' },
  received: { to: 'breakdown', label: 'Start breakdown' },
  breakdown: { to: 'closed', label: 'Close cycle' },
  closing: { to: 'closed', label: 'Close cycle' },
};

interface LineRowParts {
  row: HTMLElement;
  pledged: HTMLElement;
  toGo: HTMLElement;
  status: HTMLElement;
  shortUnits: HTMLElement;
  flags: HTMLElement;
  shortButton: HTMLButtonElement;
}

interface GroupParts {
  group: HTMLElement;
  state: HTMLElement;
  drop: HTMLButtonElement;
  takeUp: HTMLButtonElement;
}

export function createCoordinatorCyclePage(shell: Shell, cycleId: string): Page {
  let cycle: Cycle | null = null;
  let cycleSeq = 0;
  let revision = 0;
  let serverTimes = { cutoff_local: '', pickup_start_local: '', pickup_end_local: '' };
  let refreshTimer: number | null = null;
  let destroyed = false;
  const lineRows = new Map<string, LineRowParts>();
  const groups = new Map<string, GroupParts>();
  let shortDialog: Dialog | null = null;

  const heading = el('h1', { class: 'cycle-name' });
  const statusText = el('p', { class: 'cycle-status' });
  const cutoffText = el('p', { class: 'cycle-time' });
  const pickupText = el('p', { class: 'cycle-time' });

  const timeFields = {
    cutoff_local: timeField('Cutoff (club time)', 'coord-cutoff'),
    pickup_start_local: timeField('Pickup starts (club time)', 'coord-pickup-start'),
    pickup_end_local: timeField('Pickup ends (club time)', 'coord-pickup-end'),
  };
  const timeErrors = new Map<string, HTMLElement>();
  const saveTimes = el('button', { type: 'button', class: 'primary', text: 'Save times' }) as HTMLButtonElement;

  function timeField(label: string, id: string): HTMLInputElement {
    return el('input', { type: 'text', id, class: 'text-input', 'aria-label': label }) as HTMLInputElement;
  }

  function timeRow(label: string, input: HTMLInputElement): HTMLElement {
    const error = el('p', { class: 'field-error', id: `error-${input.id}` });
    timeErrors.set(input.id, error);
    return el('div', { class: 'form-row' }, [
      el('label', { for: input.id, class: 'label', text: label.toUpperCase() }),
      input,
      error,
    ]);
  }

  const cutoffRow = timeRow('Cutoff (club time)', timeFields.cutoff_local);
  const timesSection = el('section', { class: 'time-editor' }, [
    cutoffRow,
    timeRow('Pickup starts (club time)', timeFields.pickup_start_local),
    timeRow('Pickup ends (club time)', timeFields.pickup_end_local),
    saveTimes,
  ]);

  const atCutoff = el('section', { class: 'at-cutoff', role: 'region', 'aria-label': 'At cutoff' });
  const linesBody = el('tbody');
  const linesTable = el('table', { class: 'lines-table', 'aria-label': 'Lines' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'CASE' }),
        el('th', { scope: 'col', text: 'PLEDGED' }),
        el('th', { scope: 'col', text: 'TO GO' }),
        el('th', { scope: 'col', text: 'STATUS' }),
        el('th', { scope: 'col', text: 'SHORT' }),
        el('th', { scope: 'col', text: 'FLAGS' }),
        el('th', { scope: 'col', text: 'ACTION' }),
      ]),
    ]),
    linesBody,
  ]);

  const invoiceInput = el('input', {
    type: 'file',
    id: 'invoice-file',
    accept: 'application/pdf',
    'aria-label': 'Distributor invoice (PDF)',
  }) as HTMLInputElement;
  const invoiceButton = el('button', { type: 'button', text: 'Upload invoice' }) as HTMLButtonElement;
  const slipInput = el('input', {
    type: 'file',
    id: 'slip-file',
    accept: 'image/jpeg,image/png',
    'aria-label': 'Packing slip photo',
  }) as HTMLInputElement;
  const slipButton = el('button', { type: 'button', text: 'Upload packing slip' }) as HTMLButtonElement;
  const documentList = el('ul', { class: 'document-list' });
  const documentsSection = el('section', { class: 'documents' }, [
    el('h2', { class: 'section-heading', text: 'DOCUMENTS' }),
    el('div', { class: 'form-row' }, [
      el('label', { for: 'invoice-file', class: 'label', text: 'DISTRIBUTOR INVOICE (PDF)' }),
      invoiceInput,
      invoiceButton,
    ]),
    el('div', { class: 'form-row' }, [
      el('label', { for: 'slip-file', class: 'label', text: 'PACKING SLIP PHOTO' }),
      slipInput,
      slipButton,
    ]),
    documentList,
  ]);

  const transitionButton = el('button', { type: 'button', class: 'primary', text: 'Place order' }) as HTMLButtonElement;
  const transitionSection = el('section', { class: 'transition' }, [transitionButton]);

  const dailyBody = el('tbody');
  const dailyTable = el('table', { class: 'daily-table', 'aria-label': 'Pledges by day' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'DATE' }),
        el('th', { scope: 'col', text: 'PLEDGED' }),
        el('th', { scope: 'col', text: 'WITHDRAWN' }),
      ]),
    ]),
    dailyBody,
  ]);

  const receiptsBody = el('tbody');
  const receiptsTable = el('table', { class: 'receipts-table', 'aria-label': 'Receipts' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'HOUSEHOLD' }),
        el('th', { scope: 'col', text: 'EMAIL' }),
        el('th', { scope: 'col', text: 'STATUS' }),
      ]),
    ]),
    receiptsBody,
  ]);

  const flagList = el('ul', { class: 'flag-list', 'aria-label': 'Volunteer flags' });

  const element = el('main', { class: 'screen coordinator-cycle' }, [
    el('header', { class: 'cycle-header' }, [heading, statusText, cutoffText, pickupText]),
    timesSection,
    atCutoff,
    el('section', { class: 'lines' }, [el('h2', { class: 'section-heading', text: 'LINES' }), linesTable]),
    el('section', { class: 'flags' }, [el('h2', { class: 'section-heading', text: 'VOLUNTEER FLAGS' }), flagList]),
    documentsSection,
    transitionSection,
    el('section', { class: 'daily' }, [el('h2', { class: 'section-heading', text: 'PLEDGES BY DAY' }), dailyTable]),
    el('section', { class: 'receipts' }, [el('h2', { class: 'section-heading', text: 'RECEIPTS' }), receiptsTable]),
  ]);

  function typedTimeFields(): boolean {
    return Object.entries(timeFields).some(
      ([name, input]) => input.isConnected && input.value !== serverTimes[name as keyof typeof serverTimes],
    );
  }

  function paintTimes(): void {
    if (!cycle) return;
    const editable = ['open', 'sealing', 'ordered', 'received'].includes(cycle.status);
    timesSection.hidden = !editable;
    const next = {
      cutoff_local: clubFieldText(cycle.cutoff_at, shell.club.time_zone),
      pickup_start_local: clubFieldText(cycle.pickup_start_at, shell.club.time_zone),
      pickup_end_local: clubFieldText(cycle.pickup_end_at, shell.club.time_zone),
    };
    const typed = typedTimeFields();
    if (!typed) {
      serverTimes = next;
      timeFields.cutoff_local.value = next.cutoff_local;
      timeFields.pickup_start_local.value = next.pickup_start_local;
      timeFields.pickup_end_local.value = next.pickup_end_local;
    }
    const wantCutoff = cycle.accepting_pledges;
    if (!wantCutoff && cutoffRow.isConnected) {
      const hadFocus = document.activeElement === timeFields.cutoff_local;
      cutoffRow.remove();
      if (hadFocus) timeFields.pickup_start_local.focus();
    } else if (wantCutoff && !cutoffRow.isConnected) {
      timesSection.prepend(cutoffRow);
    }
  }

  function groupFor(line: Line): GroupParts {
    let parts = groups.get(line.product_id);
    if (!parts) {
      const state = el('p', { class: 'group-state' });
      const drop = el('button', {
        type: 'button',
        'aria-label': `Drop ${line.case_name}`,
        text: 'Drop',
      }) as HTMLButtonElement;
      const takeUp = el('button', {
        type: 'button',
        'aria-label': `Take up ${line.case_name}`,
        text: 'Take up',
      }) as HTMLButtonElement;
      drop.addEventListener('click', () => void resolve(line.product_id, 'drop', drop));
      takeUp.addEventListener('click', () => void resolve(line.product_id, 'take_up', takeUp));
      const group = el('div', { role: 'group', 'aria-label': line.case_name, class: 'cutoff-group', tabindex: '-1' }, [
        el('p', { class: 'group-name', text: line.case_name }),
        state,
        drop,
        takeUp,
      ]);
      parts = { group, state, drop, takeUp };
      groups.set(line.product_id, parts);
      atCutoff.append(group);
    }
    return parts;
  }

  function paintGroups(): void {
    if (!cycle) return;
    for (const line of cycle.lines) {
      const parts = groupFor(line);
      const stateWords =
        line.status === 'sealed'
          ? 'SEALED'
          : line.status === 'dropped'
            ? 'DROPPED'
            : line.status === 'taken_up'
              ? 'TAKEN UP'
              : `${line.units_to_go} TO GO`;
      setText(parts.state, stateWords);
      const resolvable = cycle.status === 'sealing' && line.status === 'filling';
      for (const button of [parts.drop, parts.takeUp]) {
        if (resolvable && !button.isConnected) parts.group.append(button);
        if (!resolvable && button.isConnected) {
          const hadFocus = document.activeElement === button;
          button.remove();
          if (hadFocus) parts.group.focus();
        }
      }
    }
  }

  function rowFor(line: Line): LineRowParts {
    let parts = lineRows.get(line.product_id);
    if (!parts) {
      const pledged = el('td');
      const toGo = el('td');
      const status = el('td');
      const shortUnits = el('td');
      const flags = el('td');
      const shortButton = el('button', {
        type: 'button',
        'aria-label': `Record short: ${line.case_name}`,
        text: 'Record short',
      }) as HTMLButtonElement;
      shortButton.addEventListener('click', () => openShortDialog(line.product_id, shortButton));
      const row = el('tr', { 'data-product': line.product_id }, [
        el('td', { text: line.case_name }),
        pledged,
        toGo,
        status,
        shortUnits,
        flags,
        el('td', {}, [shortButton]),
      ]);
      parts = { row, pledged, toGo, status, shortUnits, flags, shortButton };
      lineRows.set(line.product_id, parts);
      linesBody.append(row);
    }
    return parts;
  }

  function paintLines(flags: Flag[]): void {
    if (!cycle) return;
    for (const line of cycle.lines) {
      const parts = rowFor(line);
      setText(parts.pledged, String(line.pledged_units));
      setText(parts.toGo, String(line.units_to_go));
      setText(parts.status, line.status === 'taken_up' ? 'taken up' : line.status);
      setText(parts.shortUnits, String(line.short_units));
      const lineFlags = flags.filter((flag) => flag.product_id === line.product_id);
      setText(parts.flags, String(lineFlags.reduce((total, flag) => total + flag.units, 0)));
    }
  }

  function paintTransition(): void {
    if (!cycle) return;
    const next = NEXT_STATUS[cycle.status];
    transitionSection.hidden = next === undefined;
    if (!next) return;
    setText(transitionButton, next.label);
    transitionButton.setAttribute('aria-label', next.label);
    const unresolved = cycle.lines.some((line) => line.status === 'filling');
    transitionButton.disabled = next.to === 'ordered' && unresolved;
  }

  const drawn = new Map<string, string>();
  let lastFlags: Flag[] = [];

  /** Keeps a section's nodes, and so any focus in them, while its content is unchanged. */
  function redrawNeeded(section: string, signature: string): boolean {
    if (drawn.get(section) === signature) return false;
    drawn.set(section, signature);
    return true;
  }

  async function householdNames(): Promise<Map<string, string>> {
    if (!cycle || !['breakdown', 'closing', 'closed'].includes(cycle.status)) return new Map();
    const reply = await request<{ bags: { household_code: string; household_name: string }[] }>(
      'GET',
      `/api/cycles/${cycleId}/bags`,
    );
    if (!reply.ok) return new Map();
    return new Map(reply.body.bags.map((bag) => [bag.household_code, bag.household_name]));
  }

  async function loadExtras(): Promise<void> {
    const [daily, receipts, flags, documents] = await Promise.all([
      request<{ days: DailyRow[] }>('GET', `/api/cycles/${cycleId}/daily`),
      request<{ receipts: Receipt[] }>('GET', `/api/cycles/${cycleId}/receipts`),
      request<{ flags: Flag[] }>('GET', `/api/cycles/${cycleId}/flags`),
      request<{ documents: DocumentRecord[] }>('GET', `/api/cycles/${cycleId}/documents`),
    ]);
    if (destroyed) return;
    if (daily.ok && redrawNeeded('daily', JSON.stringify(daily.body.days))) {
      clear(dailyBody);
      for (const day of daily.body.days) {
        dailyBody.append(
          el('tr', {}, [
            el('td', { text: day.date }),
            el('td', { text: String(day.units_pledged) }),
            el('td', { text: String(day.units_withdrawn) }),
          ]),
        );
      }
    }
    if (receipts.ok && redrawNeeded('receipts', JSON.stringify(receipts.body.receipts))) {
      clear(receiptsBody);
      for (const receipt of receipts.body.receipts) {
        receiptsBody.append(
          el('tr', {}, [
            el('td', { text: receipt.household_code }),
            el('td', { text: receipt.email }),
            el('td', { text: receipt.status }),
          ]),
        );
      }
      const stuck = receipts.body.receipts.some(
        (receipt) => receipt.status === 'queued' && receipt.failed_attempts > 0,
      );
      shell.setBanner('mail', stuck ? copy.mailQueued : null);
    }
    if (flags.ok) lastFlags = flags.body.flags;
    paintLines(lastFlags);
    if (flags.ok && redrawNeeded('flags', JSON.stringify(flags.body.flags))) {
      clear(flagList);
      const caseNames = new Map(cycle?.lines.map((line) => [line.product_id, line.case_name]) ?? []);
      const names = flags.body.flags.length > 0 ? await householdNames() : new Map<string, string>();
      for (const flag of flags.body.flags) {
        const household = names.get(flag.household_code) ?? flag.household_code;
        flagList.append(
          el('li', {
            text: `${household}: ${flag.units} missing of ${caseNames.get(flag.product_id) ?? flag.product_id}`,
          }),
        );
      }
    }
    if (documents.ok && redrawNeeded('documents', JSON.stringify(documents.body.documents))) {
      clear(documentList);
      for (const document of documents.body.documents) {
        documentList.append(
          el('li', {}, [
            el('a', {
              href: `/api/cycles/${cycleId}/documents/${document.kind}`,
              class: 'text-link',
              text: `${document.kind} (${document.bytes} bytes)`,
            }),
          ]),
        );
      }
    }
  }

  function applyCycle(next: Cycle, sentSeq: number): void {
    if (sentSeq <= cycleSeq) return;
    cycleSeq = sentSeq;
    cycle = next;
    revision = next.revision;
    setText(heading, next.name);
    setText(statusText, next.status.toUpperCase());
    setText(cutoffText, next.cutoff_display ? `CUTOFF ${next.cutoff_display}` : 'CUTOFF');
    setText(pickupText, next.pickup_display ? `PICKUP ${next.pickup_display}` : 'PICKUP');
    paintTimes();
    paintGroups();
    paintLines(lastFlags);
    paintTransition();
    documentsSection.hidden = !['ordered', 'received', 'breakdown', 'closing', 'closed'].includes(next.status);
    atCutoff.hidden = ['draft', 'open'].includes(next.status);
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    try {
      const reply = await request<Cycle>('GET', `/api/cycles/${cycleId}`);
      if (destroyed || !reply.ok) return;
      applyCycle(reply.body, reply.sentSeq);
      await loadExtras();
    } catch {
      /* the next refresh tries again */
    }
  }

  async function sendTimes(): Promise<void> {
    if (!cycle) return;
    const body: Record<string, unknown> = {};
    for (const [name, input] of Object.entries(timeFields)) {
      if (!input.isConnected) continue;
      if (input.value === serverTimes[name as keyof typeof serverTimes]) continue;
      body[name] = fieldTextToLocal(input.value);
    }
    if (isBusy(saveTimes)) return;
    setBusy(saveTimes, true, { busy: 'Saving...', idle: 'Save times' });
    const reply = await request<Cycle>('PATCH', `/api/cycles/${cycleId}`, { body, ifMatch: `"r${revision}"` });
    setBusy(saveTimes, false, { busy: 'Saving...', idle: 'Save times' });
    for (const [, node] of timeErrors) setText(node, '');
    if (reply.ok) {
      cycleSeq = reply.sentSeq;
      serverTimes = { cutoff_local: '', pickup_start_local: '', pickup_end_local: '' };
      applyCycle(reply.body, reply.sentSeq);
      shell.say('coordinator', copy.savedTimes(reply.body.name));
      return;
    }
    if (reply.status === 422) {
      const fields = errorFields(reply.body);
      for (const name of fieldOrder) {
        const text = fields[name];
        if (text === undefined) continue;
        const input = timeFields[name as keyof typeof timeFields];
        if (!input) continue;
        const error = timeErrors.get(input.id);
        if (error) setText(error, text);
        input.setAttribute('aria-describedby', `error-${input.id}`);
        shell.say('coordinator', `${fieldLabels[name]}: ${text}`);
      }
      return;
    }
    if (reply.status === 412) {
      serverTimes = { cutoff_local: '', pickup_start_local: '', pickup_end_local: '' };
      const fresh = await request<Cycle>('GET', `/api/cycles/${cycleId}`);
      if (fresh.ok) applyCycle(fresh.body, fresh.sentSeq);
      shell.say('coordinator', copy.staleTimes(cycle.name));
      saveTimes.focus();
    }
  }

  saveTimes.addEventListener('click', () => void sendTimes());

  async function resolve(productId: string, action: 'drop' | 'take_up', button: HTMLButtonElement): Promise<void> {
    const line = cycle?.lines.find((item) => item.product_id === productId);
    if (!line) return;
    if (isBusy(button)) return;
    const label = button.textContent ?? '';
    setBusy(button, true, { busy: 'Working...', idle: label });
    const reply = await request<Line>('POST', `/api/cycles/${cycleId}/lines/${productId}/resolution`, {
      body: { action },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(button, false, { busy: 'Working...', idle: label });
    if (reply.ok) {
      const updated = reply.body;
      shell.say(
        'coordinator',
        action === 'drop' ? copy.dropped(updated.case_name) : copy.takenUp(updated.pledged_units - line.pledged_units, updated.case_name),
      );
    } else if (errorCode(reply.body) === 'line_already_resolved') {
      const fresh = await request<Cycle>('GET', `/api/cycles/${cycleId}`);
      const freshLine = fresh.ok ? fresh.body.lines.find((item) => item.product_id === productId) : undefined;
      const resolution = freshLine?.status === 'taken_up' ? 'taken up' : 'dropped';
      shell.say('coordinator', copy.alreadyResolved(line.case_name, resolution));
    }
    await refresh();
  }

  function openShortDialog(productId: string, opener: HTMLButtonElement): void {
    const line = cycle?.lines.find((item) => item.product_id === productId);
    if (!line) return;
    const units = el('input', {
      type: 'number',
      min: '1',
      id: 'short-units',
      class: 'units-spin',
      'aria-label': 'Units short',
    }) as HTMLInputElement;
    const error = el('p', { class: 'field-error', id: 'short-units-error' });
    const record = el('button', { type: 'button', class: 'primary', text: 'Record short' }) as HTMLButtonElement;
    const cancel = el('button', { type: 'button', text: 'Cancel' }) as HTMLButtonElement;
    const dialog = new Dialog({
      title: 'Record short shipment',
      build: (body) => {
        body.append(
          el('p', { text: line.case_name }),
          el('label', { for: 'short-units', class: 'label', text: 'UNITS SHORT' }),
          units,
          error,
        );
      },
      footer: [record, cancel],
      initialFocus: () => units,
      returnFocus: () => (opener.isConnected ? opener : null),
    });
    let key = newIdempotencyKey();
    let sentValue: string | null = null;
    units.addEventListener('input', () => {
      if (sentValue !== null && units.value !== sentValue) {
        key = newIdempotencyKey();
        sentValue = null;
      }
    });
    const send = async (): Promise<void> => {
      if (isBusy(record)) return;
      sentValue = units.value;
      setBusy(record, true, { busy: 'Saving...', idle: 'Record short' });
      try {
        const reply = await request<ShortResponse>('POST', `/api/cycles/${cycleId}/lines/${productId}/shorts`, {
          body: { units: Number(units.value) },
          idempotencyKey: key,
        });
        setBusy(record, false, { busy: 'Saving...', idle: 'Record short' });
        if (reply.status === 201) {
          dialog.close();
          const households = reply.body.affected.filter((entry) => entry.pledger !== 'club').length;
          shell.say('coordinator', copy.shortRecorded(Number(units.value), line.case_name, households));
          await refresh();
          return;
        }
        const fields = errorFields(reply.body);
        const text = fields.units ?? copy.shortRangeError(line.pack - line.short_units);
        setText(error, text);
        units.setAttribute('aria-describedby', 'short-units-error');
        shell.say('coordinator', text);
      } catch (thrown) {
        setBusy(record, false, { busy: 'Saving...', idle: 'Record short' });
        if (thrown instanceof NoResponseError) {
          setText(error, copy.shortNoResponse(line.case_name));
          units.setAttribute('aria-describedby', 'short-units-error');
          record.focus();
          return;
        }
        throw thrown;
      }
    };
    record.addEventListener('click', () => void send());
    cancel.addEventListener('click', () => dialog.close());
    shortDialog?.destroy();
    shortDialog = dialog;
    dialog.open();
  }

  async function upload(kind: 'invoice' | 'packing-slip', input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    if (isBusy(button)) return;
    const label = button.textContent ?? '';
    setBusy(button, true, { busy: 'Uploading...', idle: label });
    try {
      const bytes = await file.arrayBuffer();
      const reply = await request<{ bytes: number }>('PUT', `/api/cycles/${cycleId}/documents/${kind}`, {
        raw: { bytes, contentType: file.type || 'application/octet-stream' },
      });
      setBusy(button, false, { busy: 'Uploading...', idle: label });
      if (reply.status === 201) {
        shell.say('coordinator', copy.uploadSaved(kind === 'invoice' ? 'invoice' : 'packing slip', reply.body.bytes));
        await loadExtras();
        return;
      }
      if (reply.status === 413) shell.say('coordinator', copy.uploadTooLarge);
      else if (reply.status === 415) shell.say('coordinator', kind === 'invoice' ? copy.uploadNotPdf : copy.uploadNotPhoto);
      else if (errorCode(reply.body) === 'upload_in_progress') shell.say('coordinator', copy.uploadInProgress);
      else if (errorCode(reply.body) === 'storage_unavailable') shell.say('coordinator', copy.uploadStorageDown);
    } catch (error) {
      setBusy(button, false, { busy: 'Uploading...', idle: label });
      if (!(error instanceof NoResponseError)) throw error;
      shell.say('coordinator', copy.uploadStorageDown);
    }
  }

  invoiceButton.addEventListener('click', () => void upload('invoice', invoiceInput, invoiceButton));
  slipButton.addEventListener('click', () => void upload('packing-slip', slipInput, slipButton));

  async function moveStatus(): Promise<void> {
    if (!cycle) return;
    const next = NEXT_STATUS[cycle.status];
    if (!next) return;
    const closing = next.to === 'closed';
    if (isBusy(transitionButton)) return;
    const label = next.label;
    setBusy(transitionButton, true, { busy: closing ? 'Closing...' : 'Working...', idle: label });
    try {
      const reply = await request<Cycle | CloseResponse>('POST', `/api/cycles/${cycleId}/transitions`, {
        body: { to: next.to },
        idempotencyKey: newIdempotencyKey(),
      });
      setBusy(transitionButton, false, { busy: label, idle: label });
      if (reply.ok) {
        if (closing) {
          const body = reply.body as CloseResponse;
          shell.say('coordinator', copy.closed(body.cycle.name, body.receipts_queued));
        } else {
          const body = reply.body as Cycle;
          shell.say('coordinator', copy.transitioned(body.name, body.status));
        }
        await refresh();
        return;
      }
      const code = errorCode(reply.body);
      const name = cycle.name;
      if (code === 'unresolved_lines' || code === 'nothing_to_order') shell.say('coordinator', copy.unresolved);
      else if (code === 'invoice_missing') shell.say('coordinator', copy.closeInvoiceMissing);
      else if (code === 'charge_mismatch') shell.say('coordinator', copy.closeChargeMismatch(name));
      else if (code === 'payments_paused') shell.say('coordinator', copy.closePaymentsDown(name));
      else if (code === 'storage_unavailable') shell.say('coordinator', copy.closeStorageDown(name));
      await refresh();
    } catch (error) {
      setBusy(transitionButton, false, { busy: label, idle: label });
      if (!(error instanceof NoResponseError)) throw error;
    }
  }

  transitionButton.addEventListener('click', () => void moveStatus());

  return {
    element,
    start() {
      void refresh();
      refreshTimer = window.setInterval(() => void refresh(), REFRESH_MS);
    },
    destroy() {
      destroyed = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
      shortDialog?.destroy();
      shell.setBanner('mail', null);
    },
  };
}
