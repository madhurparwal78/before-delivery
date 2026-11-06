import {
  ERROR_COPY,
  monthInvoicedCopy,
  PENDING_COPY,
  STATE_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { carry, takeCarried } from '../carry';
import { button, dataTable, definition, element, heading } from '../dom';
import { showDateTime, showMonth, showMoney } from '../format';
import { Cleanup, navigate, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

interface FeeLineBody {
  tier: number;
  label: string;
  count: number;
  unitPrice: string;
  amountCents: number;
}

interface MonthBody {
  month: string;
  status: string;
  messageCount: number;
  totalCents: number;
  currency: string;
  invoiceId: string | null;
  closedAt: string | null;
  lines?: FeeLineBody[];
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  open: STATE_COPY.monthOpen,
  ready: STATE_COPY.monthReady,
  invoiced: STATE_COPY.monthInvoiced,
};

function closeDialog(
  layer: HTMLElement,
  slug: string,
  month: MonthBody,
  note: ActionNote,
  onClosed: (copy: string) => void,
): Dialog {
  return new Dialog(layer, {
    name: 'Close month',
    build: (controller) => {
      const cancel = button('Cancel', () => controller.close());
      const confirm = button('Close month', () => {
        note.say(PENDING_COPY.closeMonth, 'pending');
        void request<{ month: MonthBody }>('POST', `/api/w/${slug}/months/${month.month}/close`, {})
          .then(() => {
            controller.close();
            onClosed(monthInvoicedCopy(showMonth(month.month)));
          })
          .catch((error: unknown) => {
            note.say(
              error instanceof RequestFailed ? error.failure.message : ERROR_COPY.invoicing_unreachable,
              'refused',
            );
            controller.close();
          });
      }, { className: 'control primary' });
      const lines = month.lines ?? [];
      return {
        body: [
          element('h2', { text: 'Close month', className: 'dialog-title' }),
          element('p', { text: showMonth(month.month) }),
          dataTable<FeeLineBody>(
            'Fee lines',
            [
              { label: 'Tier', cell: (line) => line.label },
              { label: 'Messages', cell: (line) => element('span', { text: String(line.count), className: 'mono' }) },
              { label: 'Unit price', cell: (line) => element('span', { text: line.unitPrice, className: 'mono' }) },
              {
                label: 'Amount',
                cell: (line) =>
                  element('span', { text: showMoney(month.currency, line.amountCents), className: 'mono' }),
              },
            ],
            lines,
            STATE_COPY.emptyTable,
          ),
          element('p', {
            className: 'mono',
            text: `Total ${showMoney(month.currency, month.totalCents)}`,
          }),
          dialogActions(cancel, confirm),
        ],
        first: () => cancel,
      };
    },
  });
}

export async function monthsScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'months');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  const tableHost = element('div', { className: 'table-host' });
  let dialog: Dialog | null = null;

  const refresh = async (): Promise<void> => {
    const body = await get<{ months: MonthBody[] }>(`/api/w/${slug}/months`);
    tableHost.replaceChildren(
      dataTable<MonthBody>(
        'Business months',
        [
          {
            label: 'Month',
            cell: (month) =>
              element('a', {
                text: showMonth(month.month),
                className: 'control link',
                attributes: { href: `/w/${slug}/months/${month.month}` },
              }),
          },
          {
            label: 'Messages',
            cell: (month) => element('span', { text: String(month.messageCount), className: 'mono' }),
          },
          {
            label: 'Total',
            cell: (month) =>
              element('span', { text: showMoney(month.currency, month.totalCents), className: 'mono' }),
          },
          {
            label: 'Status',
            cell: (month) => {
              const text = STATUS_TEXT[month.status] ?? month.status;
              if (month.status !== 'ready' || frame.member.role !== 'finance_lead') return text;
              const control = button('Close month', () => {
                void get<{ month: MonthBody }>(`/api/w/${slug}/months/${month.month}`).then((full) => {
                  dialog?.destroy();
                  dialog = closeDialog(frame.layer, slug, full.month, note, (copy) => {
                    carry(copy);
                    navigate(`/w/${slug}/months/${month.month}`);
                  });
                  frame.dialogs.push(dialog);
                  dialog.open(control);
                });
              });
              return element('span', { children: [element('span', { text }), control] });
            },
          },
        ],
        body.months,
        STATE_COPY.emptyTable,
      ),
    );
  };

  frame.work.append(heading(1, 'Months'), note.node, tableHost);
  await refresh();
  return () => {
    dialog?.destroy();
    frame.destroy();
  };
}

export async function monthDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const monthKey = context.params.month;
  const frame = await staffFrame(host, slug, 'months');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  const title = heading(1, showMonth(monthKey));
  const tableHost = element('div', { className: 'table-host' });
  const invoicePanel = element('div', { className: 'panel' });
  const actions = element('div', { className: 'toolbar-row' });
  let dialog: Dialog | null = null;

  const refresh = async (): Promise<void> => {
    let month: MonthBody;
    try {
      month = (await get<{ month: MonthBody }>(`/api/w/${slug}/months/${monthKey}`)).month;
    } catch (error) {
      frame.work.append(
        heading(1, 'Page not found'),
        element('p', { text: STATE_COPY.unknownPage }),
      );
      if (!(error instanceof RequestFailed)) throw error;
      return;
    }
    title.textContent = showMonth(month.month);
    tableHost.replaceChildren(
      dataTable<FeeLineBody>(
        'Fee lines',
        [
          { label: 'Tier', cell: (line) => line.label },
          { label: 'Messages', cell: (line) => element('span', { text: String(line.count), className: 'mono' }) },
          { label: 'Unit price', cell: (line) => element('span', { text: line.unitPrice, className: 'mono' }) },
          {
            label: 'Amount',
            cell: (line) =>
              element('span', { text: showMoney(month.currency, line.amountCents), className: 'mono' }),
          },
        ],
        month.lines ?? [],
        STATE_COPY.emptyTable,
      ),
    );
    invoicePanel.replaceChildren(
      element('h2', { text: 'Invoice' }),
      definition('Status', STATUS_TEXT[month.status] ?? month.status),
      definition('Invoice id', element('span', { text: month.invoiceId ?? 'None yet', className: 'mono' })),
      definition(
        'Closed at',
        element('span', {
          text: month.closedAt === null ? '' : showDateTime(month.closedAt, frame.workspace),
          className: 'mono',
        }),
      ),
      definition(
        'Total',
        element('span', { text: showMoney(month.currency, month.totalCents), className: 'mono' }),
      ),
    );
    actions.replaceChildren();
    if (frame.member.role === 'finance_lead') {
      const control = button('Close month', () => {
        dialog?.destroy();
        dialog = closeDialog(frame.layer, slug, month, note, (copy) => {
          note.say(copy);
          void refresh();
        });
        frame.dialogs.push(dialog);
        dialog.open(control);
      }, { className: 'control primary' });
      if (month.status !== 'ready') control.setAttribute('disabled', 'disabled');
      actions.append(control);
    }
  };

  frame.work.append(title, actions, note.node, tableHost);
  frame.evidence.append(invoicePanel);
  await refresh();
  return () => {
    dialog?.destroy();
    frame.destroy();
  };
}
