import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { button, dataTable, quietButton } from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import type { Broker } from '../lib/types.js';

export async function brokersScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Brokers');
  if (page === null) return;
  const messages = createMessageBox();
  const table = dataTable('Brokers', ['Broker', 'Contact', 'Page', 'Actions'], 'No brokers yet.');
  page.main.append(messages.node, table.section);

  const load = async (): Promise<void> => {
    const result = await api.get<{ brokers: readonly Broker[] }>(`/api/w/${workspaceSlug}/brokers`);
    if (!result.ok) return;
    table.setRows(
      result.data.brokers.map((broker) => {
        const pageText =
          broker.page.status === 'live'
            ? `Live until ${formatInstant(broker.page.endsAt as string)}`
            : broker.page.status === 'ended'
              ? 'Ended'
              : 'No page';
        const actions = el('div', { class: 'card-links' });
        const issue = button(`Issue broker page for ${broker.name}`);
        issue.addEventListener('click', () => {
          openDialog({
            name: 'Issue broker page',
            opener: issue,
            build: (handle) => {
              const cancel = quietButton('Cancel');
              cancel.addEventListener('click', () => handle.close());
              const confirm = button('Issue page');
              confirm.addEventListener('click', () => {
                void withPending(confirm, 'Sending page', async () => {
                  const sent = await api.post(
                    `/api/w/${workspaceSlug}/brokers/${broker.id}/page`,
                    {},
                  );
                  handle.close();
                  if (sent.ok) messages.show(MESSAGES.brokerPageSent(broker.email));
                  else if (failure(sent).error === 'mail_unavailable') {
                    messages.show(MESSAGES.mailUnavailable, 'problem');
                  } else if (!handleAccessFailure(sent, messages)) {
                    messages.show(MESSAGES.unexpected, 'problem');
                  }
                  await load();
                });
              });
              return {
                body: [
                  el('p', { class: 'dialog-copy' }, 'Any earlier page for this broker ends at once.'),
                  el('div', { class: 'dialog-actions' }, cancel, confirm),
                ],
                first: () => cancel,
              };
            },
          });
        });
        actions.appendChild(issue);
        if (broker.page.status === 'live') {
          const endPage = button(`End broker page for ${broker.name}`);
          endPage.addEventListener('click', () => {
            openDialog({
              name: 'End broker page',
              opener: endPage,
              build: (handle) => {
                const keep = quietButton('Keep page');
                keep.addEventListener('click', () => handle.close());
                const confirm = button('End page');
                confirm.addEventListener('click', () => {
                  void withPending(confirm, 'Ending page', async () => {
                    const ended = await api.post(
                      `/api/w/${workspaceSlug}/brokers/${broker.id}/page/end`,
                    );
                    handle.close();
                    if (ended.ok) messages.show(MESSAGES.pageEnded);
                    else if (!handleAccessFailure(ended, messages)) {
                      messages.show(MESSAGES.unexpected, 'problem');
                    }
                    await load();
                  });
                });
                return {
                  body: [el('div', { class: 'dialog-actions' }, keep, confirm)],
                  first: () => keep,
                };
              },
            });
          });
          actions.appendChild(endPage);
        }
        return [broker.name, broker.contactName, pageText, actions];
      }),
    );
  };
  await load();
}
