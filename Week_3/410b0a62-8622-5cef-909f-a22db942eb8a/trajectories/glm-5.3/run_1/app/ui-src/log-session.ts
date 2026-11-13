import { api, type WorkoutJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h } from './dom.js';
import { fmtTss } from './format.js';

function closeOnEscape(dialog: HTMLElement, opener: HTMLElement | null): void {
  dialog.addEventListener('keydown', (event) => {
    const ke = event as KeyboardEvent;
    if (ke.key === 'Escape') {
      dialog.remove();
      opener?.focus();
    } else if (ke.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (ke.shiftKey && document.activeElement === first) {
        ke.preventDefault();
        last.focus();
      } else if (!ke.shiftKey && document.activeElement === last) {
        ke.preventDefault();
        first.focus();
      }
    }
  });
}

function fieldError(fieldId: string, message: string): HTMLElement {
  const existing = document.getElementById(`${fieldId}-error`);
  if (existing) {
    existing.textContent = message;
    return existing;
  }
  const node = h('p', { class: 'field-error', id: `${fieldId}-error`, role: 'alert' }, message);
  const input = document.getElementById(fieldId);
  input?.setAttribute('aria-invalid', 'true');
  input?.setAttribute('aria-describedby', `${fieldId}-error`);
  input?.after(node);
  return node;
}

function clearFieldErrors(dialog: HTMLElement): void {
  for (const node of Array.from(dialog.querySelectorAll('.field-error'))) node.remove();
  for (const input of Array.from(dialog.querySelectorAll('[aria-invalid]'))) input.removeAttribute('aria-invalid');
}

export async function openLogSession(ctx: AppCtx, athleteId: string, date: string): Promise<void> {
  const existing = document.getElementById('log-session-dialog');
  if (existing) existing.remove();

  const status = h('div', { class: 'dialog-status', role: 'status', id: 'session-status' });
  const day = h('input', { class: 'field', type: 'date', id: 'log-day', value: date }) as HTMLInputElement;
  const title = h('input', { class: 'field', type: 'text', id: 'log-title', placeholder: 'Title' }) as HTMLInputElement;

  const bike = h('input', { type: 'radio', name: 'sport', id: 'sport-bike', value: 'bike' }) as HTMLInputElement;
  const run = h('input', { type: 'radio', name: 'sport', id: 'sport-run', value: 'run' }) as HTMLInputElement;
  bike.checked = true;

  const uploadTab = h('button', { class: 'tab active', role: 'tab', 'aria-selected': 'true', id: 'tab-upload' }, 'Upload a file');
  const manualTab = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'false', id: 'tab-manual' }, 'Enter by hand');

  const fileInput = h('input', { class: 'field file-input', type: 'file', id: 'activity-file', accept: '.csv,.json' }) as HTMLInputElement;
  const uploadButton = h('button', { class: 'pill pill-primary', id: 'upload-session' }, 'Upload session');
  const uploadAlert = h('div', { class: 'alert hidden', role: 'alert', id: 'upload-alert', tabindex: '-1' });

  const duration = h('input', { class: 'field', type: 'text', id: 'manual-duration', placeholder: 'H:MM:SS' }) as HTMLInputElement;
  const avgPower = h('input', { class: 'field', type: 'text', id: 'manual-power', placeholder: 'Average power' }) as HTMLInputElement;
  const avgPace = h('input', { class: 'field', type: 'text', id: 'manual-pace', placeholder: 'Average pace' }) as HTMLInputElement;
  const saveButton = h('button', { class: 'pill pill-primary', id: 'save-session' }, 'Save session');

  const uploadPanel = h('div', { class: 'tab-panel', role: 'tabpanel' },
    h('label', { class: 'field-label', for: 'activity-file' }, 'Activity file'),
    fileInput,
    uploadAlert,
    uploadButton
  );
  const manualPanel = h('div', { class: 'tab-panel hidden', role: 'tabpanel' },
    h('label', { class: 'field-label', for: 'manual-duration' }, 'Duration'),
    duration,
    h('label', { class: 'field-label hidden bike-only', for: 'manual-power' }, 'Average power'),
    avgPower,
    h('label', { class: 'field-label hidden run-only', for: 'manual-pace' }, 'Average pace'),
    avgPace,
    saveButton
  );

  const dialog = h(
    'div',
    { class: 'dialog', id: 'log-session-dialog', role: 'dialog', 'aria-label': 'Log a session' },
    h('h2', { class: 'dialog-title' }, 'Log a session'),
    h('div', { class: 'tabs', role: 'tablist' }, uploadTab, manualTab),
    h('label', { class: 'field-label', for: 'log-day' }, 'Day'),
    day,
    h('div', { class: 'radiogroup', role: 'radiogroup', 'aria-label': 'Sport' },
      h('label', { class: 'radio-label', for: 'sport-bike' }, bike, 'Bike'),
      h('label', { class: 'radio-label', for: 'sport-run' }, run, 'Run')
    ),
    h('label', { class: 'field-label', for: 'log-title' }, 'Title'),
    title,
    uploadPanel,
    manualPanel,
    status
  );

  document.body.append(dialog);
  day.focus();
  closeOnEscape(dialog, null);

  const switchTab = (upload: boolean): void => {
    uploadTab.classList.toggle('active', upload);
    manualTab.classList.toggle('active', !upload);
    uploadTab.setAttribute('aria-selected', upload ? 'true' : 'false');
    manualTab.setAttribute('aria-selected', upload ? 'false' : 'true');
    uploadPanel.classList.toggle('hidden', !upload);
    manualPanel.classList.toggle('hidden', upload);
  };
  uploadTab.addEventListener('click', () => switchTab(true));
  manualTab.addEventListener('click', () => switchTab(false));

  const sportToggle = (): void => {
    const isBike = bike.checked;
    document.querySelector('.bike-only')?.classList.toggle('hidden', !isBike);
    document.querySelector('.run-only')?.classList.toggle('hidden', isBike);
    avgPower.classList.toggle('hidden', !isBike);
    avgPace.classList.toggle('hidden', isBike);
  };
  bike.addEventListener('change', sportToggle);
  run.addEventListener('change', sportToggle);
  sportToggle();

  function syncSportButtons(): 'bike' | 'run' {
    return run.checked ? 'run' : 'bike';
  }

  function showErrors(errors: Record<string, string>): void {
    clearFieldErrors(dialog);
    const order = ['date', 'sport', 'title', 'duration_s', 'avg_power_w', 'avg_pace_s_per_km', 'file', 'threshold'];
    let firstFocused = false;
    for (const field of order) {
      const message = errors[field];
      if (!message) continue;
      const map: Record<string, string> = {
        date: 'log-day',
        title: 'log-title',
        duration_s: 'manual-duration',
        avg_power_w: 'manual-power',
        avg_pace_s_per_km: 'manual-pace',
        file: 'activity-file',
        threshold: 'activity-file',
      };
      const inputId = map[field];
      if (inputId) {
        fieldError(inputId, message);
        if (!firstFocused) {
          document.getElementById(inputId)?.focus();
          firstFocused = true;
        }
      } else {
        fieldError('log-title', message);
        if (!firstFocused) {
          document.getElementById('log-title')?.focus();
          firstFocused = true;
        }
      }
    }
  }

  uploadButton.addEventListener('click', async () => {
    clearFieldErrors(dialog);
    uploadAlert.classList.add('hidden');
    const file = fileInput.files?.[0];
    if (!file) {
      fieldError('activity-file', 'Choose an activity file.');
      return;
    }
    uploadButton.disabled = true;
    uploadButton.textContent = `Uploading ${file.name}…`;
    status.textContent = `Uploading ${file.name}…`;
    const form = new FormData();
    form.append('file', file);
    form.append('sport', syncSportButtons());
    form.append('date', day.value);
    if (title.value.trim() !== '') form.append('title', title.value.trim());
    try {
      const res = await api.upload<{ workout: WorkoutJson }>(`/athletes/${athleteId}/uploads`, form);
      status.textContent = `Saved ${res.workout.title}: ${fmtTss(res.workout.tss ?? 0)} TSS.`;
      window.setTimeout(() => {
        dialog.remove();
        window.location.reload();
      }, 600);
    } catch (err) {
      uploadButton.disabled = false;
      uploadButton.textContent = 'Upload session';
      const message = (err as Error).message;
      uploadAlert.textContent = message;
      uploadAlert.classList.remove('hidden');
      uploadAlert.focus();
      status.textContent = '';
    }
  });

  saveButton.addEventListener('click', async () => {
    clearFieldErrors(dialog);
    const durationText = duration.value.trim();
    const seconds = parseDuration(durationText);
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    status.textContent = 'Saving…';
    const sport = syncSportButtons();
    const body: Record<string, unknown> = {
      date: day.value,
      sport,
      title: title.value.trim() === '' ? (sport === 'bike' ? 'Ride' : 'Run') : title.value.trim(),
      duration_s: seconds,
    };
    if (sport === 'bike') {
      body.avg_power_w = parsePower(avgPower.value);
    } else {
      body.avg_pace_s_per_km = parsePace(avgPace.value);
    }
    try {
      const res = await api.post<{ workout: WorkoutJson }>(`/athletes/${athleteId}/manual`, body);
      status.textContent = `Saved ${res.workout.title}: ${fmtTss(res.workout.tss ?? 0)} TSS.`;
      window.setTimeout(() => {
        dialog.remove();
        window.location.reload();
      }, 600);
    } catch (err) {
      saveButton.disabled = false;
      saveButton.textContent = 'Save session';
      const errors = (err as { errors?: Record<string, string> }).errors ?? {};
      if (Object.keys(errors).length > 0) {
        showErrors(errors);
        status.textContent = '';
      } else {
        status.textContent = (err as Error).message;
      }
    }
  });
  void ctx;
}

export function parseDuration(text: string): number | null {
  const m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parsePower(text: string): number | null {
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : null;
}

function parsePace(text: string): number | null {
  const m = /^(\d+):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
