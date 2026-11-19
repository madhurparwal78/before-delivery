import { getJson, requestJson } from '../shared/api.ts';
import { clear, el, preserveFocus } from '../shared/dom.ts';
import type { QueuedEmail } from './types.ts';

const QUEUE_POLL_MS = 2_000;

const KIND_LABELS: Record<QueuedEmail['kind'], string> = {
  receipt: 'Receipt',
  alert: 'New-brief alert',
  proposal: 'Proposal email',
  month_held: 'Month-held email',
  deposit: 'Deposit email',
};

export type SettingsView = {
  element: HTMLElement;
  activate: () => void;
  deactivate: () => void;
};

export function createSettingsView(setStatus: (text: string) => void): SettingsView {
  const zone = el('select', { id: 'settings-zone', class: 'console-input', 'aria-label': 'Time zone' });
  for (const name of Intl.supportedValuesOf('timeZone')) {
    zone.append(el('option', { value: name, text: name.replace(/_/g, ' ') }));
  }
  const save = el('button', { type: 'button', class: 'primary', text: 'Save settings' });
  const queueList = el('ul', { class: 'console-list queue-list', role: 'list', 'aria-label': 'Pending emails' });
  const queueNote = el('p', { class: 'queue-note' });
  const queueRegion = el('div', { class: 'mail-queue', role: 'region', 'aria-label': 'Mail queue' }, [
    el('h3', { class: 'subheading', text: 'Mail queue' }),
    queueList,
    queueNote,
  ]);
  const element = el('div', { class: 'single-pane' }, [
    el('div', { class: 'field' }, [el('label', { for: 'settings-zone', text: 'Time zone' }), zone]),
    save,
    queueRegion,
  ]);

  let timer: number | null = null;
  let tick: number | null = null;
  let clockSkewMs = 0;
  let pending: QueuedEmail[] = [];

  const countdown = (email: QueuedEmail): string => {
    if (email.retry_at === null) return 'Sending';
    const corrected = Date.now() + clockSkewMs;
    const target = Date.parse(email.retry_at);
    if (corrected >= target) return 'Retrying';
    return `Next try in ${Math.ceil((target - corrected) / 1000)}s`;
  };

  const renderQueue = (): void => preserveFocus(() => {
    clear(queueList);
    for (const email of pending) {
      queueList.append(
        el('li', { 'data-kind': email.kind }, [
          document.createTextNode(`${KIND_LABELS[email.kind]} for ${email.reference} to ${email.to}. ${countdown(email)}`),
        ]),
      );
    }
    queueNote.textContent = pending.length === 0 ? 'No emails are waiting.' : '';
  });

  const loadQueue = async (): Promise<void> => {
    const result = await getJson<{ server_time: string; emails: QueuedEmail[] }>('/api/console/mail-queue');
    if (!result.ok) {
      queueNote.textContent = 'The mail queue could not refresh. Retrying\u2026';
      return;
    }
    clockSkewMs = Date.parse(result.data.server_time) - Date.now();
    pending = result.data.emails;
    renderQueue();
  };

  const loadSettings = async (): Promise<void> => {
    const result = await getJson<{ time_zone: string }>('/api/console/settings');
    if (result.ok) zone.value = result.data.time_zone;
  };

  save.addEventListener('click', () => {
    void (async () => {
      const result = await requestJson<unknown>('PUT', '/api/console/settings', { body: { time_zone: zone.value } });
      if (result.ok) {
        setStatus('Settings saved.');
        return;
      }
      setStatus(result.status === 422 ? 'Choose a time zone from the list.' : result.message);
    })();
  });

  return {
    element,
    activate: () => {
      void loadSettings();
      void loadQueue();
      timer ??= window.setInterval(() => void loadQueue(), QUEUE_POLL_MS);
      tick ??= window.setInterval(renderQueue, 1_000);
    },
    deactivate: () => {
      if (timer !== null) window.clearInterval(timer);
      if (tick !== null) window.clearInterval(tick);
      timer = null;
      tick = null;
    },
  };
}
