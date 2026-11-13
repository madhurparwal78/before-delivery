import { useRef, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { useArrivalFocus } from '../lib/landing.js';
import type { Sale, Session } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { formatDateTime } from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { paymentLabel } from '../../shared/options.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

export function SaleScreen({ session, saleId }: { session: Session; saleId: string }) {
  const sale = usePolling(() => get<{ sale: Sale }>(`/api/sales/${saleId}`), saleId);
  const dialog = useOverlay();
  const heading = useRef<HTMLHeadingElement>(null);
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);
  useArrivalFocus(heading, sale.data !== null);

  if (sale.failure?.status === 404) return <NotFoundScreen />;
  const found = sale.data?.sale;
  const mayRefund = session.member.role !== 'bookkeeper';

  const refund = async (): Promise<void> => {
    setPending(true);
    try {
      const result = await post<{ sale: Sale }>(`/api/sales/${saleId}/refund`);
      setProblems(noProblems);
      dialog.close();
      await sale.reload();
      heading.current?.focus();
      announce(copy.refundRecorded(result.sale.tagCode));
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
      {found === undefined ? (
        <p class="screen__loading">Reading this sale…</p>
      ) : (
        <>
          <h1 ref={heading} class="heading heading--1 tabular" tabIndex={-1}>
            {`Sale ${found.tagCode}`}
          </h1>
          {dialog.mounted ? null : (
            <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          )}
          <dl class="facts">
            <dt>Sold at</dt>
            <dd class="tabular">{formatDateTime(Date.parse(found.soldAt))}</dd>
            <dt>Sale price</dt>
            <dd class="tabular">{formatMoney(found.priceCents)}</dd>
            <dt>Consignor share</dt>
            <dd class="tabular">{formatMoney(found.consignorShareCents)}</dd>
            <dt>Commission</dt>
            <dd class="tabular">{formatMoney(found.commissionCents)}</dd>
            <dt>VAT inside the commission</dt>
            <dd class="tabular">{formatMoney(found.vatCents)}</dd>
            <dt>Payment</dt>
            <dd>{paymentLabel(found.payment)}</dd>
            <dt>Sold by</dt>
            <dd>{found.soldBy.name}</dd>
            <dt>Consignor</dt>
            <dd>{found.consignorName}</dd>
            <dt>Refundable until</dt>
            <dd class="tabular">{formatDateTime(Date.parse(found.refundableUntil))}</dd>
          </dl>
          {found.refundedAt === null ? null : (
            <p class="state-note tabular">
              {`Refunded ${formatDateTime(Date.parse(found.refundedAt))}`}
            </p>
          )}
          <Link href={`/staff/pieces/${found.pieceId}`} class="standalone-link">
            Open this piece
          </Link>

          {mayRefund ? (
            <BottomBar>
              <button
                type="button"
                class="button button--primary"
                ref={dialog.openerRef}
                disabled={found.refundedAt !== null}
                onClick={() => dialog.open()}
              >
                Refund
              </button>
            </BottomBar>
          ) : null}

          {dialog.mounted ? (
            <Overlay state={dialog} name="Refund sale">
              <h2 class="dialog__heading">Refund sale</h2>
              <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
              <DialogActions>
                <ActionButton
                  label="Confirm refund"
                  pending={pending}
                  onPress={() => void refund()}
                />
                <button type="button" class="button button--quiet" onClick={() => dialog.close()}>
                  Cancel
                </button>
              </DialogActions>
            </Overlay>
          ) : null}
        </>
      )}
    </StaffShell>
  );
}
