import { dropTimeText } from '../../../shared/bilingual.js';
import { BATCH_STATE_LABELS, DROP_SCENTS, scentName } from '../../../shared/catalog.js';
import { barItemText, COLUMNS, STUDIO, UI } from '../../../shared/copy.js';
import type { StaffBatch } from '../../../shared/types.js';
import { api, ApiFailure } from '../../api.js';
import { locale, longDate } from '../../i18n.js';
import { announce } from '../../live.js';
import { everyPoll } from '../../store.js';
import { bind, bindText, el, focusHeading, labelled, refresh, say, trapFocus } from '../../ui.js';
import { reportStudioFailure, studioRegion } from './shell.js';
import { studioTable } from './table.js';

type DialogParts = { element: HTMLElement; open: (opener: HTMLElement) => void; close: () => void };

function dialog(label: () => string, content: HTMLElement[], confirm: HTMLElement): DialogParts {
  const keep = el('button', { type: 'button', class: 'button quiet' });
  bindText(keep, () => say(UI.keepIt));
  const element = el('div', { role: 'dialog', class: 'dialog', 'aria-modal': 'true', hidden: true }, [
    ...content,
    confirm,
    keep,
  ]);
  let opener: HTMLElement | null = null;
  const close = (): void => {
    element.hidden = true;
    opener?.focus();
  };
  keep.addEventListener('click', close);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(element, event);
  });
  bind(() => element.setAttribute('aria-label', label()));
  return {
    element,
    open: (source) => {
      opener = source;
      element.hidden = false;
      element.querySelector<HTMLElement>('input, button')?.focus();
    },
    close,
  };
}

export async function renderBatches(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.batchesTable));
  const region = studioRegion();
  let batches: StaffBatch[] = [];

  const scentSelect = el('select', { class: 'input select' });
  for (const scent of DROP_SCENTS) {
    const option = el('option', { value: scent.slug });
    bindText(option, () => scentName(scent.slug, locale()));
    scentSelect.append(option);
  }
  const pourDate = el('input', { type: 'date', class: 'input' });
  const cureDays = el('input', { type: 'number', class: 'input', min: '28', max: '60', value: '28' });
  const logButton = el('button', { type: 'button', class: 'button primary' });
  const logError = el('p', { class: 'field-error', hidden: true });
  const logRegion = el('section', { role: 'region', class: 'log-loaf' }, [
    labelled(UI.scent, scentSelect),
    labelled(UI.pourDate, pourDate),
    labelled(UI.cureDays, cureDays),
    logButton,
    logError,
  ]);
  bind(() => {
    logRegion.setAttribute('aria-label', say(UI.logALoaf));
    logButton.textContent = say(UI.logLoaf);
    cureDays.setAttribute('aria-label', say(UI.cureDays));
  });

  const table = studioTable(() => say(UI.batchesTable), [
    { label: COLUMNS.code },
    { label: COLUMNS.scent },
    { label: COLUMNS.state },
    { label: COLUMNS.pourDate },
    { label: COLUMNS.cureDate },
    { label: COLUMNS.dropTime },
    { label: COLUMNS.cut },
    { label: COLUMNS.available },
    { label: COLUMNS.held },
    { label: COLUMNS.sold },
    { label: COLUMNS.bars },
    { label: COLUMNS.actions },
  ]);

  const cutInput = el('input', { type: 'number', class: 'input', min: '1', max: '24', value: '12' });
  const cutConfirm = el('button', { type: 'button', class: 'button primary' });
  bindText(cutConfirm, () => say(UI.saveCut));
  let cutTarget = '';
  const cutDialog = dialog(
    () => (locale() === 'fr-CA' ? `Couper ${cutTarget}` : `Cut ${cutTarget}`),
    [labelled(UI.barsCut, cutInput)],
    cutConfirm,
  );

  const dropInput = el('input', { type: 'datetime-local', class: 'input' });
  const dropConfirm = el('button', { type: 'button', class: 'button primary' });
  bindText(dropConfirm, () => say(UI.saveDropTime));
  let scheduleTarget = '';
  const scheduleDialog = dialog(
    () => (locale() === 'fr-CA' ? `Programmer ${scheduleTarget}` : `Schedule ${scheduleTarget}`),
    [labelled(UI.dropDateTime, dropInput)],
    dropConfirm,
  );

  const withdrawConfirm = el('button', { type: 'button', class: 'button primary' });
  let withdrawTarget = '';
  const withdrawDialog = dialog(
    () => (locale() === 'fr-CA' ? `Retirer ${withdrawTarget}?` : `Withdraw ${withdrawTarget}?`),
    [],
    withdrawConfirm,
  );
  bind(() => {
    withdrawConfirm.textContent =
      locale() === 'fr-CA' ? 'Oui, retirer' : 'Yes, withdraw';
  });

  const cutoffInput = el('input', { type: 'text', class: 'input tabular', value: '14:00' });
  const cutoffButton = el('button', { type: 'button', class: 'button secondary' });
  const cutoffBlock = el('div', { class: 'cutoff-block' }, [
    labelled(UI.packingCutoff, cutoffInput),
    cutoffButton,
  ]);
  bind(() => {
    cutoffButton.textContent = say(UI.saveCutoff);
  });

  const load = async (): Promise<void> => {
    try {
      const payload = await api.get<{ batches: StaffBatch[] }>('/api/staff/batches');
      batches = payload.batches;
      paint();
    } catch (error) {
      reportStudioFailure(error, STUDIO.billingUnavailable);
    }
  };

  const action = async (run: () => Promise<unknown>, done: () => void): Promise<void> => {
    try {
      await run();
      await load();
      done();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        const message = Object.values(error.fields)[0];
        if (message !== undefined) {
          logError.hidden = false;
          logError.textContent = message;
          refresh();
          return;
        }
      }
      if (error instanceof ApiFailure && error.status === 409) {
        announce('studio', { 'en-CA': error.detail, 'fr-CA': error.detail });
        refresh();
        return;
      }
      reportStudioFailure(error, STUDIO.billingUnavailable);
    }
  };

  logButton.addEventListener('click', () => {
    logError.hidden = true;
    void action(
      () =>
        api.post<{ batch: StaffBatch }>('/api/staff/batches', {
          scent: scentSelect.value,
          poured_on: pourDate.value,
          cure_days: Number(cureDays.value),
        }),
      () => {
        const latest = batches[batches.length - 1];
        if (latest) announce('studio', STUDIO.loafLogged(latest.code));
      },
    );
  });

  cutConfirm.addEventListener('click', () => {
    const code = cutTarget;
    const bars = Number(cutInput.value);
    void action(
      () => api.post(`/api/staff/batches/${code}/cut`, { bars }),
      () => {
        announce('studio', STUDIO.cutSaved(code, bars));
        cutDialog.close();
        focusHeading();
      },
    );
  });

  dropConfirm.addEventListener('click', () => {
    const code = scheduleTarget;
    const value = dropInput.value;
    void action(
      () => api.post(`/api/staff/batches/${code}/schedule`, { drop_at_local: value }),
      () => {
        const batch = batches.find((candidate) => candidate.code === code);
        if (batch?.drop_at) {
          announce('studio', STUDIO.dropScheduled(code, dropTimeText(new Date(batch.drop_at))));
        }
        scheduleDialog.close();
        focusHeading();
      },
    );
  });

  withdrawConfirm.addEventListener('click', () => {
    const code = withdrawTarget;
    void action(
      () => api.post(`/api/staff/batches/${code}/withdraw`),
      () => {
        announce('studio', STUDIO.withdrawn(code));
        withdrawDialog.close();
        focusHeading();
      },
    );
  });

  cutoffButton.addEventListener('click', () => {
    const value = cutoffInput.value.trim();
    void action(
      () => api.put('/api/staff/settings', { packing_cutoff_local: value }),
      () => announce('studio', STUDIO.cutoffSaved(value)),
    );
  });

  function barMarks(batch: StaffBatch): HTMLElement {
    const list = el('ul', { role: 'list', class: 'bar-marks' });
    list.setAttribute(
      'aria-label',
      locale() === 'fr-CA' ? `Pains de ${batch.code}` : `Bars of ${batch.code}`,
    );
    for (const bar of batch.bars) {
      list.append(
        el('li', {
          role: 'listitem',
          class: 'bar-mark',
          'data-bar-status': bar.status,
          text: say(barItemText(bar.number, bar.status)),
        }),
      );
    }
    return list;
  }

  function rowActions(batch: StaffBatch): HTMLElement {
    const group = el('div', { class: 'row-actions' });
    const make = (text: string, onClick: (button: HTMLElement) => void): HTMLElement => {
      const button = el('button', { type: 'button', class: 'button quiet', text });
      button.addEventListener('click', () => onClick(button));
      return button;
    };
    if (batch.state === 'poured') {
      group.append(
        make(locale() === 'fr-CA' ? `Couper ${batch.code}` : `Cut ${batch.code}`, (button) => {
          cutTarget = batch.code;
          cutDialog.open(button);
        }),
      );
    }
    if (batch.state === 'curing' || batch.state === 'scheduled') {
      group.append(
        make(
          locale() === 'fr-CA' ? `Programmer ${batch.code}` : `Schedule ${batch.code}`,
          (button) => {
            scheduleTarget = batch.code;
            scheduleDialog.open(button);
          },
        ),
      );
      group.append(
        make(
          locale() === 'fr-CA' ? `Ouvrir maintenant ${batch.code}` : `Open now ${batch.code}`,
          () =>
            void action(
              () => api.post(`/api/staff/batches/${batch.code}/open`),
              () => announce('studio', STUDIO.openedNow(batch.code)),
            ),
        ),
      );
    }
    if (batch.state !== 'withdrawn' && batch.state !== 'sold_out') {
      group.append(
        make(locale() === 'fr-CA' ? `Retirer ${batch.code}?` : `Withdraw ${batch.code}`, (button) => {
          withdrawTarget = batch.code;
          withdrawDialog.open(button);
        }),
      );
    }
    return group;
  }

  function paint(): void {
    table.setRows(
      batches.map((batch) => [
        batch.code,
        scentName(batch.scent, locale()),
        say(BATCH_STATE_LABELS[batch.state]),
        batch.poured_on,
        longDate(batch.cure_date),
        batch.drop_at ? say(dropTimeText(new Date(batch.drop_at))) : '\u2014',
        String(batch.bars_cut),
        String(batch.available),
        String(batch.held),
        String(batch.sold),
        barMarks(batch),
        rowActions(batch),
      ]),
    );
  }

  bind(paint);

  body.append(
    heading,
    logRegion,
    table.element,
    cutDialog.element,
    scheduleDialog.element,
    withdrawDialog.element,
    cutoffBlock,
    region,
  );

  await load();
  try {
    const settings = await api.get<{ packing_cutoff_local: string }>('/api/staff/settings');
    cutoffInput.value = settings.packing_cutoff_local;
  } catch {
    cutoffBlock.hidden = true;
  }
  everyPoll(load);
}
