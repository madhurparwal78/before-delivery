import { useState } from 'preact/hooks';
import { ApiError, download, get } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import type { SalesBook, Session } from '../lib/types.js';
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
import { Icon } from '../components/Icon.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, TableFrame } from '../components/layout.js';

function recentMonths(now: number): string[] {
  const thisMonth = monthOf(brusselsDate(now));
  return Array.from({ length: 13 }, (_, index) => addMonths(thisMonth, -index));
}

export function SalesBookScreen({ session, search }: { session: Session; search: string }) {
  const months = recentMonths(Date.now());
  const month = new URLSearchParams(search).get('month') ?? (months[0] as string);
  const book = usePolling(() => get<SalesBook>(`/api/sales?month=${month}`), month);
  const dialog = useOverlay();
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);

  const data = book.data;

  const take = async (): Promise<void> => {
    setPending(true);
    try {
      await download(`/api/sales-book?month=${month}`);
      announce(copy.salesBookDownloaded(formatMonth(month)));
      setProblems(noProblems);
      dialog.close();
    } catch (error) {
      if (error instanceof ApiError) {
        setProblems(problemsOf({}, error.failure.message));
        announce(error.failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Sales book</h1>
      <Select
        id="sales-book-month"
        label="Month"
        value={month}
        options={months.map((value) => ({ value, label: formatMonth(value) }))}
        onChange={(value) => go(`/staff/sales-book?month=${value}`)}
      />
      {dialog.mounted ? null : (
        <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
      )}

      <TableFrame name="Sales book">
        <table class="table" aria-label="Sales book">
          <thead>
            <tr>
              <th scope="col">Sale date</th>
              <th scope="col">Tag code</th>
              <th scope="col">Description</th>
              <th scope="col">Consignor</th>
              <th scope="col">Sale price</th>
              <th scope="col">Consignor share</th>
              <th scope="col">Commission</th>
              <th scope="col">VAT</th>
            </tr>
          </thead>
          <tbody>
            {(data?.lines ?? []).map((line) => (
              <tr key={line.saleId}>
                <td class="tabular">{formatDateTime(Date.parse(line.soldAt))}</td>
                <td class="tabular">{line.tagCode}</td>
                <td>{line.description}</td>
                <td>{line.consignorName}</td>
                <td class="tabular">{formatMoney(line.priceCents)}</td>
                <td class="tabular">{formatMoney(line.consignorShareCents)}</td>
                <td class="tabular">{formatMoney(line.commissionCents)}</td>
                <td class="tabular">{formatMoney(line.vatCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                Total
              </th>
              <td class="tabular">{formatMoney(data?.totals.priceCents ?? 0)}</td>
              <td class="tabular">{formatMoney(data?.totals.consignorShareCents ?? 0)}</td>
              <td class="tabular">{formatMoney(data?.totals.commissionCents ?? 0)}</td>
              <td class="tabular">{formatMoney(data?.totals.vatCents ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </TableFrame>

      <BottomBar>
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          onClick={() => dialog.open()}
        >
          <Icon name="download" />
          Download sales book
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="Download sales book">
          <h2 class="dialog__heading">Download sales book</h2>
          <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          <p class="dialog__note">{formatMonth(month)}</p>
          <DialogActions>
            <ActionButton label="Download" pending={pending} onPress={() => void take()} />
            <button type="button" class="button button--quiet" onClick={() => dialog.close()}>
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
