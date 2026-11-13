import { api, ApiCallError } from './api.js';
import { el, fieldError, keepFocus, openDialog } from './dom.js';
import { formatTss, formatDay } from './format.js';
import { parseDurationText, parsePaceText } from '../domain/display.js';

export interface LogSessionArgs {
  athleteId: string;
  date: string;
  opener: HTMLElement | null;
  onSaved(title: string, tss: number): void;
}

/** The Log a session dialog: an upload tab and a hand-entry tab. */
export function openLogSession(args: LogSessionArgs): void {
  openDialog({
    label: 'Log a session',
    className: 'sheet',
    opener: args.opener,
    content: (handle) => {
      const status = el('p', {
        class: 'status-line',
        attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Session status' },
      });
      const alert = el('div', { class: 'alert', attrs: { role: 'alert', tabindex: '-1' } });

      const dayInput = el('input', {
        class: 'field',
        attrs: { type: 'text', value: args.date, 'aria-label': 'Day', id: 'log-day' },
      });
      const dayErrors = el('div');
      const titleInput = el('input', {
        class: 'field',
        attrs: { type: 'text', value: '', 'aria-label': 'Title', id: 'log-title' },
      });
      const titleErrors = el('div');

      const bikeRadio = el('input', {
        attrs: { type: 'radio', name: 'log-sport', value: 'bike', checked: true, 'aria-label': 'Bike', id: 'log-bike' },
      });
      const runRadio = el('input', {
        attrs: { type: 'radio', name: 'log-sport', value: 'run', 'aria-label': 'Run', id: 'log-run' },
      });
      const sportGroup = el('div', {
        class: 'radio-row',
        attrs: { role: 'radiogroup', 'aria-label': 'Sport' },
        children: [
          el('label', { class: 'radio', children: [bikeRadio, el('span', { text: 'Bike' })] }),
          el('label', { class: 'radio', children: [runRadio, el('span', { text: 'Run' })] }),
        ],
      });

      const fileInput = el('input', {
        class: 'field',
        attrs: { type: 'file', 'aria-label': 'Activity file', id: 'log-file' },
      });
      const fileErrors = el('div');
      const uploadButton = el('button', {
        class: 'pill pill-accent',
        text: 'Upload session',
        attrs: { type: 'button' },
      });

      const durationInput = el('input', {
        class: 'field',
        attrs: { type: 'text', placeholder: '0:45:00', 'aria-label': 'Duration', id: 'log-duration' },
      });
      const durationErrors = el('div');
      const powerInput = el('input', {
        class: 'field',
        attrs: { type: 'text', 'aria-label': 'Average power', id: 'log-power' },
      });
      const powerErrors = el('div');
      const paceInput = el('input', {
        class: 'field',
        attrs: { type: 'text', placeholder: '5:30', 'aria-label': 'Average pace', id: 'log-pace' },
      });
      const paceErrors = el('div');
      const saveButton = el('button', {
        class: 'pill pill-accent',
        text: 'Save session',
        attrs: { type: 'button' },
      });

      const powerRow = el('label', {
        class: 'field-row',
        children: [el('span', { text: 'Average power' }), powerInput, powerErrors],
      });
      const paceRow = el('label', {
        class: 'field-row',
        children: [el('span', { text: 'Average pace' }), paceInput, paceErrors],
      });

      const syncSport = (): void => {
        powerRow.hidden = !bikeRadio.checked;
        paceRow.hidden = bikeRadio.checked;
      };
      bikeRadio.addEventListener('change', syncSport);
      runRadio.addEventListener('change', syncSport);
      syncSport();

      const uploadPanel = el('div', {
        class: 'tab-panel',
        children: [
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Activity file' }), fileInput, fileErrors],
          }),
          uploadButton,
          alert,
        ],
      });
      const manualPanel = el('div', {
        class: 'tab-panel',
        attrs: { hidden: true },
        children: [
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Duration' }), durationInput, durationErrors],
          }),
          powerRow,
          paceRow,
          saveButton,
        ],
      });

      const uploadTab = el('button', {
        class: 'tab',
        text: 'Upload a file',
        attrs: { type: 'button', role: 'tab', 'aria-selected': 'true' },
      });
      const manualTab = el('button', {
        class: 'tab',
        text: 'Enter by hand',
        attrs: { type: 'button', role: 'tab', 'aria-selected': 'false' },
      });
      const selectTab = (upload: boolean): void => {
        uploadTab.setAttribute('aria-selected', upload ? 'true' : 'false');
        manualTab.setAttribute('aria-selected', upload ? 'false' : 'true');
        uploadPanel.hidden = !upload;
        manualPanel.hidden = upload;
      };
      uploadTab.addEventListener('click', () => selectTab(true));
      manualTab.addEventListener('click', () => selectTab(false));

      const clearErrors = (): void => {
        for (const box of [dayErrors, titleErrors, fileErrors, durationErrors, powerErrors, paceErrors]) {
          box.replaceChildren();
        }
        alert.replaceChildren();
      };

      const showFieldErrors = (errors: Record<string, string>): void => {
        const map: Record<string, { box: HTMLElement; input: HTMLElement }> = {
          date: { box: dayErrors, input: dayInput },
          title: { box: titleErrors, input: titleInput },
          duration_s: { box: durationErrors, input: durationInput },
          avg_power_w: { box: powerErrors, input: powerInput },
          avg_pace_s_per_km: { box: paceErrors, input: paceInput },
          file: { box: fileErrors, input: fileInput },
          threshold: { box: fileErrors, input: fileInput },
          sport: { box: titleErrors, input: titleInput },
        };
        let first: HTMLElement | null = null;
        for (const [field, message] of Object.entries(errors)) {
          const target = map[field];
          if (!target) continue;
          target.box.replaceChildren(fieldError(target.input, message));
          if (!first) first = target.input;
        }
        if (first) first.focus();
      };

      const sportValue = (): 'bike' | 'run' => (bikeRadio.checked ? 'bike' : 'run');

      uploadButton.addEventListener('click', async () => {
        clearErrors();
        const file = fileInput.files?.[0];
        if (!file) {
          fileErrors.replaceChildren(fieldError(fileInput, 'Choose an activity file.'));
          fileInput.focus();
          return;
        }
        const form = new FormData();
        form.set('file', file);
        form.set('sport', sportValue());
        form.set('date', dayInput.value.trim());
        if (titleInput.value.trim() !== '') form.set('title', titleInput.value.trim());
        uploadButton.disabled = true;
        uploadButton.textContent = `Uploading ${file.name}…`;
        status.textContent = `Uploading ${file.name}…`;
        try {
          const result = await api.upload(args.athleteId, form);
          status.textContent = `Saved ${result.workout.title}: ${formatTss(
            result.workout.tss as number,
          )} TSS.`;
          args.onSaved(result.workout.title, result.workout.tss as number);
        } catch (error) {
          if (error instanceof ApiCallError) {
            if (error.failure.errors) showFieldErrors(error.failure.errors);
            else {
              alert.replaceChildren(
                el('p', { class: 'outage-panel', text: error.failure.message ?? 'Upload failed.' }),
              );
              alert.focus();
            }
            status.textContent = '';
          }
        } finally {
          uploadButton.disabled = false;
          uploadButton.textContent = 'Upload session';
          keepFocus(uploadButton);
        }
      });

      saveButton.addEventListener('click', async () => {
        clearErrors();
        const sport = sportValue();
        const durationS = parseDurationText(durationInput.value);
        const payload: {
          date: string;
          sport: string;
          title: string;
          duration_s: number;
          avg_power_w?: number;
          avg_pace_s_per_km?: number;
        } = {
          date: dayInput.value.trim(),
          sport,
          title: titleInput.value.trim(),
          duration_s: durationS ?? 0,
        };
        if (sport === 'bike') payload.avg_power_w = Number(powerInput.value.trim());
        else payload.avg_pace_s_per_km = parsePaceText(paceInput.value) ?? 0;
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
        status.textContent = 'Saving…';
        try {
          const result = await api.manual(args.athleteId, payload);
          status.textContent = `Saved ${result.workout.title}: ${formatTss(
            result.workout.tss as number,
          )} TSS.`;
          args.onSaved(result.workout.title, result.workout.tss as number);
        } catch (error) {
          if (error instanceof ApiCallError) {
            if (error.failure.errors) showFieldErrors(error.failure.errors);
            else {
              alert.replaceChildren(
                el('p', { class: 'outage-panel', text: error.failure.message ?? 'Save failed.' }),
              );
              alert.focus();
            }
            status.textContent = '';
          }
        } finally {
          saveButton.disabled = false;
          saveButton.textContent = 'Save session';
          keepFocus(saveButton);
        }
      });

      return [
        el('h2', { class: 'dialog-title', text: `Log a session · ${formatDay(args.date)}` }),
        el('div', { class: 'tabs', attrs: { role: 'tablist' }, children: [uploadTab, manualTab] }),
        el('label', {
          class: 'field-row',
          children: [el('span', { text: 'Day' }), dayInput, dayErrors],
        }),
        sportGroup,
        el('label', {
          class: 'field-row',
          children: [el('span', { text: 'Title' }), titleInput, titleErrors],
        }),
        uploadPanel,
        manualPanel,
        status,
        el('button', {
          class: 'pill pill-quiet',
          text: 'Close',
          attrs: { type: 'button' },
          on: { click: () => handle.close() },
        }),
      ];
    },
  });
}
