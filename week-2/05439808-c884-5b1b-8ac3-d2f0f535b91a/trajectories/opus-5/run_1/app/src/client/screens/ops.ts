import { request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { button, el, field, setText } from '../dom.js';
import { run } from '../ui/action.js';
import type { Screen } from './types.js';

type OpsStatus = { database: string; mail: string; queuedMail: number };

export function opsScreen(): Screen {
  const database = el('p', { class: 'status-line' });
  const mail = el('p', { class: 'status-line' });
  const queued = el('p', { class: 'status-line' });
  const status = el(
    'section',
    { role: 'region', 'aria-label': 'Service status', class: 'ops-status' },
    [database, mail, queued]
  );

  const raidId = field('Raid ID');
  const rerun = button('Re-run raid', { class: 'primary' });
  rerun.addEventListener('click', () => {
    void run({
      action: 'rerun',
      pending: pendingCopy.rerun,
      control: rerun,
      fields: { raidId },
      work: () =>
        request<{
          seed: number;
          finalTick: number;
          match: boolean;
          firstMismatchTick: number | null;
        }>('POST', `/api/ops/raids/${raidId.input.value}/rerun`, { body: {} }),
      success: (result) =>
        result.match
          ? noticeCopy.rerunMatch(result.seed, result.finalTick)
          : noticeCopy.rerunMismatch(result.seed, result.firstMismatchTick ?? 0)
    });
  });

  const check = button('Check ledger');
  check.addEventListener('click', () => {
    void run({
      action: 'ledgerCheck',
      pending: pendingCopy.ledgerCheck,
      control: check,
      work: () =>
        request<{ pairs: number; unbalancedPairs: number; overCap: number }>(
          'GET',
          '/api/ops/ledger/check'
        ),
      success: (result) =>
        result.unbalancedPairs === 0 && result.overCap === 0
          ? noticeCopy.ledgerBalanced(result.pairs)
          : noticeCopy.ledgerUnbalanced(result.unbalancedPairs, result.overCap)
    });
  });

  const node = el('div', { class: 'ops-screen' }, [
    el('h1', { text: 'Operations' }),
    status,
    el('div', { class: 'ops-form' }, [raidId.wrapper, rerun]),
    check
  ]);

  const load = async (): Promise<void> => {
    try {
      const result = await request<OpsStatus>('GET', '/api/ops/status');
      setText(database, `Database: ${result.database}`);
      setText(
        mail,
        result.mail === 'up' ? 'Mail: delivering' : 'Mail: queued, Mailpit unreachable'
      );
      setText(queued, `Queued mail: ${result.queuedMail}`);
    } catch {
      setText(database, 'Database: down');
      setText(mail, 'Mail: queued, Mailpit unreachable');
      setText(queued, 'Queued mail: 0');
    }
  };

  return {
    mount(stage, panelHost) {
      stage.append(node);
      panelHost.replaceChildren();
      void load();
    },
    update() {
      void load();
    },
    dispose() {
      node.remove();
    }
  };
}
