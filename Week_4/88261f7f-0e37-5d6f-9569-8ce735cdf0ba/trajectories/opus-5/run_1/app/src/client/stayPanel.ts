import { formatMoney } from '../shared/money';
import { folioLetter } from '../shared/folioNames';
import { notices, pendingTexts } from '../shared/notices';
import { call } from './api';
import { loadDesk, render, state } from './app';
import { labelledValue, nightlyBreakdown, stayTotal } from './components';
import { DialogHandle, openDialogFor } from './dialog';
import { button, el, labelled, select, textbox } from './dom';
import { openAddCharge, openMoveEntry, openRecordPayment } from './dialogs/folioEntries';
import { openSplitCharge } from './dialogs/split';
import { regionNames, setMessage, statusRegion, valueRegion } from './regions';
import { Entry, Folio, Stay } from './types';

let panel: DialogHandle | null = null;
let openStayId: string | null = null;
let loadToken = 0;

async function fetchStay(stayId: string): Promise<Stay | null> {
  const token = loadToken + 1;
  loadToken = token;
  const result = await call<Stay>(`/api/stays/${stayId}`);
  if (token !== loadToken) return null;
  return result.data;
}

export async function openStayPanel(
  opener: HTMLElement | null,
  stayId: string,
  restoreFocus?: () => void,
): Promise<void> {
  openStayId = stayId;
  if (!panel) {
    panel = openDialogFor({
      name: 'Stay',
      opener,
      restoreFocus,
      className: 'panel stay',
      build: () => [el('p', { text: 'Loading…' })],
      onClose: () => {
        panel = null;
        openStayId = null;
        loadToken += 1;
      },
    });
  }
  const stay = await fetchStay(stayId);
  if (!stay || !panel || openStayId !== stayId) return;
  state.stay = stay;
  panel.rebuild(stayBody(stay));
}

function closeStayPanel(): void {
  if (panel) panel.close();
}

/** Reloads the open panel so a pushed change shows at once. */
export async function refreshStayPanel(): Promise<void> {
  if (!panel || openStayId === null) return;
  const stay = await fetchStay(openStayId);
  if (!stay || !panel) return;
  state.stay = stay;
  panel.rebuild(stayBody(stay));
}

async function afterStayChange(): Promise<void> {
  await Promise.all([loadDesk(), refreshStayPanel()]);
  render();
}

function runAction(
  trigger: HTMLButtonElement,
  pending: string,
  region: string,
  work: () => Promise<{ notice: string | null; failure: string | null }>,
): void {
  if (trigger.getAttribute('aria-busy') === 'true') return;
  trigger.setAttribute('aria-busy', 'true');
  setMessage(region, pending);
  void work()
    .then(async (outcome) => {
      trigger.removeAttribute('aria-busy');
      setMessage(region, outcome.failure ?? outcome.notice ?? '');
      await afterStayChange();
    })
    .catch(() => {
      trigger.removeAttribute('aria-busy');
    });
}

function entryActions(stay: Stay, folio: Folio, entry: Entry): Node[] {
  const actions: Node[] = [];
  if (entry.kind === 'charge') {
    actions.push(
      button(`Split ${entry.description}`, (event) =>
        openSplitCharge(event.currentTarget as HTMLElement, entry, afterStayChange),
      { class: 'rowaction' }),
    );
  }
  actions.push(
    button(`Reverse ${entry.description}`, (event) => {
      const trigger = event.currentTarget as HTMLButtonElement;
      runAction(trigger, pendingTexts.reverse, regionNames.folioStatus, async () => {
        const result = await call<Entry>(`/api/entries/${entry.id}/reverse`, { method: 'POST' });
        return {
          notice: result.data ? notices.reversalPosted : null,
          failure: result.data ? null : result.error ?? 'Not found.',
        };
      });
    }, { class: 'rowaction' }),
    button(`Move ${entry.description}`, (event) =>
      openMoveEntry(
        event.currentTarget as HTMLElement,
        entry,
        stay.folios,
        folio.id,
        afterStayChange,
      ),
    { class: 'rowaction' }),
  );
  return actions;
}

function folioRegion(stay: Stay, folio: Folio): HTMLElement {
  const letter = folioLetter(folio.name);
  const payerName = textbox('Payer name', folio.payerName);
  const payerEmail = textbox('Payer email', folio.payerEmail);

  const entriesTable = el('table', { 'aria-label': `Folio ${letter} entries`, class: 'grid-table folio' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Date']),
        el('th', { scope: 'col' }, ['Description']),
        el('th', { scope: 'col' }, ['Amount']),
      ]),
    ]),
    el(
      'tbody',
      {},
      folio.entries.map((entry) =>
        el('tr', { 'data-entry-id': entry.id }, [
          el('td', {}, [entry.date]),
          el('td', {}, [
            el('span', { class: 'entrytext', text: entry.description }),
            ...(folio.state === 'open' ? entryActions(stay, folio, entry) : []),
          ]),
          el('td', { class: 'amount' }, [formatMoney(entry.amountCents)]),
        ]),
      ),
    ),
  ]);

  const controls: Node[] = [
    labelled('Payer name', payerName),
    labelled('Payer email', payerEmail),
    button('Save payer', (event) => {
      const trigger = event.currentTarget as HTMLButtonElement;
      runAction(trigger, pendingTexts.savePayer, regionNames.folioStatus, async () => {
        const result = await call<Folio>(`/api/folios/${folio.id}`, {
          method: 'PATCH',
          body: { payerName: payerName.value.trim(), payerEmail: payerEmail.value.trim() },
        });
        return {
          notice: result.data ? notices.payerSaved : null,
          failure: result.data
            ? null
            : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
        };
      });
    }),
  ];

  if (folio.state === 'open') {
    controls.push(
      button('Add charge', (event) =>
        openAddCharge(event.currentTarget as HTMLElement, folio, afterStayChange),
      ),
      button('Record payment', (event) =>
        openRecordPayment(event.currentTarget as HTMLElement, folio, afterStayChange),
      ),
      button('Close folio', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, pendingTexts.closeFolio, regionNames.folioStatus, async () => {
          const result = await call<Folio>(`/api/folios/${folio.id}/close`, { method: 'POST' });
          return {
            notice:
              result.data && result.data.invoice
                ? notices.invoiceIssued(result.data.invoice.number)
                : null,
            failure: result.data ? null : result.error ?? 'Not found.',
          };
        });
      }),
    );
  }

  if (folio.invoice) {
    const invoice = folio.invoice;
    controls.push(
      button('Email invoice', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, pendingTexts.emailInvoice, regionNames.folioStatus, async () => {
          const result = await call<{ number: string; payerEmail: string }>(
            `/api/invoices/${encodeURIComponent(invoice.id)}/email`,
            { method: 'POST' },
          );
          return {
            notice: result.data
              ? notices.invoiceSent(result.data.number, result.data.payerEmail)
              : null,
            failure: result.data
              ? null
              : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
          };
        });
      }),
      el('a', { href: invoice.pdfUrl, class: 'navlink', target: '_blank', rel: 'noreferrer' }, [
        'Download invoice',
      ]),
    );
  }

  return el('section', { role: 'region', 'aria-label': `Folio ${letter}`, class: 'folioregion' }, [
    el('h3', { text: folio.name }),
    entriesTable,
    el('div', { class: 'figurerow' }, [
      labelledValue(`Folio ${letter} balance`, formatMoney(folio.balanceCents)),
      labelledValue('Invoice state', folio.state === 'closed' ? 'Issued' : 'Draft', 'status'),
      labelledValue(
        'Mail state',
        folio.invoice && folio.invoice.mailState === 'sent' ? 'Sent' : 'Not sent',
        'status',
      ),
    ]),
    el('div', { class: 'actions wrap' }, controls),
  ]);
}

function stayActions(stay: Stay): Node[] {
  const departure = textbox('Departure', stay.departure);
  const moveRoom = select(
    'Move to room',
    [
      { value: '', label: 'Choose' },
      ...(state.timeline ? state.timeline.rooms.map((room) => ({ value: room.id, label: room.number })) : []),
    ],
    '',
  );
  const moveFrom = textbox('Move from night');

  const actions: Node[] = [];
  if (stay.status === 'booked') {
    actions.push(
      button('Check in', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, pendingTexts.checkIn, regionNames.deskNotices, async () => {
          const result = await call<Stay>(`/api/stays/${stay.id}/check-in`, { method: 'POST' });
          return {
            notice: result.data
              ? notices.checkedIn(result.data.guest.name, roomNumberOf(result.data))
              : null,
            failure: result.data ? null : result.error ?? 'Not found.',
          };
        });
      }),
    );
  }
  if (stay.status === 'in_house') {
    actions.push(
      button('Check out', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, pendingTexts.checkOut, regionNames.deskNotices, async () => {
          const result = await call<Stay>(`/api/stays/${stay.id}/check-out`, { method: 'POST' });
          return {
            notice: result.data
              ? notices.checkedOut(result.data.guest.name, roomNumberOf(result.data))
              : null,
            failure: result.data ? null : result.error ?? 'Not found.',
          };
        });
      }),
    );
  }
  if (stay.status === 'booked') {
    actions.push(
      button('Cancel stay', (event) => openCancelStay(event.currentTarget as HTMLElement, stay)),
      button('Resend check-in link', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, pendingTexts.resendLink, regionNames.deskNotices, async () => {
          const result = await call<Stay>(`/api/stays/${stay.id}/checkin-link`, { method: 'POST' });
          return {
            notice: result.data ? notices.linkSent(stay.guest.name) : null,
            failure: result.data ? null : result.error ?? 'Not found.',
          };
        });
      }),
    );
  }

  const saveDates = button('Save dates', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    runAction(trigger, pendingTexts.saveStay, regionNames.deskNotices, async () => {
      const result = await call<Stay>(`/api/stays/${stay.id}`, {
        method: 'PATCH',
        body: { version: stay.version, departure: departure.value.trim() },
      });
      return {
        notice: result.data ? notices.stayUpdated(result.data.guest.name) : null,
        failure: result.data
          ? null
          : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
      };
    });
  });

  const moveButton = button('Move room', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    runAction(trigger, pendingTexts.moveStay, regionNames.deskNotices, async () => {
      const fromNight = moveFrom.value.trim();
      const result = await call<Stay>(`/api/stays/${stay.id}/move`, {
        method: 'POST',
        body: {
          version: stay.version,
          roomId: moveRoom.value,
          ...(fromNight === '' ? {} : { fromNight }),
        },
      });
      const room = state.timeline
        ? state.timeline.rooms.find((candidate) => candidate.id === moveRoom.value)
        : undefined;
      return {
        notice: result.data ? notices.moved(result.data.guest.name, room ? room.number : '') : null,
        failure: result.data
          ? null
          : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
      };
    });
  });

  return [
    el('div', { class: 'actions wrap' }, actions),
    el('div', { class: 'formgrid' }, [
      labelled('Departure', departure),
      labelled('Move to room', moveRoom),
      labelled('Move from night', moveFrom),
    ]),
    el('div', { class: 'actions wrap' }, [
      saveDates,
      moveButton,
      stay.idPhoto === 'received' &&
        el('a', { href: `/api/stays/${stay.id}/id-photo`, class: 'navlink', target: '_blank', rel: 'noreferrer' }, [
          'View ID photo',
        ]),
      button('Add folio', (event) => {
        const trigger = event.currentTarget as HTMLButtonElement;
        runAction(trigger, 'Adding folio…', regionNames.folioStatus, async () => {
          const result = await call<Folio>(`/api/stays/${stay.id}/folios`, {
            method: 'POST',
            body: { payerName: stay.guest.name, payerEmail: stay.guest.email },
          });
          return {
            notice: result.data ? `${result.data.name} added.` : null,
            failure: result.data ? null : result.error ?? 'Not found.',
          };
        });
      }),
    ]),
  ];
}

function roomNumberOf(stay: Stay): string {
  return stay.segments.length > 0 ? stay.segments[stay.segments.length - 1].roomNumber : '';
}

function stayBody(stay: Stay): Node[] {
  return [
    el('h2', { text: `${stay.guest.name}, ${stay.arrival} to ${stay.departure}` }),
    el('p', { class: 'staystatus' }, [
      `Status: ${stay.status}`,
      stay.checkedInOnline ? el('span', { class: 'tag', text: 'Checked in online' }) : null,
    ]),
    stay.checkInNight !== null
      ? el('p', { text: `Checked in for the night of ${stay.checkInNight}` })
      : null,
    labelledValue(
      regionNames.cancellationTerms,
      stay.cancellation ? stay.cancellation.text : '',
      'status',
    ),
    nightlyBreakdown(stay.nightly),
    stayTotal(stay.totalCents),
    ...stayActions(stay),
    statusRegion(regionNames.folioStatus),
    ...stay.folios.map((folio) => folioRegion(stay, folio)),
    el('div', { class: 'actions' }, [button('Close', () => closeStayPanel())]),
  ].filter((node): node is Node => node !== null);
}

function openCancelStay(opener: HTMLElement | null, stay: Stay): void {
  const termsHost = el('div');

  async function refreshTerms(): Promise<void> {
    const result = await call<Stay>(`/api/stays/${stay.id}`);
    const text = result.data && result.data.cancellation ? result.data.cancellation.text : '';
    setMessage(regionNames.cancellationTerms, text);
    termsHost.textContent = text;
  }

  const confirm = button('Confirm cancellation', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    if (trigger.getAttribute('aria-busy') === 'true') return;
    trigger.setAttribute('aria-busy', 'true');
    setMessage(regionNames.deskNotices, pendingTexts.cancelStay);
    void call<Stay>(`/api/stays/${stay.id}/cancel`, { method: 'POST' }).then(async (result) => {
      trigger.removeAttribute('aria-busy');
      if (result.data) {
        const fee = cancellationFeeOf(result.data);
        setMessage(regionNames.deskNotices, notices.cancelled(result.data.guest.name, fee));
        handle.close();
        closeStayPanel();
        await loadDesk();
        render();
        return;
      }
      setMessage(regionNames.deskNotices, result.error ?? 'Not found.');
      await refreshTerms();
    });
  });

  const handle = openDialogFor({
    name: 'Cancel stay',
    role: 'alertdialog',
    opener,
    className: 'panel',
    build: (dialog) => [
      el('h2', { text: 'Cancel stay' }),
      termsHost,
      el('div', { class: 'actions' }, [confirm, button('Keep stay', () => dialog.close())]),
    ],
  });
  void refreshTerms();
}

function cancellationFeeOf(stay: Stay): number {
  const fee = stay.folios
    .flatMap((folio) => folio.entries)
    .filter((entry) => entry.description === 'Late cancellation fee')
    .reduce((total, entry) => total + entry.amountCents, 0);
  return fee;
}
