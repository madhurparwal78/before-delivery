import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, takeHandOffMessage, withPending } from '../lib/forms.js';
import { link, type RouteContext } from '../lib/router.js';
import { button, columns, dataTable, definitionList, quietButton, textbox } from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import { can } from '../../shared/roles.js';
import type { Charter, ManifestGuest, ManifestPage } from '../lib/types.js';

export async function chartersScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Charters');
  if (page === null) return;
  const table = dataTable('Charters', ['Yacht', 'Week', 'Client', 'Total', 'Invoice'], 'No charters yet.');
  page.main.append(table.section);
  const result = await api.get<{ charters: readonly Charter[] }>(`/api/w/${workspaceSlug}/charters`);
  if (!result.ok) return;
  table.setRows(
    result.data.charters.map((charter) => [
      charter.yachtSlug,
      `Week of ${formatDate(charter.weekStart)}`,
      link(charter.clientName, `/w/${workspaceSlug}/charters/${charter.id}`),
      formatMoney(charter.totalMinor, charter.currency),
      charter.invoiceStatus === 'invoiced' ? 'Invoiced' : 'Not invoiced',
    ]),
  );
}

export async function charterDetailScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const charterId = context.params.charterId;
  const first = await api.get<{ charter: Charter }>(
    `/api/w/${workspaceSlug}/charters/${charterId}`,
  );
  if (!first.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const charter = first.data.charter;
  const page = await staffPage(host, workspaceSlug, `Charter for ${charter.clientName}`);
  if (page === null) return;
  const messages = createMessageBox();
  takeHandOffMessage(messages);
  const role = page.member.role;

  const linesTable = dataTable(
    'Charter lines',
    ['Line', 'EUR', charter.currency],
    'No charter lines yet.',
  );
  linesTable.setRows([
    ...charter.lines.map((line) => [
      line.label,
      formatMoney(line.eurMinor, 'EUR'),
      formatMoney(line.amountMinor, charter.currency),
    ]),
    ['Total', formatMoney(charter.totalEurMinor, 'EUR'), formatMoney(charter.totalMinor, charter.currency)],
  ]);

  const invoiceBlock = definitionList([
    ['Invoice', charter.invoiceStatus === 'invoiced' ? 'Invoiced' : 'Not invoiced'],
    ['Week', `${formatDate(charter.weekStart)} to ${formatDate(charter.weekEnd)}`],
    ['Client email', charter.clientEmail],
    ['Status', charter.status === 'open' ? 'Open' : 'Closed'],
  ]);

  const manifestStatus = el('p', { class: 'manifest-status' });
  const manifestActions = el('div', { class: 'manifest-actions' });
  const guestColumns = can(role, 'passport_data')
    ? ['Name', 'Nationality', 'Date of birth', 'Passport number', 'Photo']
    : ['Name'];
  const guestTable = dataTable('Guests', guestColumns, 'No guests yet.');
  const manifestSection = el(
    'section',
    { class: 'manifest-section' },
    el('h2', { class: 'section-heading' }, 'Manifest'),
    manifestStatus,
    guestTable.section,
    manifestActions,
  );

  const closeButton = button('Close charter');
  const closeHost = el('div', { class: 'charter-close' });
  if (can(role, 'close_charter')) closeHost.appendChild(closeButton);

  page.main.append(
    messages.node,
    columns([linesTable.section, invoiceBlock, closeHost], [manifestSection]),
  );

  const loadManifest = async (): Promise<void> => {
    if (!can(role, 'manifest_read')) {
      manifestStatus.textContent = 'No manifest page sent';
      return;
    }
    const result = await api.get<{ page: ManifestPage; guests: readonly ManifestGuest[] }>(
      `/api/w/${workspaceSlug}/charters/${charterId}/manifest`,
    );
    if (!result.ok) return;
    const manifest = result.data.page;
    manifestStatus.textContent =
      manifest.status === 'live'
        ? `Manifest page live until ${formatInstant(manifest.endsAt as string)}`
        : manifest.status === 'ended'
          ? 'Manifest page ended'
          : 'No manifest page sent';
    guestTable.setRows(
      result.data.guests.map((guest) =>
        can(role, 'passport_data')
          ? [
              guest.fullName,
              guest.nationality ?? '—',
              guest.dateOfBirth === null || guest.dateOfBirth === undefined
                ? '—'
                : formatDate(guest.dateOfBirth),
              guest.passportNumber ?? '—',
              guest.photoOnFile === true
                ? el(
                    'a',
                    {
                      href: `/api/w/${workspaceSlug}/charters/${charterId}/manifest/guests/${guest.id}/photo`,
                    },
                    `Photo of ${guest.fullName}`,
                  )
                : '—',
            ]
          : [guest.fullName],
      ),
    );
    manifestActions.replaceChildren();
    if (!can(role, 'manifest_pages')) return;
    if (manifest.status === 'live') {
      const endPage = button(`End manifest page`);
      endPage.addEventListener('click', () => {
        openDialog({
          name: 'End manifest page',
          opener: endPage,
          build: (handle) => {
            const keep = quietButton('Keep page');
            keep.addEventListener('click', () => handle.close());
            const confirm = button('End page');
            confirm.addEventListener('click', () => {
              void withPending(confirm, 'Ending page', async () => {
                const ended = await api.post(
                  `/api/w/${workspaceSlug}/charters/${charterId}/manifest-page/end`,
                );
                handle.close();
                if (ended.ok) messages.show(MESSAGES.pageEnded);
                else if (!handleAccessFailure(ended, messages)) messages.show(MESSAGES.unexpected);
                await loadManifest();
              });
            });
            return {
              body: [el('div', { class: 'dialog-actions' }, keep, confirm)],
              first: () => keep,
            };
          },
        });
      });
      manifestActions.appendChild(endPage);
    } else {
      const sendPage = button('Send manifest page');
      sendPage.addEventListener('click', () => {
        openDialog({
          name: 'Send manifest page',
          opener: sendPage,
          build: (handle) => {
            const fields = new FieldSet(true);
            const name = textbox('Lead guest name');
            const email = textbox('Lead guest email', '', 'email');
            const dialogMessage = createMessageBox();
            const confirm = button('Send manifest page');
            const cancel = quietButton('Cancel');
            cancel.addEventListener('click', () => handle.close());
            confirm.addEventListener('click', () => {
              void withPending(confirm, 'Sending page', async () => {
                const sent = await api.post(
                  `/api/w/${workspaceSlug}/charters/${charterId}/manifest-page`,
                  { leadGuestName: name.value, leadGuestEmail: email.value },
                );
                if (sent.ok) {
                  handle.close();
                  messages.show(MESSAGES.manifestPageSent(email.value));
                  await loadManifest();
                  return;
                }
                const body = failure(sent);
                if (body.errors !== undefined) {
                  fields.showErrors(body.errors)?.focus();
                  return;
                }
                if (body.error === 'charter_closed') {
                  dialogMessage.show(MESSAGES.charterAlreadyClosed, 'problem');
                } else if (body.error === 'mail_unavailable') {
                  dialogMessage.show(MESSAGES.mailUnavailable, 'problem');
                } else if (!handleAccessFailure(sent, dialogMessage)) {
                  dialogMessage.show(MESSAGES.unexpected, 'problem');
                }
                confirm.focus();
              });
            });
            return {
              body: [
                fields.field('leadGuestName', 'Lead guest name', name),
                fields.field('leadGuestEmail', 'Lead guest email', email),
                dialogMessage.node,
                el('div', { class: 'dialog-actions' }, confirm, cancel),
              ],
              first: () => name,
            };
          },
        });
      });
      manifestActions.appendChild(sendPage);
    }
  };

  closeButton.addEventListener('click', () => {
    openDialog({
      name: 'Close charter',
      opener: closeButton,
      build: (handle) => {
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        const confirm = button('Close charter');
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Closing charter', async () => {
            const result = await api.post<{ charter: Charter }>(
              `/api/w/${workspaceSlug}/charters/${charterId}/close`,
            );
            handle.close();
            if (result.ok) {
              messages.show(
                MESSAGES.charterClosed(formatInstant(result.data.charter.erasesAt as string)),
              );
            } else if (failure(result).error === 'charter_closed') {
              messages.show(MESSAGES.charterAlreadyClosed, 'problem');
            } else if (!handleAccessFailure(result, messages)) {
              messages.show(MESSAGES.unexpected, 'problem');
            }
            await loadManifest();
          });
        });
        return {
          body: [el('div', { class: 'dialog-actions' }, cancel, confirm)],
          first: () => cancel,
        };
      },
    });
  });

  await loadManifest();
}
