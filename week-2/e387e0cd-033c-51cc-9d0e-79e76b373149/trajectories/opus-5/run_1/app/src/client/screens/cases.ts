import {
  CASE_STATUS_TEXT,
  caseCreatedCopy,
  ERROR_COPY,
  PENDING_COPY,
  STATE_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { carry, takeCarried } from '../carry';
import { button, dataTable, element, heading } from '../dom';
import { clearDraft, readDraft, saveDraft } from '../draft';
import { showCrypto, showDateTime, showMoney } from '../format';
import { Cleanup, navigate, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { Field, monoField, problemsSummary, selectField, textField } from '../ui/fields';
import { ActionNote, StatusRegion } from '../ui/live';
import { staffFrame } from '../ui/frame';

export interface CaseBody {
  id: string;
  reference: string;
  createdAt: string;
  createdBy: { kind: string; name?: string; label?: string };
  asset: string;
  amount: string;
  destinationAddress: string;
  sendingAddress: string;
  wallet: string;
  counterparty: { id: string; name: string; lei: string; jurisdictionCode: string; network: string } | null;
  originator: { customerId: string; name: string; identityNumber: string; dateOfBirth?: string } | null;
  beneficiaryName: string | null;
  fiatValueCents: number;
  currency: string;
  decidedUnder: {
    jurisdictionCode: string | null;
    thresholdCents: number;
    thresholdCurrency: string;
    ruleInForceSince: string | null;
    rateCents: number;
    confirmationLimitCents: number;
    counterpartyName: string | null;
    counterpartyRule: string | null;
  };
  path: string;
  status: string;
  dataSent: { channel: string; at: string; counterpartyNameAsSent: string | null } | null;
  answer: { decision: string; at: string; late: boolean; via: string } | null;
  answerDueAt: string | null;
  answerRemainingSeconds: number | null;
  ownership: { required: boolean; confirmedOn: string | null; recordedAt: string | null; recordedBy: string | null };
  review: {
    claim: { memberId: string; memberName: string; claimedAt: string; endsAt: string; remainingSeconds: number } | null;
    decision: { decision: string; reason: string; decidedBy: string; decidedAt: string } | null;
  } | null;
  requestPage: {
    status: string;
    sentAt: string;
    endsAt: string;
    remainingSeconds: number;
    contactEmail: string;
  } | null;
  releaseReason: { text: string; recordedBy: string | null; recordedAt: string | null } | null;
  releaseAllowed: boolean;
  outcome: string | null;
  closedAt: string | null;
  erasure: {
    status: string;
    dueAt: string | null;
    erasedAt: string | null;
    digests: Array<{ kind: string; objectKey: string; sha256: string }>;
  };
  archived: boolean;
  track: Array<{ station: string; label: string; state: string; text: string; at: string | null }>;
  now: string;
}

export interface ArchivedCaseBody {
  id: string;
  reference: string;
  archived: true;
  archivedAt: string | null;
  closedAt: string | null;
}

type AnyCase = CaseBody | ArchivedCaseBody;

function isArchived(body: AnyCase): body is ArchivedCaseBody {
  return body.archived === true;
}

interface CustomerBody {
  id: string;
  name: string;
}

const CREATE_DIALOG = 'Create case';

export async function casesScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'cases');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);

  const show = selectField('Show', 'show', [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'archived', label: 'Archived' },
  ], 'open');
  const tableHost = element('div', { className: 'table-host' });
  const customers = await get<{ customers: CustomerBody[] }>(`/api/w/${slug}/customers`);

  const dialog = buildCreateDialog(frame.layer, slug, note);
  frame.dialogs.push(dialog.dialog);
  const createButton = button('Create case', () => dialog.dialog.open(createButton), {
    className: 'control primary',
  });
  dialog.setCustomers(customers.customers);

  const paint = (cases: AnyCase[]): void => {
    tableHost.replaceChildren(
      dataTable<AnyCase>(
        'Withdrawal cases',
        [
          {
            label: 'Reference',
            cell: (row) =>
              element('a', {
                text: row.reference,
                className: 'control link mono',
                attributes: { href: `/w/${slug}/cases/${row.id}` },
              }),
          },
          {
            label: 'Created',
            cell: (row) =>
              isArchived(row)
                ? ''
                : element('span', {
                    text: showDateTime(row.createdAt, frame.workspace),
                    className: 'mono',
                  }),
          },
          {
            label: 'Amount',
            cell: (row) =>
              isArchived(row)
                ? ''
                : element('span', { text: showCrypto(row.asset, row.amount), className: 'mono' }),
          },
          {
            label: 'Fiat value',
            cell: (row) =>
              isArchived(row)
                ? ''
                : element('span', {
                    text: showMoney(row.currency, row.fiatValueCents),
                    className: 'mono',
                  }),
          },
          {
            label: 'Counterparty',
            cell: (row) =>
              isArchived(row)
                ? ''
                : (row.counterparty?.name ?? 'Self-hosted wallet'),
          },
          {
            label: 'Status',
            cell: (row) => {
              if (isArchived(row)) return 'Archived';
              const text = CASE_STATUS_TEXT[row.status] ?? row.status;
              const waiting = row.status === 'awaiting_answer';
              return element('span', {
                className: waiting ? 'status-cell waiting' : 'status-cell',
                children: [
                  waiting
                    ? element('span', { className: 'waiting-marker', attributes: { 'aria-hidden': 'true' } })
                    : null,
                  element('span', { text }),
                ],
              });
            },
          },
          {
            label: 'Answer due',
            cell: (row) =>
              isArchived(row) || row.answerDueAt === null
                ? ''
                : element('span', {
                    text: showDateTime(row.answerDueAt, frame.workspace),
                    className: 'mono',
                  }),
          },
        ],
        cases,
        STATE_COPY.emptyTable,
      ),
    );
  };

  const refresh = async (): Promise<void> => {
    const body = await get<{ cases: AnyCase[] }>(
      `/api/w/${slug}/cases?show=${show.control.value}`,
    );
    paint(body.cases);
  };

  show.control.addEventListener('change', () => void refresh());

  frame.work.append(
    heading(1, 'Withdrawals'),
    element('div', { className: 'toolbar-row', children: [createButton, show.node] }),
    note.node,
    tableHost,
  );

  const draft = readDraft(window.location.pathname);
  if (draft !== null && draft.dialog === CREATE_DIALOG) {
    dialog.dialog.open(createButton);
    dialog.fill(draft.fields);
  }

  await refresh();
  const timer = window.setInterval(() => {
    void refresh().catch(() => undefined);
  }, 5000);
  return () => {
    window.clearInterval(timer);
    frame.destroy();
  };
}

interface CreateDialog {
  readonly dialog: Dialog;
  setCustomers(customers: readonly CustomerBody[]): void;
  fill(fields: Readonly<Record<string, string>>): void;
}

function buildCreateDialog(
  layer: HTMLElement,
  slug: string,
  note: ActionNote,
): CreateDialog {
  let customers: readonly CustomerBody[] = [];
  let fields: Field[] = [];
  let pending: Record<string, string> | null = null;
  const dialog = new Dialog(layer, {
    name: CREATE_DIALOG,
    build: (controller) => {
      const asset = selectField('Asset', 'asset', [
        { value: 'BTC', label: 'BTC' },
        { value: 'ETH', label: 'ETH' },
        { value: 'USDC', label: 'USDC' },
        { value: 'SOL', label: 'SOL' },
      ], 'BTC');
      const amount = monoField('Amount', 'amount');
      const destination = monoField('Destination address', 'destinationAddress');
      const customer = selectField('Customer', 'customerId', [
        { value: '', label: 'Choose a customer' },
        ...customers.map((entry) => ({ value: entry.id, label: entry.name })),
      ], '');
      const beneficiary = textField('Beneficiary name', 'beneficiaryName');
      const problems = problemsSummary();
      fields = [asset, amount, destination, customer, beneficiary];
      if (pending !== null) {
        for (const field of fields) {
          const value = pending[field.name];
          if (value !== undefined) field.control.value = value;
        }
        pending = null;
      }
      const send = async (): Promise<void> => {
        problems.clear();
        for (const field of fields) field.clearError();
        note.say(PENDING_COPY.createCase, 'pending');
        const payload = {
          asset: asset.control.value,
          amount: amount.control.value,
          destinationAddress: destination.control.value,
          customerId: customer.control.value,
          beneficiaryName: beneficiary.control.value,
        };
        saveDraft({
          route: window.location.pathname,
          dialog: CREATE_DIALOG,
          fields: Object.fromEntries(fields.map((field) => [field.name, field.control.value])),
        });
        try {
          const body = await request<{ case: CaseBody }>('POST', `/api/w/${slug}/cases`, payload);
          clearDraft();
          carry(caseCreatedCopy(body.case.reference));
          controller.close();
          navigate(`/w/${slug}/cases/${body.case.id}`);
        } catch (error) {
          if (!(error instanceof RequestFailed)) {
            note.say(ERROR_COPY.not_found, 'refused');
            return;
          }
          if (error.failure.code !== 'session_ended') clearDraft();
          note.say(error.failure.message, 'refused');
          if (Object.keys(error.failure.fields).length > 0) {
            problems.show(error.failure.fields, fields);
            problems.focus();
          } else {
            problems.showOne(error.failure.message);
            problems.focus();
          }
        }
      };
      const submit = button('Create case', () => void send(), { className: 'control primary' });
      const cancel = button('Cancel', () => controller.close());
      return {
        body: [
          element('h2', { text: CREATE_DIALOG, className: 'dialog-title' }),
          problems.node,
          asset.node,
          amount.node,
          destination.node,
          customer.node,
          beneficiary.node,
          dialogActions(submit, cancel),
        ],
        first: () => asset.control,
      };
    },
  });
  return {
    dialog,
    setCustomers(next): void {
      customers = next;
    },
    fill(values): void {
      pending = { ...values };
      for (const field of fields) {
        const value = values[field.name];
        if (value !== undefined) field.control.value = value;
      }
    },
  };
}
