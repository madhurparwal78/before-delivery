import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { button, columns, definitionList, hullDrawing, quietButton, spinbutton, textbox } from '../lib/views.js';
import { MESSAGES } from '../../shared/copy.js';
import { centimetresFromMetres, formatMeasurement, formatMoney } from '../../shared/format.js';
import type { YachtProfile } from '../lib/types.js';

function measurement(value: number): string {
  return formatMeasurement(centimetresFromMetres(value.toFixed(2)));
}

function euros(minor: number): string {
  return (minor / 100).toFixed(2);
}

export async function yachtProfileScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const result = await api.get<{ yacht: YachtProfile }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
  );
  if (!result.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  let yacht = result.data.yacht;
  const page = await staffPage(host, workspaceSlug, `${yacht.name} profile`);
  if (page === null) return;
  const messages = createMessageBox();
  const fields = new FieldSet();

  const name = textbox('Name', yacht.name);
  const cabins = spinbutton('Cabins', yacht.cabins, 2, 6);
  const lengthM = textbox('Length (m)', yacht.lengthM.toFixed(2));
  const beamM = textbox('Beam (m)', yacht.beamM.toFixed(2));
  const draftM = textbox('Draft (m)', yacht.draftM.toFixed(2));
  const lowRate = textbox('Low season weekly rate (EUR)', euros(yacht.rates.lowMinor));
  const shoulderRate = textbox('Shoulder season weekly rate (EUR)', euros(yacht.rates.shoulderMinor));
  const highRate = textbox('High season weekly rate (EUR)', euros(yacht.rates.highMinor));
  const save = button('Save profile');
  const preview = el('div', { class: 'profile-preview' });
  const statusActions = el('div', { class: 'profile-status' });

  const paintPreview = (): void => {
    preview.replaceChildren(
      hullDrawing(yacht.name, yacht.lengthM, yacht.beamM),
      definitionList([
        ['Length', measurement(yacht.lengthM)],
        ['Beam', measurement(yacht.beamM)],
        ['Draft', measurement(yacht.draftM)],
        ['Cabins', String(yacht.cabins)],
        ['Low season', formatMoney(yacht.rates.lowMinor, yacht.currency)],
        ['Shoulder season', formatMoney(yacht.rates.shoulderMinor, yacht.currency)],
        ['High season', formatMoney(yacht.rates.highMinor, yacht.currency)],
        ['Status', yacht.status === 'on_sale' ? 'On sale' : 'Withdrawn'],
      ]),
    );
  };

  const statusDialog = (
    opener: HTMLButtonElement,
    dialogName: 'Withdraw yacht' | 'Put back on sale',
    path: string,
    message: (yachtName: string) => string,
  ): void => {
    openDialog({
      name: dialogName,
      opener,
      build: (handle) => {
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        const confirm = button(dialogName);
        confirm.addEventListener('click', () => {
          void withPending(confirm, dialogName, async () => {
            const changed = await api.post<{ yacht: YachtProfile }>(
              `/api/w/${workspaceSlug}/yachts/${yachtSlug}/${path}`,
            );
            handle.close();
            if (changed.ok) {
              yacht = changed.data.yacht;
              messages.show(message(yacht.name));
              paintPreview();
              paintStatus();
            } else if (!handleAccessFailure(changed, messages)) {
              messages.show(MESSAGES.unexpected, 'problem');
            }
          });
        });
        return {
          body: [el('div', { class: 'dialog-actions' }, cancel, confirm)],
          first: () => cancel,
        };
      },
    });
  };

  const paintStatus = (): void => {
    statusActions.replaceChildren();
    if (yacht.status === 'on_sale') {
      const withdraw = button('Withdraw yacht');
      withdraw.addEventListener('click', () =>
        statusDialog(withdraw, 'Withdraw yacht', 'withdraw', MESSAGES.yachtWithdrawn),
      );
      statusActions.appendChild(withdraw);
    } else {
      const restore = button('Put back on sale');
      restore.addEventListener('click', () =>
        statusDialog(restore, 'Put back on sale', 'return-to-sale', MESSAGES.yachtBackOnSale),
      );
      statusActions.appendChild(restore);
    }
  };

  save.addEventListener('click', () => {
    void withPending(save, 'Saving profile', async () => {
      const rate = (value: string): number => Math.round(Number(value) * 100);
      const saved = await api.patch<{ yacht: YachtProfile }>(
        `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
        {
          name: name.value,
          cabins: Number(cabins.value),
          lengthM: lengthM.value,
          beamM: beamM.value,
          draftM: draftM.value,
          rates: {
            lowMinor: rate(lowRate.value),
            shoulderMinor: rate(shoulderRate.value),
            highMinor: rate(highRate.value),
          },
        },
      );
      if (saved.ok) {
        yacht = saved.data.yacht;
        fields.clearErrors();
        messages.show(MESSAGES.profileSaved);
        paintPreview();
        return;
      }
      const body = failure(saved);
      if (body.errors !== undefined) {
        fields.showErrors(body.errors)?.focus();
        return;
      }
      if (!handleAccessFailure(saved, messages)) messages.show(MESSAGES.unexpected, 'problem');
    });
  });

  const form = el(
    'form',
    { class: 'profile-form', novalidate: true, onsubmit: (event: Event) => event.preventDefault() },
    el(
      'div',
      { class: 'profile-fields' },
      fields.problems,
      fields.field('name', 'Name', name),
      fields.field('cabins', 'Cabins', cabins),
      fields.field('lengthM', 'Length (m)', lengthM),
      fields.field('beamM', 'Beam (m)', beamM),
      fields.field('draftM', 'Draft (m)', draftM),
      fields.field('rates.lowMinor', 'Low season weekly rate (EUR)', lowRate),
      fields.field('rates.shoulderMinor', 'Shoulder season weekly rate (EUR)', shoulderRate),
      fields.field('rates.highMinor', 'High season weekly rate (EUR)', highRate),
      messages.node,
    ),
    el('div', { class: 'sticky-bar' }, save),
  );
  page.main.append(columns([form], [preview, statusActions]));
  paintPreview();
  paintStatus();
}
