// The Operations screen, for the studio operator: service status, raid re-run, ledger check.
import { el, notice, alertMessage } from '../ui.ts';
import { api, ApiRequestError } from '../api.ts';
import { setPollJob } from '../state.ts';

export async function renderOps(root: HTMLElement): Promise<void> {
  const screen = el('div', { class: 'ops-screen' });
  root.replaceChildren(screen);
  screen.append(el('h1', { text: 'Operations' }));

  const database = el('span', { text: 'Database: …' });
  const mail = el('span', { text: 'Mail: …' });
  const queued = el('span', { text: 'Queued mail: 0' });
  const statusRegion = el('section', { role: 'region', 'aria-label': 'Service status' },
    el('div', { class: 'status-row' }, database, mail, queued)
  );
  screen.append(statusRegion);

  const updateStatus = async (): Promise<void> => {
    try {
      const status = await api<{ database: string; mail: string; queuedMail: number }>('GET', '/api/ops/status');
      database.textContent = `Database: ${status.database === 'up' ? 'up' : 'down'}`;
      mail.textContent = `Mail: ${status.mail === 'up' ? 'delivering' : 'queued, Mailpit unreachable'}`;
      queued.textContent = `Queued mail: ${status.queuedMail}`;
    } catch {
      // retried on the next poll
    }
  };
  await updateStatus();
  setPollJob('ops', async () => {
    await updateStatus();
  });

  const raidId = el('input', { type: 'text', 'aria-label': 'Raid ID' });
  const rerunButton = el('button', { text: 'Re-run raid', onclick: async () => {
    notice('Re-running seed…');
    try {
      const report = await api<{ raidId: number; seed: number; finalTick: number; match: boolean; firstMismatchTick: number | null }>('POST', `/api/ops/raids/${raidId.value}/rerun`, {});
      if (report.match) {
        notice(`Seed ${report.seed} re-run matches every tick (0–${report.finalTick}).`);
      } else {
        notice(`Seed ${report.seed} re-run differs from tick ${report.firstMismatchTick}.`);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.api.code === 'not_found') {
        alertMessage('No raid has that ID.');
      } else if (err instanceof ApiRequestError && err.api.code === 'raid_not_resolved') {
        alertMessage('That raid has no result to re-run.');
      } else {
        alertMessage('Lost contact with the server. Check your connection and try again.');
      }
    }
  }});
  screen.append(el('section', {}, el('h2', { text: 'Raid re-run' }), el('div', { class: 'row' }, raidId, rerunButton)));

  const ledgerButton = el('button', { text: 'Check ledger', onclick: async () => {
    notice('Checking…');
    try {
      const report = await api<{ pairs: number; unbalancedPairs: number; overCap: number }>('GET', '/api/ops/ledger/check');
      if (report.unbalancedPairs === 0 && report.overCap === 0) {
        notice(`Ledger balanced: ${report.pairs} pairs.`);
      } else {
        notice(`Ledger unbalanced: ${report.unbalancedPairs} pairs, ${report.overCap} balances over cap.`);
      }
    } catch {
      alertMessage('Lost contact with the server. Check your connection and try again.');
    }
  }});
  screen.append(el('section', {}, el('h2', { text: 'Ledger' }), ledgerButton));
}
