import { formatAmountField, parseAmountToCents } from '../../shared/money';
import { notices, pendingTexts } from '../../shared/notices';
import { call } from '../api';
import { openDialogFor } from '../dialog';
import { button, el, labelled, select, textbox } from '../dom';
import { folioLetter } from '../../shared/folioNames';
import { regionNames, setMessage } from '../regions';
import { Entry, Folio } from '../types';

function reportFailure(result: { error: string | null; fieldErrors: Record<string, string> | null }):
  void {
  setMessage(
    regionNames.folioStatus,
    result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
  );
}

export function openAddCharge(
  opener: HTMLElement | null,
  folio: Folio,
  onDone: () => Promise<void>,
): void {
  const description = textbox('Description');
  const amount = textbox('Amount');
  const save = button('Save charge', () => void send());

  async function send(): Promise<void> {
    if (save.getAttribute('aria-busy') === 'true') return;
    save.setAttribute('aria-busy', 'true');
    setMessage(regionNames.folioStatus, pendingTexts.addCharge);
    const result = await call<Entry>(`/api/folios/${folio.id}/charges`, {
      method: 'POST',
      body: { description: description.value.trim(), amountCents: parseAmountToCents(amount.value) ?? 0 },
    });
    save.removeAttribute('aria-busy');
    if (result.data) {
      setMessage(regionNames.folioStatus, notices.chargeAdded(result.data.amountCents));
      handle.close();
      await onDone();
      return;
    }
    reportFailure(result);
  }

  const handle = openDialogFor({
    name: 'Add charge',
    opener,
    className: 'panel',
    build: (dialog) => [
      el('h2', { text: 'Add charge' }),
      labelled('Description', description),
      labelled('Amount', amount),
      el('div', { class: 'actions' }, [save, button('Close', () => dialog.close())]),
    ],
  });
}

export function openRecordPayment(
  opener: HTMLElement | null,
  folio: Folio,
  onDone: () => Promise<void>,
): void {
  const method = select(
    'Payment method',
    [
      { value: 'cash', label: 'Cash' },
      { value: 'card', label: 'Card' },
    ],
    'cash',
  );
  const amount = textbox(
    'Amount',
    folio.balanceCents > 0 ? formatAmountField(folio.balanceCents) : '',
  );
  const reference = textbox('Terminal reference');
  const save = button('Save payment', () => void send());

  async function send(): Promise<void> {
    if (save.getAttribute('aria-busy') === 'true') return;
    save.setAttribute('aria-busy', 'true');
    setMessage(regionNames.folioStatus, pendingTexts.recordPayment);
    const result = await call<Entry>(`/api/folios/${folio.id}/payments`, {
      method: 'POST',
      body: {
        method: method.value,
        amountCents: parseAmountToCents(amount.value) ?? 0,
        reference: reference.value.trim(),
      },
    });
    save.removeAttribute('aria-busy');
    if (result.data) {
      setMessage(regionNames.folioStatus, notices.paymentRecorded(result.data.amountCents));
      handle.close();
      await onDone();
      return;
    }
    reportFailure(result);
  }

  const handle = openDialogFor({
    name: 'Record payment',
    opener,
    className: 'panel',
    build: (dialog) => [
      el('h2', { text: 'Record payment' }),
      labelled('Payment method', method),
      labelled('Amount', amount),
      labelled('Terminal reference', reference),
      el('div', { class: 'actions' }, [save, button('Close', () => dialog.close())]),
    ],
  });
}

export function openMoveEntry(
  opener: HTMLElement | null,
  entry: Entry,
  folios: Folio[],
  currentFolioId: string,
  onDone: () => Promise<void>,
): void {
  const targets = folios.filter((folio) => folio.id !== currentFolioId && folio.state === 'open');
  const toFolio = select(
    'To folio',
    [
      { value: '', label: 'Choose' },
      ...targets.map((folio) => ({ value: folio.id, label: folio.name })),
    ],
    '',
  );
  const save = button('Save move', () => void send());

  async function send(): Promise<void> {
    if (save.getAttribute('aria-busy') === 'true') return;
    save.setAttribute('aria-busy', 'true');
    setMessage(regionNames.folioStatus, pendingTexts.moveEntry);
    const result = await call<{ folios: Folio[] }>(`/api/entries/${entry.id}/move`, {
      method: 'POST',
      body: { toFolioId: toFolio.value },
    });
    save.removeAttribute('aria-busy');
    if (result.data) {
      const target = targets.find((folio) => folio.id === toFolio.value);
      setMessage(
        regionNames.folioStatus,
        notices.entryMoved(target ? folioLetter(target.name) : ''),
      );
      handle.close();
      await onDone();
      return;
    }
    reportFailure(result);
  }

  const handle = openDialogFor({
    name: 'Move entry',
    opener,
    className: 'panel',
    build: (dialog) => [
      el('h2', { text: 'Move entry' }),
      labelled('To folio', toFolio),
      el('div', { class: 'actions' }, [save, button('Close', () => dialog.close())]),
    ],
  });
}
