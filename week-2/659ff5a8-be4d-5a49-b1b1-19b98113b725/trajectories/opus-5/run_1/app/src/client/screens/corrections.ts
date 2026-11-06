import type { CorrectionDto, CorrectionValues } from '../../shared/api';
import { api } from '../api';
import { el, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { formatInZone } from '../ui';
import { createEventShell } from './eventShell';

/** `51.907 +0` for a timed value, `DNF` otherwise. */
export function correctionValueText(values: CorrectionValues): string {
  if (values.outcome === 'dnf' || values.rawTime === null) return 'DNF';
  return `${values.rawTime} +${values.cones ?? 0}`;
}

export function correctionTime(at: string, timeZone: string): { date: string; time: string } {
  return formatInZone(at, timeZone);
}

export function renderCorrections(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'corrections');
  const host = el('div', { class: 'corrections' });
  replace(
    shell.content,
    el(
      'div',
      {},
      el('h1', { class: 'page-heading', text: 'Correction log' }),
      host,
    ),
  );

  function paint(corrections: CorrectionDto[], timeZone: string): void {
    replace(
      host,
      el(
        'table',
        { class: 'data-table', attrs: { 'aria-label': 'Correction log' } },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'Time' }),
            el('th', { text: 'Car' }),
            el('th', { text: 'Run' }),
            el('th', { text: 'Before' }),
            el('th', { text: 'After' }),
            el('th', { text: 'By' }),
            el('th', { text: 'Reason' }),
          ),
        ),
        el(
          'tbody',
          {},
          corrections.map((correction) => {
            const stamp = correctionTime(correction.at, timeZone);
            return el(
              'tr',
              {},
              el('td', { class: 'mono', text: `${stamp.date} ${stamp.time}` }),
              el('td', { class: 'mono', text: `${correction.carNumber} ${correction.classCode}` }),
              el('td', { class: 'mono num', text: String(correction.runNumber) }),
              el('td', { class: 'mono', text: correctionValueText(correction.before) }),
              el('td', { class: 'mono', text: correctionValueText(correction.after) }),
              el('td', { text: correction.actor.name }),
              el('td', { text: correction.reason }),
            );
          }),
        ),
      ),
    );
  }

  async function reload(): Promise<void> {
    const event = shell.current() ?? (await shell.refreshEvent());
    const result = await api.events.corrections(shell.eventId);
    paint(result.corrections, event?.timeZone ?? 'UTC');
  }

  const timer = window.setInterval(() => {
    void reload();
  }, 5_000);
  void reload();

  return {
    element: shell.element,
    destroy: () => {
      window.clearInterval(timer);
      shell.destroy();
    },
  };
}
