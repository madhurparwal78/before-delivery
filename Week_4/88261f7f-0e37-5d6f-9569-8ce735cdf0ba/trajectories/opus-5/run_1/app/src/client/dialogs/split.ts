import { NO_FIGURE } from '../../shared/figures';
import { formatMoney } from '../../shared/money';
import { notices, pendingTexts } from '../../shared/notices';
import { LETTERS } from '../../shared/folioNames';
import { MAX_SPLIT_SHARES, splitShares } from '../../shared/split';
import { call } from '../api';
import { openDialogFor } from '../dialog';
import { button, el } from '../dom';
import { regionNames, setMessage } from '../regions';
import { Entry, Folio } from '../types';

const PREVIEW_DELAY_MS = 300;

export function openSplitCharge(
  opener: HTMLElement | null,
  entry: Entry,
  onDone: () => Promise<void>,
): void {
  const fields: HTMLInputElement[] = [];
  const fieldHost = el('div', { class: 'formgrid' });
  const previewHost = el('div', { class: 'breakdown' });
  const apply = button('Apply split', () => void send());
  const addPayer = button('Add payer', () => addField());
  let previewTimer = 0;

  function percentValues(): Array<number | null> {
    return fields.map((field) => {
      const text = field.value.trim();
      if (text === '') return null;
      const value = Number.parseInt(text, 10);
      return Number.isFinite(value) ? value : null;
    });
  }

  function renderPreview(): void {
    const values = percentValues();
    const total = values.reduce((sum: number, value) => sum + (value ?? 0), 0);
    const complete = values.every((value) => value !== null) && total === 100;
    const shares = complete
      ? splitShares(entry.amountCents, values.map((value) => value as number))
      : [];
    while (previewHost.firstChild) previewHost.removeChild(previewHost.firstChild);
    previewHost.append(
      el('table', { 'aria-label': 'Split preview', class: 'grid-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col' }, ['Folio']),
            el('th', { scope: 'col' }, ['Percent']),
            el('th', { scope: 'col' }, ['Share']),
          ]),
        ]),
        el(
          'tbody',
          {},
          values.map((value, index) =>
            el('tr', {}, [
              el('td', {}, [`Folio ${LETTERS[index]}`]),
              el('td', { class: 'amount' }, [value === null ? NO_FIGURE : `${value}%`]),
              el('td', { class: 'amount' }, [complete ? formatMoney(shares[index]) : NO_FIGURE]),
            ]),
          ),
        ),
      ]),
    );
  }

  function schedulePreview(): void {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, PREVIEW_DELAY_MS);
  }

  function addField(): void {
    if (fields.length >= MAX_SPLIT_SHARES) return;
    const name = `Folio ${LETTERS[fields.length]} percent`;
    const field = el('input', { type: 'number', min: '1', max: '100', 'aria-label': name });
    field.addEventListener('input', schedulePreview);
    fields.push(field);
    const id = `split-${fields.length}`;
    field.id = id;
    fieldHost.append(el('div', { class: 'field' }, [el('label', { for: id, text: name }), field]));
    renderPreview();
  }

  async function send(): Promise<void> {
    if (apply.getAttribute('aria-busy') === 'true') return;
    apply.setAttribute('aria-busy', 'true');
    setMessage(regionNames.folioStatus, pendingTexts.split);
    const percents = percentValues().map((value) => value ?? 0);
    const result = await call<{ folios: Folio[] }>(`/api/entries/${entry.id}/split`, {
      method: 'POST',
      body: { percents },
    });
    apply.removeAttribute('aria-busy');
    if (result.data) {
      setMessage(
        regionNames.folioStatus,
        notices.splitDone(entry.amountCents, percents.length),
      );
      handle.close();
      await onDone();
      return;
    }
    setMessage(
      regionNames.folioStatus,
      result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
    );
  }

  const handle = openDialogFor({
    name: 'Split charge',
    opener,
    className: 'panel wide',
    build: (dialog) => [
      el('h2', { text: 'Split charge' }),
      el('p', { text: `${entry.description} ${formatMoney(entry.amountCents)}` }),
      fieldHost,
      addPayer,
      previewHost,
      el('div', { class: 'actions' }, [apply, button('Close', () => dialog.close())]),
    ],
  });
  addField();
  addField();
  if (fields.length > 0) fields[0].focus();
}
