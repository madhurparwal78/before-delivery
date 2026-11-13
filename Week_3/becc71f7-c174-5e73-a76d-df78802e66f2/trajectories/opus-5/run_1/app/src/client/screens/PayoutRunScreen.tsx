import { useRef, useState } from 'preact/hooks';
import { ApiError, download, get } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { announce } from '../lib/announce.js';
import { useArrivalFocus } from '../lib/landing.js';
import type { PayoutRun, Session } from '../lib/types.js';
import { formatDateTime, formatMonth } from '../../shared/brussels.js';
import { formatIban, formatMoney } from '../../shared/money.js';
import { payoutStatusLabel } from '../../shared/options.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, TableFrame } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

export function PayoutRunScreen({ session, month }: { session: Session; month: string }) {
  const run = usePolling(() => get<{ run: PayoutRun }>(`/api/payout-runs/${month}`), month);
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState(false);
  useArrivalFocus(heading, run.data !== null);

  if (run.failure?.status === 404) return <NotFoundScreen />;
  const found = run.data?.run;

  const fetchFile = async (): Promise<void> => {
    setPending(true);
    try {
      await download(`/api/payout-runs/${month}/file`);
    } catch (error) {
      if (error instanceof ApiError) announce(error.failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session}>
      {found === undefined ? (
        <p class="screen__loading">Reading this run…</p>
      ) : (
        <>
          <h1 ref={heading} class="heading heading--1" tabIndex={-1}>
            {`Payout run ${formatMonth(found.month)}`}
          </h1>
          <p class="state-note">{found.status === 'ready' ? 'Ready' : found.status}</p>
          <dl class="facts">
            <dt>Started by</dt>
            <dd>{found.startedBy.name}</dd>
            <dt>Started at</dt>
            <dd class="tabular">{formatDateTime(Date.parse(found.startedAt))}</dd>
            <dt>Message id</dt>
            <dd class="tabular">{found.msgId}</dd>
            <dt>Control sum</dt>
            <dd class="tabular">{formatMoney(found.controlSumCents)}</dd>
          </dl>

          <TableFrame name="Payouts">
            <table class="table" aria-label="Payouts">
              <thead>
                <tr>
                  <th scope="col">Payout</th>
                  <th scope="col">Consignor</th>
                  <th scope="col">IBAN</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(found.payouts ?? []).map((payout) => (
                  <tr key={payout.id}>
                    <td class="tabular">{payout.id}</td>
                    <td>{payout.consignorName}</td>
                    <td class="tabular">
                      {payout.iban === null ? '' : formatIban(payout.iban)}
                    </td>
                    <td class="tabular">{formatMoney(payout.amountCents)}</td>
                    <td>{payout.reason ?? payoutStatusLabel(payout.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>

          <BottomBar>
            <a
              href={`/api/payout-runs/${month}/file`}
              class="button button--primary"
              onClick={(event) => {
                event.preventDefault();
                if (!pending) void fetchFile();
              }}
            >
              Download bank file
            </a>
          </BottomBar>
        </>
      )}
    </StaffShell>
  );
}
