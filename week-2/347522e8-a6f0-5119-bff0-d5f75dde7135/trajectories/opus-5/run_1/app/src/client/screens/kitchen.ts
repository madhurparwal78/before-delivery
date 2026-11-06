/**
 * My kitchen: the hour packs and balance, the hour ledger, the compliance
 * documents and the monthly statements.
 *
 * Pack availability is re-asked every 15 seconds and whenever the window
 * regains focus; no earlier answer is relied on beyond the next check.
 */

import { api, ApiError, inBackground, messageFor } from '../api.js';
import { serverNow } from '../clock.js';
import * as copy from '../../shared/copy.js';
import { formatHours, formatSignedHours } from '../../shared/format.js';
import {
  kitchenDate,
  kitchenHhmm,
  kitchenZoneAbbrev,
  monthOf,
} from '../../shared/kitchenTime.js';
import type {
  ComplianceDocument,
  LedgerResponse,
  Pack,
  PacksResponse,
  RenterSummary,
  Statement,
  StationsResponse,
} from '../../shared/types.js';
import { clear, el, field, icon, setFieldError } from '../dom.js';
import { DOCUMENT_KINDS, documentWord, latestPerKind } from '../documentWord.js';
import { currentUser } from '../session.js';
import type { Cleanup, ScreenContext } from '../router.js';

const RECHECK_MS = 15_000;

const MOVEMENT_WORDS: Record<string, string> = {
  opening_balance: 'Opening balance',
  pack_purchase: 'Pack purchase',
  booking_hold: 'Booking hold',
  hold_release: 'Hold released',
  cancellation_credit: 'Cancellation credit',
  displacement_credit: 'Displacement credit',
  adjustment: 'Adjustment',
};

function stamp(iso: string): string {
  const ms = Date.parse(iso);
  return `${kitchenDate(ms)} ${kitchenHhmm(ms)} ${kitchenZoneAbbrev(ms)}`;
}

export function kitchenScreen(context: ScreenContext): Cleanup {
  const user = currentUser();
  if (user === null || user.renter_id === null) return () => undefined;
  const renterId = user.renter_id;

  let today = kitchenDate(serverNow());
  let purchasesAvailable = true;

  const applicationStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Application status', 'aria-live': 'polite' },
  });
  if (user.renter_status === 'applied') applicationStatus.textContent = copy.APPLY_SUCCESS;

  // ---------- packs ----------

  const balanceStatus = el('p', {
    class: 'docket__balance',
    attrs: { role: 'status', 'aria-label': 'Hour balance', 'aria-live': 'polite' },
  });
  const outageNotice = el('p', { class: 'status status--alert', attrs: { hidden: true } });
  const purchaseStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Purchase status', 'aria-live': 'polite' },
  });
  const packList = el('div', {});
  const buyButtons = new Map<string, HTMLButtonElement>();

  const packsRegion = el('section', {
    class: 'panel',
    attrs: { role: 'region', 'aria-label': 'Hour packs' },
  }, [
    el('h2', { text: 'Hour packs' }),
    el('p', { class: 'docket__label', text: 'Hour balance' }),
    balanceStatus,
    outageNotice,
    packList,
    purchaseStatus,
  ]);

  function renderPacks(packs: readonly Pack[]): void {
    clear(packList);
    buyButtons.clear();
    for (const pack of packs) {
      const button = el('button', {
        class: 'btn btn--primary',
        text: `Buy ${pack.name}`,
        attrs: { type: 'button' },
      });
      button.addEventListener('click', () => void buy(pack, button));
      buyButtons.set(pack.id, button);
      packList.append(
        el('div', { class: 'docket__row' }, [
          el('p', { class: 'mono', text: `${pack.name} \u00b7 ${pack.hours} hours \u00b7 $${pack.amount_usd}` }),
          button,
        ]),
      );
    }
    applyAvailability();
  }

  function applyAvailability(): void {
    for (const button of buyButtons.values()) button.disabled = !purchasesAvailable;
    outageNotice.hidden = purchasesAvailable;
    clear(outageNotice);
    if (!purchasesAvailable) {
      outageNotice.append(icon('triangle-alert'), el('span', { text: copy.PURCHASE_UNAVAILABLE }));
    }
  }

  async function buy(pack: Pack, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    purchaseStatus.textContent = copy.PURCHASE_PENDING;
    const key = `pack-${pack.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    try {
      const answer = await api.post<{ balance_minutes: number }>(
        '/api/purchases',
        { pack_id: pack.id },
        { 'Idempotency-Key': key },
      );
      purchaseStatus.textContent = copy.purchasePaid(formatHours(pack.hours * 60));
      balanceStatus.textContent = `${formatHours(answer.balance_minutes)} h`;
      await loadLedger();
      button.disabled = !purchasesAvailable;
    } catch (error) {
      button.disabled = !purchasesAvailable;
      purchaseStatus.textContent = messageFor(error, {
        billing_unavailable: copy.PURCHASE_UNAVAILABLE,
        payment_failed: copy.PURCHASE_DECLINED,
        renter_not_active: copy.RENTER_NOT_ACTIVE,
      });
    }
  }

  async function checkAvailability(): Promise<void> {
    try {
      const answer = await api.get<PacksResponse>('/api/packs');
      if (buyButtons.size === 0) renderPacks(answer.packs);
      const wasAvailable = purchasesAvailable;
      purchasesAvailable = answer.purchases_available;
      applyAvailability();
      if (!purchasesAvailable && wasAvailable) {
        purchaseStatus.textContent = copy.PURCHASE_UNAVAILABLE;
      } else if (purchasesAvailable && !wasAvailable) {
        purchaseStatus.textContent = copy.PURCHASE_AVAILABLE_AGAIN;
      }
    } catch {
      purchasesAvailable = false;
      applyAvailability();
    }
  }

  // ---------- ledger ----------

  const ledgerBody = el('tbody', {});
  const ledgerEmpty = el('p', { class: 'empty', text: copy.EMPTY_LEDGER, attrs: { hidden: true } });
  const ledgerPanel = el('section', { class: 'panel' }, [
    el('h2', { text: 'Hour ledger' }),
    el('table', { attrs: { 'aria-label': 'Hour ledger' }, class: 'card-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'When' }),
          el('th', { text: 'Movement' }),
          el('th', { class: 'num', text: 'Hours' }),
          el('th', { class: 'num', text: 'Balance' }),
        ]),
      ]),
      ledgerBody,
    ]),
    ledgerEmpty,
  ]);

  async function loadLedger(): Promise<void> {
    const answer = await api.get<LedgerResponse>(`/api/renters/${renterId}/ledger`);
    const available = `renter:${renterId}:available`;
    const rows = answer.entries.filter((entry) => entry.account === available);
    clear(ledgerBody);
    let running = 0;
    for (const entry of rows) {
      const signed = entry.direction === 'credit' ? entry.minutes : -entry.minutes;
      running += signed;
      ledgerBody.append(
        el('tr', {}, [
          el('td', { text: stamp(entry.created_at), attrs: { 'data-label': 'When' } }),
          el('td', {
            text: MOVEMENT_WORDS[entry.kind] ?? entry.kind,
            attrs: { 'data-label': 'Movement' },
          }),
          el('td', {
            class: 'num',
            text: formatSignedHours(signed),
            attrs: { 'data-label': 'Hours' },
          }),
          el('td', {
            class: 'num',
            text: formatHours(running),
            attrs: { 'data-label': 'Balance' },
          }),
        ]),
      );
    }
    ledgerEmpty.hidden = rows.length > 0;
    balanceStatus.textContent = `${formatHours(answer.balance_minutes)} h`;
  }

  // ---------- documents ----------

  const kindSelect = el('select', {}, [
    el('option', { text: 'Certificate of insurance', attrs: { value: 'coi' } }),
    el('option', { text: 'Food-handler card', attrs: { value: 'food_handler_card' } }),
    el('option', { text: 'Business licence', attrs: { value: 'business_licence' } }),
  ]);
  const expiryInput = el('input', { attrs: { type: 'text', inputmode: 'numeric', placeholder: 'YYYY-MM-DD' } });
  const fileInput = el('input', { attrs: { type: 'file', accept: '.pdf,.png,.jpg,.jpeg' } });
  const kindField = field('Document type', kindSelect, 'doc-kind');
  const expiryField = field('Expiry date', expiryInput, 'doc-expiry');
  const fileField = field('Scan file', fileInput, 'doc-file');
  const uploadButton = el('button', {
    class: 'btn btn--primary',
    text: 'Upload document',
    attrs: { type: 'submit' },
  });
  const uploadStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Upload status', 'aria-live': 'polite' },
  });
  const documentRows = el('div', {});

  const uploadForm = el('form', {}, [
    kindField.wrapper,
    expiryField.wrapper,
    fileField.wrapper,
    uploadButton,
  ]);

  const documentsRegion = el('section', {
    class: 'panel',
    attrs: { role: 'region', 'aria-label': 'Documents' },
  }, [el('h2', { text: 'Documents' }), documentRows, uploadForm, uploadStatus]);

  function renderDocuments(documents: readonly ComplianceDocument[]): void {
    clear(documentRows);
    for (const document of latestPerKind(documents)) {
      const label = copy.DOCUMENT_LABELS[document.kind];
      documentRows.append(
        el('div', { class: 'share__doc' }, [
          el('span', { text: label }),
          el('span', { class: 'mono', text: document.expires_on ?? 'no expiry' }),
          el('span', { class: 'tag', text: documentWord(document, today) }),
          el('a', {
            text: `View ${label}`,
            attrs: { href: `/api/documents/${document.id}/file`, 'data-external': 'true' },
          }),
        ]),
      );
    }
  }

  uploadForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(expiryField.error, null);
    setFieldError(fileField.error, null);
    setFieldError(kindField.error, null);
    const file = fileInput.files?.[0];
    if (!file) {
      setFieldError(fileField.error, 'Attach a scan file.');
      return;
    }
    const form = new FormData();
    form.set('kind', kindSelect.value);
    if (expiryInput.value.trim() !== '') form.set('expires_on', expiryInput.value.trim());
    form.set('file', file);

    uploadButton.disabled = true;
    uploadStatus.textContent = copy.UPLOAD_PENDING;
    void (async () => {
      try {
        const answer = await api.upload<{ document: ComplianceDocument }>(
          `/api/renters/${renterId}/documents`,
          form,
        );
        uploadStatus.textContent = copy.uploadSuccess(copy.DOCUMENT_LABELS[answer.document.kind]);
        uploadForm.reset();
        await loadDocuments();
      } catch (error) {
        uploadStatus.textContent = '';
        if (error instanceof ApiError && error.status === 422) {
          for (const [key, message] of Object.entries(error.fieldErrors)) {
            if (key === 'expires_on') setFieldError(expiryField.error, message);
            else if (key === 'file') setFieldError(fileField.error, message);
            else setFieldError(kindField.error, message);
          }
        } else {
          uploadStatus.textContent = messageFor(error, {
            file_too_large: copy.UPLOAD_TOO_LARGE,
            unsupported_type: copy.UPLOAD_WRONG_TYPE,
            storage_unavailable: copy.STORAGE_UNREACHABLE,
            renter_offboarded: copy.RENTER_NOT_ACTIVE,
          });
        }
      } finally {
        uploadButton.disabled = false;
      }
    })();
  });

  async function loadDocuments(): Promise<void> {
    const answer = await api.get<{ documents: ComplianceDocument[] }>(
      `/api/renters/${renterId}/documents`,
    );
    renderDocuments(answer.documents);
  }

  // ---------- statements ----------

  const monthInput = el('input', {
    attrs: { type: 'text', inputmode: 'numeric', placeholder: 'YYYY-MM' },
  });
  const monthField = field('Statement month', monthInput, 'statement-month');
  const createStatement = el('button', {
    class: 'btn btn--primary',
    text: 'Create statement',
    attrs: { type: 'submit' },
  });
  const statementStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Statement status', 'aria-live': 'polite' },
  });
  const statementList = el('div', {});
  const statementForm = el('form', {}, [monthField.wrapper, createStatement]);

  const statementsRegion = el('section', {
    class: 'panel',
    attrs: { role: 'region', 'aria-label': 'Statements' },
  }, [el('h2', { text: 'Statements' }), statementList, statementForm, statementStatus]);

  function renderStatements(statements: readonly Statement[]): void {
    clear(statementList);
    if (statements.length === 0) {
      statementList.append(el('p', { class: 'empty', text: copy.EMPTY_STATEMENTS }));
      return;
    }
    for (const statement of statements) {
      statementList.append(
        el('p', {}, [
          el('a', {
            text: `Download ${statement.month} statement`,
            attrs: { href: `/api/statements/${statement.id}/file`, 'data-external': 'true' },
          }),
        ]),
      );
    }
  }

  statementForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(monthField.error, null);
    createStatement.disabled = true;
    statementStatus.textContent = copy.STATEMENT_PENDING;
    void (async () => {
      try {
        const month = monthInput.value.trim();
        const answer = await api.post<{ statement: Statement }>(
          `/api/renters/${renterId}/statements`,
          { month },
        );
        statementStatus.textContent = copy.statementReady(answer.statement.month);
        await loadStatements();
      } catch (error) {
        statementStatus.textContent = '';
        if (error instanceof ApiError && error.status === 422) {
          setFieldError(monthField.error, error.fieldErrors['month'] ?? copy.GENERIC_ERROR);
        } else {
          statementStatus.textContent = messageFor(error, {
            storage_unavailable: copy.STORAGE_UNREACHABLE,
          });
        }
      } finally {
        createStatement.disabled = false;
      }
    })();
  });

  async function loadStatements(): Promise<void> {
    const answer = await api.get<{ statements: Statement[] }>(
      `/api/renters/${renterId}/statements`,
    );
    renderStatements(answer.statements);
  }

  // ---------- layout ----------

  const heading = el('h1', { text: 'My kitchen', attrs: { tabindex: '-1' } });
  context.root.append(
    heading,
    applicationStatus,
    el('div', { class: 'cols cols--3' }, [
      packsRegion,
      ledgerPanel,
      el('div', {}, [documentsRegion, statementsRegion]),
    ]),
  );
  heading.focus();

  let timer = 0;
  const onFocus = (): void => inBackground(() => checkAvailability());

  inBackground(async () => {
    const stations = await api.get<StationsResponse>('/api/stations');
    today = stations.date;
    monthInput.value = monthOf(today);
    const renter = await api.get<{ renter: RenterSummary }>(`/api/renters/${renterId}`);
    balanceStatus.textContent = `${formatHours(renter.renter.balance_minutes)} h`;
    await checkAvailability();
    await Promise.all([loadLedger(), loadDocuments(), loadStatements()]);
    timer = window.setInterval(() => inBackground(() => checkAvailability()), RECHECK_MS);
    window.addEventListener('focus', onFocus);
  });

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}
