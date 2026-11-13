import { api } from './api.js';
import type { AppCtx } from './shell.js';
import { h } from './dom.js';
import { dataAttr, dayLabel } from './format.js';

interface ThresholdHistory {
  kind: string;
  value: number;
  effective_from: string;
}

export function openThresholdForm(container: HTMLElement, ctx: AppCtx, athleteId: string, thresholds: ThresholdHistory[]): void {
  const region = h(
    'section',
    { class: 'section thresholds', role: 'region', 'aria-label': 'Thresholds' },
    h('h2', { class: 'section-title' }, 'Thresholds')
  );

  const ftp = h('input', { class: 'field', type: 'number', id: 'threshold-ftp', 'aria-label': 'FTP' }) as HTMLInputElement;
  const pace = h('input', { class: 'field', type: 'text', id: 'threshold-pace', 'aria-label': 'Threshold pace', placeholder: 'M:SS' }) as HTMLInputElement;
  const effective = h('input', { class: 'field', type: 'date', id: 'threshold-from', 'aria-label': 'Effective from' }) as HTMLInputElement;
  const save = h('button', { class: 'pill pill-primary', id: 'save-threshold' }, 'Save threshold');
  const status = h('div', { class: 'dialog-status', role: 'status', id: 'threshold-status' });
  const history = h('ul', { class: 'threshold-history' });

  const latestFtp = thresholds.filter((t) => t.kind === 'ftp').slice(-1)[0];
  const latestPace = thresholds.filter((t) => t.kind === 'pace').slice(-1)[0];
  if (latestFtp) ftp.value = String(latestFtp.value);
  if (latestPace) pace.value = secondsToPace(latestPace.value);

  for (const entry of thresholds) {
    history.append(
      h(
        'li',
        { class: 'threshold-entry' },
        entry.kind === 'ftp'
          ? `FTP ${entry.value} W from ${dayLabel(entry.effective_from, true)}`
          : `Threshold pace ${secondsToPace(entry.value)} /km from ${dayLabel(entry.effective_from, true)}`
      )
    );
  }

  save.addEventListener('click', async () => {
    const ftpValue = ftp.value.trim();
    const paceValue = pace.value.trim();
    const kind = ftpValue !== '' ? 'ftp' : 'pace';
    const raw = kind === 'ftp' ? Number(ftpValue) : paceToSeconds(paceValue);
    save.disabled = true;
    save.textContent = 'Saving…';
    status.textContent = 'Saving…';
    try {
      const res = await api.post<{ rescored: number; threshold: { kind: string; value: number; effective_from: string } }>(
        `/athletes/${athleteId}/thresholds`,
        { kind, value: raw, effective_from: effective.value }
      );
      const word = res.rescored === 1 ? 'workout' : 'workouts';
      const value = res.threshold.value;
      status.textContent =
        kind === 'ftp'
          ? `FTP ${value} W from ${dayLabel(res.threshold.effective_from, true)}. Re-scored ${res.rescored} ${word}.`
          : `Threshold pace ${secondsToPace(value)} /km from ${dayLabel(res.threshold.effective_from, true)}. Re-scored ${res.rescored} ${word}.`;
      save.disabled = false;
      save.textContent = 'Save threshold';
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      save.disabled = false;
      save.textContent = 'Save threshold';
      status.textContent = (err as Error).message;
    }
  });

  region.append(
    h('div', { class: 'threshold-form' },
      h('label', { class: 'field-label', for: 'threshold-ftp' }, 'FTP'),
      ftp,
      h('label', { class: 'field-label', for: 'threshold-pace' }, 'Threshold pace'),
      pace,
      h('label', { class: 'field-label', for: 'threshold-from' }, 'Effective from'),
      effective,
      save,
      status
    ),
    history
  );
  container.append(region);
  void ctx;
  void dataAttr;
}

function secondsToPace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function paceToSeconds(text: string): number | null {
  const m = /^(\d+):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
