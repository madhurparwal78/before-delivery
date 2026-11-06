import { ERROR_COPY, fileDownloadedCopy, PENDING_COPY, STATE_COPY } from '../../shared/copy';
import { download, get, RequestFailed } from '../api';
import { button, dataTable, definition, element, heading } from '../dom';
import { showDateTime } from '../format';
import { Cleanup, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

interface MessageSummary {
  id: string;
  messageId: string;
  type: string;
  receivedAt: string;
  sha256: string;
  sizeBytes: number;
  counterparty: { id: string; name: string } | null;
  outcome: string;
}

interface MessageDetail extends MessageSummary {
  working: Record<string, unknown>;
  nameCheck: { result: string; customerId: string | null; customerName: string | null } | null;
}

export async function messagesScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'messages');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const body = await get<{ messages: MessageSummary[] }>(`/api/w/${slug}/messages`);
  frame.work.append(
    heading(1, 'Incoming messages'),
    note.node,
    dataTable<MessageSummary>(
      'Incoming messages',
      [
        {
          label: 'Received',
          cell: (row) =>
            element('span', { text: showDateTime(row.receivedAt, frame.workspace), className: 'mono' }),
        },
        { label: 'Sender', cell: (row) => row.counterparty?.name ?? '' },
        {
          label: 'Message id',
          cell: (row) =>
            element('a', {
              text: row.messageId,
              className: 'control link mono',
              attributes: { href: `/w/${slug}/messages/${row.id}` },
            }),
        },
        { label: 'Type', cell: (row) => row.type },
        { label: 'Outcome', cell: (row) => row.outcome },
      ],
      body.messages,
      STATE_COPY.emptyTable,
    ),
  );
  return () => frame.destroy();
}

export async function messageDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const messageId = context.params.messageId;
  const frame = await staffFrame(host, slug, 'messages');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  let detail: MessageDetail;
  try {
    detail = (await get<{ message: MessageDetail }>(`/api/w/${slug}/messages/${messageId}`)).message;
  } catch (error) {
    frame.work.append(heading(1, 'Page not found'), element('p', { text: STATE_COPY.unknownPage }));
    if (!(error instanceof RequestFailed)) throw error;
    return () => frame.destroy();
  }

  const factNodes = (): HTMLElement[] => [
    definition('Message id', element('span', { text: detail.messageId, className: 'mono' })),
    definition('Sender', detail.counterparty?.name ?? ''),
    definition('Type', detail.type),
    definition('Received', element('span', { text: showDateTime(detail.receivedAt, frame.workspace), className: 'mono' })),
    definition('SHA-256', element('span', { text: detail.sha256, className: 'mono' })),
    definition('Size', element('span', { text: `${detail.sizeBytes} bytes`, className: 'mono' })),
    definition('Outcome', detail.outcome),
  ];

  const downloadButton = button('Download original', () => {
    note.say(PENDING_COPY.downloadFile, 'pending');
    void download(`/api/w/${slug}/messages/${messageId}/original`)
      .then((file) => note.say(fileDownloadedCopy(file.fileName)))
      .catch((error: unknown) => {
        note.say(
          error instanceof RequestFailed ? error.failure.message : ERROR_COPY.storage_unreachable,
          'refused',
        );
      });
  }, { className: 'control primary' });
  if (frame.member.role !== 'compliance_officer' && frame.member.role !== 'compliance_analyst') {
    downloadButton.setAttribute('disabled', 'disabled');
  }

  const factsSheet = new Dialog(frame.layer, {
    name: 'Message facts',
    style: 'bottom-sheet',
    build: (controller) => {
      const close = button('Close', () => controller.close());
      return {
        body: [
          element('h2', { text: 'Message facts', className: 'dialog-title' }),
          element('div', { className: 'facts', children: factNodes() }),
          dialogActions(close),
        ],
        first: () => close,
      };
    },
  });
  frame.dialogs.push(factsSheet);
  const showFacts = button('Show facts', () => factsSheet.open(showFacts), {
    className: 'control narrow-only',
  });

  const workingCopy = element('pre', {
    className: 'working-copy mono',
    text: JSON.stringify(detail.working, null, 2),
    attributes: { tabindex: '0', role: 'group', 'aria-label': 'Working copy' },
  });
  frame.work.append(
    heading(1, `Message ${detail.messageId}`),
    note.node,
    element('p', {
      text: detail.nameCheck === null ? '' : STATE_COPY.nameCheck(detail.nameCheck.result),
      className: 'name-check',
    }),
    element('div', { className: 'toolbar-row', children: [downloadButton, showFacts] }),
    workingCopy,
  );
  frame.evidence.append(
    element('div', {
      className: 'panel wide-only',
      attributes: { role: 'region', 'aria-label': 'Message facts' },
      children: [element('h2', { text: 'Message facts' }), ...factNodes()],
    }),
  );
  return () => frame.destroy();
}
