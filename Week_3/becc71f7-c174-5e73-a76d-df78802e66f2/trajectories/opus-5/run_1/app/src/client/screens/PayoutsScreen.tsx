import { useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { focusHeadingOnArrival } from '../lib/landing.js';
import { dropDialog, holdDialog } from '../lib/resume.js';
import type { PayoutRun, Session } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import {
  addMonths,
  brusselsDate,
  formatDateTime,
  formatMonth,
  monthOf,
} from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Select } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link, TableFrame } from '../components/layout.js';

const DIALOG = 'start-payout-run';

/** Only a month that has ended in Brussels can have a run. */
function endedMonths(now: number): string[] {
  const thisMonth = monthOf(brusselsDate(now));
  return Array.from({ length: 12 }, (_, index) => addMonths(thisMonth, -(index + 1)));
}

export function PayoutsScreen({ session }: { session: Session }) {
  const runs = usePolling(() => get<{ runs: PayoutRun[] }>('/api/payout-runs'), 'payout-runs');
  const dialog = useOverlay();
  const months = endedMonths(Date.now());
  const [month, setMonth] = useState(months[0] as string);
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);
  const owner = session.member.role === 'owner';

  const rows = runs.data?.runs ?? [];

  const start = async (): Promise<void> => {
    setPending(true);
    try {
      const result = await post<{ run: PayoutRun }>('/api/payout-runs', { month });
      announce(
        result.run.month === month && result.run.readyAt !== null && rows.every((run) => run.month !== month)
          ? copy.payoutRunReady(formatMonth(result.run.month))
          : copy.payoutRunAlreadyStarted(
              result.run.startedBy.name,
              formatDateTime(Date.parse(result.run.startedAt)),
            ),
      );
      setProblems(noProblems);
      dropDialog(DIALOG);
      dialog.close();
      focusHeadingOnArrival();
      go(`/staff/payouts/${result.run.month}`);
    } catch (error) {
      if (error instanceof ApiError) {
        const { failure } = error;
        setProblems(
          Object.keys(failure.fields).length > 0
            ? problemsOf(failure.fields)
            : problemsOf({}, failure.message),
        );
        announce(failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Payout runs</h1>
      <TableFrame name="Payout runs">
        <table class="table" aria-label="Payout runs">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Status</th>
              <th scope="col">Started by</th>
              <th scope="col">Started at</th>
              <th scope="col">Control sum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr key={run.month}>
                <td>
                  <Link href={`/staff/payouts/${run.month}`}>{formatMonth(run.month)}</Link>
                </td>
                <td>{run.status === 'ready' ? 'Ready' : run.status}</td>
                <td>{run.startedBy.name}</td>
                <td class="tabular">{formatDateTime(Date.parse(run.startedAt))}</td>
                <td class="tabular">{formatMoney(run.controlSumCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

      {owner ? (
        <BottomBar>
          <button
            type="button"
            class="button button--primary"
            ref={dialog.openerRef}
            onClick={() => {
              holdDialog(DIALOG, { month });
              dialog.open();
            }}
          >
            Start payout run
          </button>
        </BottomBar>
      ) : null}

      {dialog.mounted ? (
        <Overlay state={dialog} name="Start payout run">
          <h2 class="dialog__heading">Start payout run</h2>
          <ProblemsSummary problems={problems} controlIds={{ month: 'payout-month' }} labels={{}} />
          <Select
            id="payout-month"
            label="Month"
            value={month}
            options={months.map((value) => ({ value, label: formatMonth(value) }))}
            onChange={(value) => {
              setMonth(value);
              holdDialog(DIALOG, { month: value });
            }}
            problem={problems.fields['month']}
          />
          <DialogActions>
            <ActionButton label="Start run" pending={pending} onPress={() => void start()} />
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                dropDialog(DIALOG);
                dialog.close();
              }}
            >
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
