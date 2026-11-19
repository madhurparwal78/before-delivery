import { getJson, requestJson, type ApiResult } from '../shared/api.ts';
import { clear, el, preserveFocus } from '../shared/dom.ts';
import { centsToDecimalString, formatMoney, formatShare, parseDollarsToCents, splitMilestones, MILESTONE_DEFINITIONS, type Milestone } from '../../shared/money.ts';
import { ENQUIRY_STATUSES, ENQUIRY_STATUS_LABELS, type EnquiryStatus } from '../../shared/enquiryStatus.ts';
import { formatIsoCalendarDate, monthLabel } from '../../shared/dates.ts';
import { ICONS, icon } from '../shared/icons.ts';
import { openDialog } from './dialog.ts';
import type { ConsoleEnquiry, MailState, ProductionMonth } from './types.ts';

const PAGE_SIZE = 25;
const LIST_POLL_MS = 2_000;
const MONTH_POLL_MS = 2_000;
const INVOICE_POLL_MS = 2_000;
const PREVIEW_DEBOUNCE_MS = 400;

const MILESTONE_STATE_COPY = {
  'not-invoiced': 'Not invoiced',
  invoicing: 'Invoicing\u2026',
  invoiced: 'Invoiced',
} as const;

type MilestoneState = keyof typeof MILESTONE_STATE_COPY;

type TriageValues = { notes: string; fit: number | null; floor: number | null };

type EmailSnapshot = Record<string, Partial<Record<'receipt' | 'proposal' | 'month_held' | 'deposit', MailState>>>;

function triageOf(enquiry: ConsoleEnquiry): TriageValues {
  return { notes: enquiry.triage_notes, fit: enquiry.fit_score, floor: enquiry.rate_floor_cents };
}

function floorText(cents: number | null): string {
  return cents === null ? '' : centsToDecimalString(cents);
}

export type EnquiriesView = {
  element: HTMLElement;
  activate: () => void;
  deactivate: () => void;
};

export function createEnquiriesView(setStatus: (text: string) => void): EnquiriesView {
  const statusFilter = el(
    'select',
    { class: 'console-input', 'aria-label': 'Status' },
    [
      el('option', { value: '', text: 'All statuses' }),
      ...ENQUIRY_STATUSES.map((status) => el('option', { value: status, text: ENQUIRY_STATUS_LABELS[status] })),
    ],
  );
  const exportLink = el('a', { class: 'console-link', href: '/api/console/enquiries.csv' }, [
    icon(ICONS.download),
    el('span', { text: 'Export CSV' }),
  ]);
  const list = el('ul', { class: 'console-list', role: 'list', 'aria-label': 'Enquiries' });
  const showMore = el('button', { type: 'button', class: 'secondary', text: 'Show more enquiries' });
  const listPane = el('div', { class: 'pane list-pane' }, [
    el('div', { class: 'list-tools' }, [statusFilter, exportLink]),
    list,
    showMore,
  ]);
  const detailPane = el('div', { class: 'pane detail-pane' });
  const element = el('div', { class: 'two-pane' }, [listPane, detailPane]);

  let rows: ConsoleEnquiry[] = [];
  let hasMore = false;
  let nextCursor: string | null = null;
  let selectedId: string | null = null;
  let detail: ConsoleEnquiry | null = null;
  let detailVersion = 0;
  let lastLoadedTriage: TriageValues = { notes: '', fit: null, floor: null };
  let emailSnapshot: EmailSnapshot = {};
  let announcedOnce = false;
  let listTimer: number | null = null;
  let invoiceTimer: number | null = null;
  let invoicePending = false;
  let optimisticMilestone: number | null = null;

  const triageNotes = el('textarea', { id: 'triage-notes', rows: 5, class: 'console-input', 'aria-label': 'Triage notes' });
  const fitScore = el('input', { id: 'triage-fit', type: 'number', min: 1, max: 5, step: 1, class: 'console-input', 'aria-label': 'Fit score' });
  const rateFloor = el('input', { id: 'triage-floor', type: 'text', class: 'console-input', 'aria-label': 'Rate floor (USD)' });
  const conflictRegion = el('div', { class: 'conflict-region', role: 'region', 'aria-label': 'Changed in another window' });
  const saveTriage = el('button', { type: 'button', class: 'primary', text: 'Save triage' });

  const badgeText = (enquiry: ConsoleEnquiry): string[] => {
    const badges = [enquiry.receipt === 'sent' ? 'Receipt sent' : 'Receipt pending'];
    const proposal = enquiry.proposal;
    if (proposal !== null) {
      if (proposal.email === 'cancelled') badges.push('Proposal email cancelled');
      else if (proposal.email !== null) {
        badges.push(proposal.email === 'sent' ? 'Proposal email sent' : 'Proposal email pending');
      }
      if (proposal.held_email !== null) {
        badges.push(proposal.held_email === 'sent' ? 'Month-held email sent' : 'Month-held email pending');
      }
      if (proposal.deposit_email !== null) {
        badges.push(proposal.deposit_email === 'sent' ? 'Deposit email sent' : 'Deposit email pending');
      }
    }
    return badges;
  };

  const snapshotOf = (): EmailSnapshot => {
    const snapshot: EmailSnapshot = {};
    for (const row of rows) {
      snapshot[row.reference] = {
        receipt: row.receipt ?? undefined,
        proposal: row.proposal?.email ?? undefined,
        month_held: row.proposal?.held_email ?? undefined,
        deposit: row.proposal?.deposit_email ?? undefined,
      };
    }
    return snapshot;
  };

  const announceDeliveries = (previous: EmailSnapshot): void => {
    const kinds: Array<['receipt' | 'proposal' | 'month_held' | 'deposit', string]> = [
      ['receipt', 'Receipt'],
      ['proposal', 'Proposal email'],
      ['month_held', 'Month-held email'],
      ['deposit', 'Deposit email'],
    ];
    const sentences: string[] = [];
    for (const reference of Object.keys(previous).sort()) {
      const before = previous[reference] ?? {};
      const after = emailSnapshot[reference];
      if (after === undefined) continue;
      for (const [kind, label] of kinds) {
        if (before[kind] === 'pending' && after[kind] === 'sent') {
          sentences.push(`${label} for ${reference} sent.`);
        }
      }
    }
    if (sentences.length > 0) setStatus(sentences.join(' '));
  };

  const renderRows = (): void => preserveFocus(() => {
    const pane = listPane;
    const anchor = (() => {
      for (const item of [...list.children] as HTMLElement[]) {
        if (item.offsetTop + item.offsetHeight > pane.scrollTop) {
          return { reference: item.dataset.reference ?? '', delta: item.offsetTop - pane.scrollTop };
        }
      }
      return null;
    })();

    clear(list);
    for (const row of rows) {
      const open = el('button', { type: 'button', class: 'list-row', 'aria-label': `Open ${row.reference}` }, [
        el('span', { class: 'mono row-reference', text: row.reference }),
        el('span', { class: 'row-studio', text: row.studio }),
        el('span', { class: 'row-status', text: ENQUIRY_STATUS_LABELS[row.status] }),
        ...badgeText(row).map((badge) =>
          el('span', { class: `badge ${badge.endsWith('sent') ? 'badge-sent' : 'badge-pending'}`, text: badge }),
        ),
      ]);
      if (row.id === selectedId) open.setAttribute('aria-current', 'true');
      open.addEventListener('click', () => void select(row.id));
      list.append(el('li', { 'data-reference': row.reference }, [open]));
    }
    showMore.hidden = !hasMore;

    if (anchor !== null) {
      const item = [...list.children].find(
        (candidate) => (candidate as HTMLElement).dataset.reference === anchor.reference,
      ) as HTMLElement | undefined;
      if (item !== undefined) pane.scrollTop = item.offsetTop - anchor.delta;
    }
  });

  const fetchPage = async (cursor: string | null): Promise<{ enquiries: ConsoleEnquiry[]; next_cursor: string | null } | null> => {
    const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (statusFilter.value !== '') search.set('status', statusFilter.value);
    if (cursor !== null) search.set('cursor', cursor);
    const result = await getJson<{ enquiries: ConsoleEnquiry[]; next_cursor: string | null }>(
      `/api/console/enquiries?${search.toString()}`,
    );
    return result.ok ? result.data : null;
  };

  const reload = async (): Promise<void> => {
    const oldestShown = rows[rows.length - 1]?.reference;
    const collected: ConsoleEnquiry[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await fetchPage(cursor);
      if (page === null) {
        setStatus('Older enquiries could not load. Press Show more enquiries to try again.');
        return;
      }
      collected.push(...page.enquiries);
      cursor = page.next_cursor;
      const last = collected[collected.length - 1]?.reference;
      if (cursor === null) break;
      if (oldestShown === undefined || last === undefined || last <= oldestShown) break;
    }
    rows = collected;
    nextCursor = cursor;
    hasMore = cursor !== null;
    const previous = emailSnapshot;
    emailSnapshot = snapshotOf();
    renderRows();
    if (announcedOnce) announceDeliveries(previous);
    announcedOnce = true;
  };

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null) return;
    const page = await fetchPage(nextCursor);
    if (page === null) {
      setStatus('Older enquiries could not load. Press Show more enquiries to try again.');
      return;
    }
    rows = [...rows, ...page.enquiries];
    nextCursor = page.next_cursor;
    hasMore = page.next_cursor !== null;
    emailSnapshot = snapshotOf();
    const appended = page.enquiries[0]?.reference;
    renderRows();
    if (!hasMore && appended !== undefined) {
      list
        .querySelector<HTMLElement>(`button[aria-label="Open ${appended}"]`)
        ?.focus();
    }
  };

  const select = async (id: string): Promise<void> => {
    const result = await getJson<{ enquiry: ConsoleEnquiry }>(`/api/console/enquiries/${id}`);
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    selectedId = id;
    element.classList.add('show-detail');
    detail = result.data.enquiry;
    detailVersion = detail.version;
    lastLoadedTriage = triageOf(detail);
    clear(conflictRegion);
    renderRows();
    renderDetail(true);
  };

  const adoptEnquiry = (enquiry: ConsoleEnquiry, keepNotes: boolean): void => {
    const typedNotes = triageNotes.value;
    detail = enquiry;
    detailVersion = enquiry.version;
    lastLoadedTriage = triageOf(enquiry);
    renderDetail(true);
    if (keepNotes) triageNotes.value = typedNotes;
  };

  const writeEnquiry = async (
    path: string,
    body: Record<string, unknown>,
    method: 'POST' | 'PATCH' = 'POST',
  ): Promise<ApiResult<{ enquiry: ConsoleEnquiry }>> =>
    requestJson<{ enquiry: ConsoleEnquiry }>(method, path, {
      body,
      headers: { 'If-Match': `"${detailVersion}"` },
    });

  const mergeTriage = (theirs: ConsoleEnquiry): void => {
    const mine: TriageValues = {
      notes: triageNotes.value,
      fit: fitScore.value === '' ? null : Number(fitScore.value),
      floor: rateFloor.value.trim() === '' ? null : parseDollarsToCents(rateFloor.value),
    };
    const base = lastLoadedTriage;
    const theirValues = triageOf(theirs);
    const conflicts: Array<'notes' | 'fit' | 'floor'> = [];

    const resolve = <Key extends keyof TriageValues>(key: Key): void => {
      const theirValue = theirValues[key];
      const myValue = mine[key];
      const baseValue = base[key];
      if (theirValue !== baseValue && myValue === baseValue) {
        mine[key] = theirValue;
        return;
      }
      if (myValue !== baseValue && theirValue === baseValue) return;
      if (myValue === theirValue) return;
      if (myValue !== baseValue && theirValue !== baseValue) conflicts.push(key);
    };
    resolve('notes');
    resolve('fit');
    resolve('floor');

    triageNotes.value = mine.notes;
    fitScore.value = mine.fit === null ? '' : String(mine.fit);
    rateFloor.value = floorText(mine.floor);
    detail = theirs;
    detailVersion = theirs.version;
    lastLoadedTriage = theirValues;

    clear(conflictRegion);
    if (conflicts.length === 0) {
      setStatus('This enquiry changed in another window. Their changes are merged in; save again to apply yours.');
      return;
    }
    setStatus(
      'This enquiry changed in another window. Choose which value to keep for each field shown, then save again.',
    );
    const descriptions: Record<'notes' | 'fit' | 'floor', { label: string; show: (value: TriageValues) => string; apply: (value: TriageValues) => void }> = {
      notes: {
        label: 'Triage notes',
        show: (value) => (value.notes === '' ? '(empty)' : value.notes),
        apply: (value) => {
          triageNotes.value = value.notes;
        },
      },
      fit: {
        label: 'Fit score',
        show: (value) => (value.fit === null ? '(empty)' : String(value.fit)),
        apply: (value) => {
          fitScore.value = value.fit === null ? '' : String(value.fit);
        },
      },
      floor: {
        label: 'Rate floor (USD)',
        show: (value) => (value.floor === null ? '(empty)' : formatMoney(value.floor)),
        apply: (value) => {
          rateFloor.value = floorText(value.floor);
        },
      },
    };
    const typed: TriageValues = { ...mine };
    for (const key of ['notes', 'fit', 'floor'] as const) {
      if (!conflicts.includes(key)) continue;
      const description = descriptions[key];
      const name = `conflict-${key}`;
      const keepMine = el('input', { type: 'radio', name, id: `${name}-mine`, checked: true });
      const useTheirs = el('input', { type: 'radio', name, id: `${name}-theirs` });
      keepMine.addEventListener('change', () => description.apply(typed));
      useTheirs.addEventListener('change', () => description.apply(theirValues));
      conflictRegion.append(
        el('div', { class: 'conflict-entry' }, [
          el('p', { text: `Theirs: ${description.show(theirValues)}` }),
          el('p', { text: `Yours: ${description.show(typed)}` }),
          el('div', { role: 'radiogroup', 'aria-label': description.label }, [
            el('label', { for: `${name}-mine` }, [keepMine, document.createTextNode(' Keep mine')]),
            el('label', { for: `${name}-theirs` }, [useTheirs, document.createTextNode(' Use theirs')]),
          ]),
        ]),
      );
    }
  };

  const onStaleWrite = (enquiry: ConsoleEnquiry, kind: 'triage' | 'invoice' | 'other'): void => {
    if (kind === 'triage') {
      mergeTriage(enquiry);
      return;
    }
    adoptEnquiry(enquiry, true);
    setStatus(
      kind === 'invoice'
        ? 'This enquiry changed in another window. The milestones shown are the current state.'
        : 'This enquiry changed in another window. The latest version is shown; save again to apply your edit.',
    );
  };

  const milestoneList = el('ul', {
    class: 'console-list milestone-list',
    role: 'list',
    'aria-label': 'Milestone invoices',
    tabindex: -1,
  });

  const renderMilestones = (enquiry: ConsoleEnquiry): HTMLElement => {
    const container = el('div', { class: 'milestone-area' });
    clear(milestoneList);
    const proposal = enquiry.proposal;
    if (proposal === null) return container;
    const milestones = splitMilestones(proposal.fee_cents);
    let firstNotInvoiced: number | null = null;
    for (const number of [2, 3, 4]) {
      const milestone = milestones[number - 1] as Milestone;
      let state: MilestoneState = proposal.invoiced_milestones.includes(number) ? 'invoiced' : 'not-invoiced';
      if (optimisticMilestone === number && state === 'not-invoiced') state = 'invoicing';
      if (state === 'not-invoiced' && firstNotInvoiced === null) firstNotInvoiced = number;
      milestoneList.append(
        el('li', { 'data-milestone': number, 'data-state': state }, [
          document.createTextNode(
            `Milestone ${number}: ${milestone.name}, ${formatMoney(milestone.amount_cents)}. ${MILESTONE_STATE_COPY[state]}`,
          ),
        ]),
      );
    }
    container.append(milestoneList);
    if (firstNotInvoiced !== null && optimisticMilestone === null) {
      const number = firstNotInvoiced;
      const button = el('button', { type: 'button', class: 'primary', text: `Invoice milestone ${number}` });
      button.addEventListener('click', () => void invoiceMilestone(number));
      container.append(button);
    }
    return container;
  };

  const invoiceMilestone = async (number: number): Promise<void> => {
    if (detail === null) return;
    const enquiryId = detail.id;
    optimisticMilestone = number;
    invoicePending = true;
    renderDetail(false);
    milestoneList.focus();

    const result = await requestJson<{ milestone: { amount_cents: number; invoice_date: string }; enquiry: ConsoleEnquiry }>(
      'POST',
      `/api/console/enquiries/${enquiryId}/milestones/${number}/invoice`,
      { body: {}, headers: { 'If-Match': `"${detailVersion}"` } },
    );
    optimisticMilestone = null;
    invoicePending = false;

    if (result.ok) {
      adoptEnquiry(result.data.enquiry, true);
      setStatus(
        `Milestone ${number} invoiced: ${formatMoney(result.data.milestone.amount_cents)} on ${formatIsoCalendarDate(
          result.data.milestone.invoice_date,
        )}.`,
      );
      return;
    }
    if (result.status === 412) {
      onStaleWrite(result.body.current as ConsoleEnquiry, 'invoice');
      return;
    }
    if (result.code === 'milestone_mismatch') {
      setStatus(`Kill Bill already holds a different amount for milestone ${number}. Nothing was invoiced.`);
    } else if (result.status === 503) {
      setStatus('Billing is unreachable. Nothing was invoiced.');
    } else if (result.status === 0) {
      setStatus(`The request for milestone ${number} got no answer. The milestones shown are the current state.`);
    } else {
      setStatus(`Milestone ${number} was not invoiced. The milestones shown are the current state.`);
    }
    const fresh = await getJson<{ enquiry: ConsoleEnquiry }>(`/api/console/enquiries/${enquiryId}`);
    if (fresh.ok) adoptEnquiry(fresh.data.enquiry, true);
    else renderDetail(false);
  };

  const openProposalDialog = (enquiry: ConsoleEnquiry, opener: HTMLElement): void => {
    const producerName = el('input', { id: 'proposal-producer', type: 'text', class: 'console-input' });
    const producerEmail = el('input', { id: 'proposal-email', type: 'text', class: 'console-input' });
    const projectTitle = el('input', { id: 'proposal-title', type: 'text', class: 'console-input' });
    const scope = el('textarea', { id: 'proposal-scope', rows: 3, class: 'console-input' });
    const fee = el('input', { id: 'proposal-fee', type: 'text', class: 'console-input' });
    const monthSelect = el('select', { id: 'proposal-month', class: 'console-input', 'aria-label': 'Production month' });
    const monthNote = el('p', { class: 'field-note', id: 'proposal-month-note' });
    const feeNote = el('p', { class: 'field-note', id: 'proposal-fee-note' });
    const preview = el('table', { class: 'milestones-table', 'aria-label': 'Milestone preview' });
    const send = el('button', { type: 'button', class: 'primary', text: 'Send proposal' });

    const labelled = (id: string, label: string, control: HTMLElement, note?: HTMLElement): HTMLElement =>
      el('div', { class: 'field' }, [el('label', { for: id, text: label }), control, note ?? null]);

    const dialog = openDialog({
      label: 'Build proposal',
      opener,
      body: [
        el('h2', { class: 'dialog-heading', text: 'Build proposal' }),
        labelled('proposal-producer', 'Producer name', producerName),
        labelled('proposal-email', 'Producer email', producerEmail),
        labelled('proposal-title', 'Project title', projectTitle),
        labelled('proposal-scope', 'Scope', scope),
        labelled('proposal-fee', 'Fee (USD)', fee, feeNote),
        labelled('proposal-month', 'Production month', monthSelect, monthNote),
        preview,
        el('div', { class: 'dialog-actions' }, [send]),
      ],
    });

    const renderPreview = (milestones: readonly Milestone[]): void => {
      clear(preview);
      preview.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Milestone' }),
            el('th', { scope: 'col', text: 'Share' }),
            el('th', { scope: 'col', text: 'Amount' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          milestones.map((milestone) =>
            el('tr', {}, [
              el('th', { scope: 'row', text: milestone.name }),
              el('td', { class: 'mono', text: formatShare(milestone.percent) }),
              el('td', { class: 'mono', text: formatMoney(milestone.amount_cents) }),
            ]),
          ),
        ),
      );
    };
    renderPreview(MILESTONE_DEFINITIONS.map((definition) => ({ ...definition, amount_cents: 0 })));

    let previewTimer: number | null = null;
    const refreshPreview = (): void => {
      const cents = parseDollarsToCents(fee.value);
      feeNote.textContent = '';
      if (cents === null) return;
      if (enquiry.rate_floor_cents !== null && cents < enquiry.rate_floor_cents) {
        feeNote.textContent = `Below your rate floor of ${formatMoney(enquiry.rate_floor_cents)}.`;
      }
      renderPreview(splitMilestones(cents));
    };
    fee.addEventListener('input', () => {
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(refreshPreview, PREVIEW_DEBOUNCE_MS);
    });

    let months: ProductionMonth[] = [];
    const applyMonthState = (): void => {
      const chosen = months.find((month) => month.month === monthSelect.value);
      if (chosen !== undefined && !chosen.open) {
        monthNote.textContent = `${chosen.label} is now full. Choose another production month.`;
        monthSelect.setAttribute('aria-describedby', 'proposal-month-note');
        send.disabled = true;
        return;
      }
      monthNote.textContent = '';
      monthSelect.removeAttribute('aria-describedby');
      send.disabled = false;
    };
    const loadMonths = async (): Promise<void> => {
      const result = await getJson<{ months: ProductionMonth[] }>('/api/console/months');
      if (!result.ok) return;
      months = result.data.months;
      const chosen = monthSelect.value;
      clear(monthSelect);
      for (const month of months) {
        const option = el('option', {
          value: month.month,
          text: month.open ? month.label : `${month.label} (full)`,
        });
        if (!month.open) {
          option.setAttribute('aria-disabled', 'true');
          option.disabled = true;
        }
        monthSelect.append(option);
      }
      if (chosen !== '' && months.some((month) => month.month === chosen)) {
        monthSelect.value = chosen;
      } else if (chosen === '') {
        const firstOpen = months.find((month) => month.open);
        monthSelect.value = firstOpen?.month ?? months[0]?.month ?? '';
      }
      applyMonthState();
    };
    monthSelect.addEventListener('change', applyMonthState);
    void loadMonths();
    const monthTimer = window.setInterval(() => void loadMonths(), MONTH_POLL_MS);

    send.addEventListener('click', () => {
      const cents = parseDollarsToCents(fee.value);
      if (cents === null) {
        feeNote.textContent = 'Give a fee in dollars.';
        return;
      }
      void (async () => {
        const result = await writeEnquiry(`/api/console/enquiries/${enquiry.id}/proposal`, {
          producer_name: producerName.value,
          producer_email: producerEmail.value,
          project_title: projectTitle.value,
          scope: scope.value,
          fee_cents: cents,
          production_month: monthSelect.value,
        });
        if (result.ok) {
          const proposal = result.data.enquiry.proposal;
          setStatus(
            proposal?.email === 'sent'
              ? `Proposal sent to ${producerEmail.value}.`
              : 'Proposal saved. The email is queued and will go out when mail is reachable.',
          );
          window.clearInterval(monthTimer);
          dialog.close();
          adoptEnquiry(result.data.enquiry, false);
          await reload();
          return;
        }
        if (result.status === 412) {
          onStaleWrite(result.body.current as ConsoleEnquiry, 'other');
          return;
        }
        if (result.errors.fee_cents !== undefined) {
          feeNote.textContent =
            enquiry.rate_floor_cents === null
              ? result.errors.fee_cents
              : `Below your rate floor of ${formatMoney(enquiry.rate_floor_cents)}.`;
          return;
        }
        if (result.errors.production_month !== undefined) {
          monthNote.textContent = `${monthLabel(monthSelect.value)} is now full. Choose another production month.`;
          send.disabled = true;
          return;
        }
        setStatus(result.message);
      })();
    });
  };

  const backToList = el('button', { type: 'button', class: 'secondary back-to-list' }, [
    icon(ICONS.back),
    el('span', { text: 'Back to list' }),
  ]);
  backToList.addEventListener('click', () => {
    element.classList.remove('show-detail');
    list.querySelector<HTMLElement>('button[aria-current="true"]')?.focus();
  });

  const renderDetail = (refillTriage: boolean): void => preserveFocus(() => {
    const notes = triageNotes.value;
    clear(detailPane);
    if (detail === null) {
      detailPane.append(el('p', { class: 'empty-note', text: 'Choose an enquiry to triage it.' }));
      return;
    }
    const enquiry = detail;
    detailPane.append(
      backToList,
      el('h2', { class: 'detail-heading mono', text: enquiry.reference }),
      el('dl', { class: 'detail-list' }, [
        el('dt', { text: 'From' }),
        el('dd', { text: `${enquiry.name} (${enquiry.studio})` }),
        el('dt', { text: 'Email' }),
        el('dd', { text: enquiry.email }),
        el('dt', { text: 'Status' }),
        el('dd', { text: ENQUIRY_STATUS_LABELS[enquiry.status] }),
        el('dt', { text: 'Station' }),
        el('dd', { text: enquiry.project_slug === '' ? 'No project' : enquiry.project_slug }),
        el('dt', { text: 'Preferred month' }),
        el('dd', { text: enquiry.preferred_month === null ? 'No preference' : monthLabel(enquiry.preferred_month) }),
      ]),
      el('p', { class: 'detail-brief', text: enquiry.brief }),
      el(
        'div',
        { class: 'detail-attachment' },
        enquiry.attachment === null
          ? []
          : [el('a', { class: 'console-link', href: enquiry.attachment.url, text: enquiry.attachment.filename })],
      ),
      el('div', { class: 'field' }, [el('label', { for: 'triage-notes', text: 'Triage notes' }), triageNotes]),
      el('div', { class: 'field' }, [el('label', { for: 'triage-fit', text: 'Fit score' }), fitScore]),
      el('div', { class: 'field' }, [el('label', { for: 'triage-floor', text: 'Rate floor (USD)' }), rateFloor]),
      conflictRegion,
      saveTriage,
    );
    if (refillTriage) {
      triageNotes.value = enquiry.triage_notes;
      fitScore.value = enquiry.fit_score === null ? '' : String(enquiry.fit_score);
      rateFloor.value = floorText(enquiry.rate_floor_cents);
    } else {
      triageNotes.value = notes;
    }

    const actions = el('div', { class: 'detail-actions' });
    const add = (text: string, run: () => void, variant = 'secondary'): HTMLElement => {
      const button = el('button', { type: 'button', class: variant, text });
      button.addEventListener('click', run);
      actions.append(button);
      return button;
    };
    if (enquiry.status === 'new') {
      add('Qualify', () => void transition(enquiry, 'qualified'));
    }
    if (enquiry.status === 'new' || enquiry.status === 'qualified' || enquiry.status === 'proposal_sent') {
      add('Decline', () => void transition(enquiry, 'declined'));
    }
    if (enquiry.status === 'qualified') {
      const build = el('button', { type: 'button', class: 'primary', text: 'Build proposal' });
      build.addEventListener('click', () => openProposalDialog(enquiry, build));
      actions.append(build);
    }
    if (enquiry.status === 'deposit_paid') {
      add('Start production', () => void transition(enquiry, 'booked'), 'primary');
    }
    if (enquiry.proposal !== null) {
      add('Copy proposal link', () => {
        void navigator.clipboard?.writeText(`${window.location.origin}${enquiry.proposal?.url ?? ''}`);
      });
    }
    detailPane.append(actions);
    if (enquiry.status === 'booked') detailPane.append(renderMilestones(enquiry));
  });

  const transition = async (enquiry: ConsoleEnquiry, to: EnquiryStatus): Promise<void> => {
    const result = await writeEnquiry(`/api/console/enquiries/${enquiry.id}/transition`, { to });
    if (result.ok) {
      if (to === 'booked') setStatus('Production started.');
      adoptEnquiry(result.data.enquiry, false);
      await reload();
      return;
    }
    if (result.status === 412) {
      onStaleWrite(result.body.current as ConsoleEnquiry, 'other');
      return;
    }
    if (result.code === 'illegal_transition') {
      setStatus('That move isn\u2019t allowed from the current state.');
      return;
    }
    setStatus(result.message);
  };

  saveTriage.addEventListener('click', () => {
    if (detail === null) return;
    const floorValue = rateFloor.value.trim();
    const cents = floorValue === '' ? null : parseDollarsToCents(floorValue);
    void (async () => {
      const result = await writeEnquiry(
        `/api/console/enquiries/${detail?.id ?? ''}`,
        {
          triage_notes: triageNotes.value,
          fit_score: fitScore.value === '' ? null : Number(fitScore.value),
          rate_floor_cents: cents,
        },
        'PATCH',
      );
      if (result.ok) {
        clear(conflictRegion);
        setStatus('Triage saved.');
        adoptEnquiry(result.data.enquiry, false);
        await reload();
        return;
      }
      if (result.status === 412) {
        onStaleWrite(result.body.current as ConsoleEnquiry, 'triage');
        return;
      }
      setStatus(result.message);
    })();
  });

  showMore.addEventListener('click', () => void loadMore());
  statusFilter.addEventListener('change', () => {
    rows = [];
    nextCursor = null;
    announcedOnce = false;
    emailSnapshot = {};
    void reload();
  });

  const pollInvoices = async (): Promise<void> => {
    if (detail === null || detail.status !== 'booked' || invoicePending) return;
    const proposal = detail.proposal;
    if (proposal === null) return;
    if ([2, 3, 4].every((number) => proposal.invoiced_milestones.includes(number))) return;
    const result = await getJson<{ enquiry: ConsoleEnquiry }>(`/api/console/enquiries/${detail.id}`);
    if (!result.ok || detail === null) return;
    const fresh = result.data.enquiry;
    const before = proposal.invoiced_milestones.join(',');
    const after = fresh.proposal?.invoiced_milestones.join(',') ?? '';
    if (before === after && fresh.status === detail.status) return;
    const focusedInvoice = document.activeElement?.textContent?.startsWith('Invoice milestone') ?? false;
    detail = { ...fresh, version: detailVersion };
    renderDetail(false);
    if (focusedInvoice) milestoneList.focus();
  };

  return {
    element,
    activate: () => {
      void reload();
      renderDetail(detail !== null);
      listTimer ??= window.setInterval(() => void reload(), LIST_POLL_MS);
      invoiceTimer ??= window.setInterval(() => void pollInvoices(), INVOICE_POLL_MS);
    },
    deactivate: () => {
      if (listTimer !== null) window.clearInterval(listTimer);
      if (invoiceTimer !== null) window.clearInterval(invoiceTimer);
      listTimer = null;
      invoiceTimer = null;
    },
  };
}
