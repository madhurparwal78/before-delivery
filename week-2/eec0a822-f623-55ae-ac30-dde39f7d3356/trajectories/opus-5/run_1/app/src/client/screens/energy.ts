import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { button, columns, dataTable, quietButton } from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import { formatBytes, formatChargePct, formatDate, formatSolarKwh } from '../../shared/format.js';
import type { EnergyDay, EnergyLog } from '../lib/types.js';

function chart(days: readonly EnergyDay[]): HTMLElement {
  const host = el('div', { class: 'energy-chart', role: 'img', 'aria-label': 'Charge and solar by day' });
  const width = Math.max(320, days.length * 72);
  const height = 220;
  const maxSolar = Math.max(1, ...days.map((day) => day.solarKwh));
  const bars = days
    .map((day, index) => {
      const barWidth = 36;
      const x = index * 72 + 18;
      const barHeight = (day.solarKwh / maxSolar) * (height - 40);
      return `<rect class="solar-bar" x="${x}" y="${height - 20 - barHeight}" width="${barWidth}" height="${barHeight}" />`;
    })
    .join('');
  const line = days
    .map((day, index) => {
      const x = index * 72 + 36;
      const y = height - 20 - (day.endChargePct / 100) * (height - 40);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)}`;
    })
    .join(' ');
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${bars}${days.length > 0 ? `<path class="charge-line" d="${line}" />` : ''}</svg>`;
  return el('div', { class: 'chart-frame' }, host);
}

export async function energyScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const yachtResult = await api.get<{ yacht: { name: string } }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
  );
  if (!yachtResult.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const page = await staffPage(host, workspaceSlug, `${yachtResult.data.yacht.name} energy`);
  if (page === null) return;
  const messages = createMessageBox();
  const chartHost = el('div', {});
  const dayTable = dataTable(
    'Energy by day',
    ['Date', 'Start charge', 'End charge', 'Lowest charge', 'Solar yield'],
    'No logs yet.',
  );
  const logTable = dataTable('Uploaded logs', ['File', 'Size', 'Uploaded', 'By'], 'No logs yet.');
  const upload = button('Upload daily log');
  page.main.append(
    messages.node,
    upload,
    columns([chartHost, dayTable.section], [logTable.section]),
  );

  const load = async (): Promise<void> => {
    const [daysResult, logsResult] = await Promise.all([
      api.get<{ days: readonly EnergyDay[] }>(
        `/api/w/${workspaceSlug}/yachts/${yachtSlug}/energy-days`,
      ),
      api.get<{ logs: readonly EnergyLog[] }>(
        `/api/w/${workspaceSlug}/yachts/${yachtSlug}/energy-logs`,
      ),
    ]);
    if (daysResult.ok) {
      chartHost.replaceChildren(chart(daysResult.data.days));
      dayTable.setRows(
        daysResult.data.days.map((day) => [
          formatDate(day.date),
          formatChargePct(day.startChargePct),
          formatChargePct(day.endChargePct),
          formatChargePct(day.lowestChargePct),
          formatSolarKwh(day.solarKwh * 1000),
        ]),
      );
    }
    if (logsResult.ok) {
      logTable.setRows(
        logsResult.data.logs.map((log) => [
          log.fileName,
          formatBytes(log.sizeBytes),
          formatInstant(log.uploadedAt),
          log.uploadedBy,
        ]),
      );
    }
  };

  upload.addEventListener('click', () => {
    openDialog({
      name: 'Upload daily log',
      opener: upload,
      build: (handle) => {
        const fields = new FieldSet(true);
        const file = el('input', { type: 'file', class: 'file-input' }) as HTMLInputElement;
        const dialogMessage = createMessageBox();
        const confirm = button('Upload log');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Uploading log', async () => {
            const chosen = file.files?.[0];
            if (chosen === undefined) {
              fields.showErrors({ log: 'This field is required.' })?.focus();
              return;
            }
            const form = new FormData();
            form.append('log', chosen, chosen.name);
            const result = await api.post<{ log: EnergyLog }>(
              `/api/w/${workspaceSlug}/yachts/${yachtSlug}/energy-logs`,
              form,
            );
            if (result.ok) {
              handle.close();
              messages.show(MESSAGES.logUploaded(result.data.log.dayCount));
              await load();
              return;
            }
            const body = failure(result);
            if (result.status === 413) {
              dialogMessage.show(MESSAGES.logTooLarge, 'problem');
            } else if (body.error === 'storage_unavailable') {
              dialogMessage.show(MESSAGES.storageUnavailable, 'problem');
            } else if (body.errors !== undefined) {
              fields.showErrors(body.errors)?.focus();
              return;
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            }
            confirm.focus();
          });
        });
        return {
          body: [
            fields.field('log', 'Log file', file),
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => file,
        };
      },
    });
  });

  await load();
}
