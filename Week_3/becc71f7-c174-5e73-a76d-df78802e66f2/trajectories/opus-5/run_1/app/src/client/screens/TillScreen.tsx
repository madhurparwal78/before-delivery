import { useRef, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { focusHeadingOnArrival } from '../lib/landing.js';
import type { Piece, Sale, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import { PAYMENTS, sizeLabel } from '../../shared/options.js';
import { Overlay } from '../components/Overlay.js';
import { Tag } from '../components/Tag.js';
import { ActionButton, DialogActions, Field, RadioGroup } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar } from '../components/layout.js';

export function TillScreen({ session }: { session: Session }) {
  const [tag, setTag] = useState('');
  const [piece, setPiece] = useState<Piece | null>(null);
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [payment, setPayment] = useState('card');
  const [finding, setFinding] = useState(false);
  const [selling, setSelling] = useState(false);
  const dialog = useOverlay();
  // Every till request carries a fresh request key; a retry of the same press reuses it.
  const requestKey = useRef<string>('');

  const find = async (): Promise<void> => {
    setFinding(true);
    try {
      const found = await get<{ piece: Piece }>(
        `/api/pieces/lookup?tag=${encodeURIComponent(tag.trim())}`,
      );
      setPiece(found.piece);
      setProblems(noProblems);
    } catch (error) {
      if (error instanceof ApiError) {
        setPiece(null);
        setProblems(
          error.failure.status === 404
            ? problemsOf({}, 'No piece carries that tag code.')
            : problemsOf({ tag: error.failure.fields['tag'] ?? fieldCopy.tagCode }),
        );
      }
    } finally {
      setFinding(false);
    }
  };

  const sell = async (): Promise<void> => {
    if (piece === null) return;
    if (requestKey.current === '') requestKey.current = crypto.randomUUID();
    setSelling(true);
    try {
      const result = await post<{ sale: Sale }>(
        '/api/sales',
        { pieceId: piece.id, payment },
        { 'Request-Key': requestKey.current },
      );
      announce(copy.saleComplete(result.sale.tagCode, formatMoney(result.sale.priceCents)));
      setProblems(noProblems);
      requestKey.current = '';
      dialog.close();
      focusHeadingOnArrival();
      go(`/staff/sales/${result.sale.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        setProblems(problemsOf({}, error.failure.message));
        announce(error.failure.message);
      }
    } finally {
      setSelling(false);
    }
  };

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Till</h1>
      <form
        class="card till"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        {dialog.mounted ? null : (
          <ProblemsSummary problems={problems} controlIds={{ tag: 'till-tag' }} labels={{}} />
        )}
        <Field
          id="till-tag"
          label="Tag code"
          value={tag}
          onInput={setTag}
          problem={problems.fields['tag']}
        />
        <ActionButton
          label="Find piece"
          variant="quiet"
          pending={finding}
          onPress={() => void find()}
        />
      </form>

      {piece === null ? null : (
        <section class="section card till__piece">
          <h2 class="section__heading tabular">{piece.tagCode}</h2>
          <p>{piece.description}</p>
          <p>
            {piece.brand}
            <span aria-hidden="true"> · </span>
            {sizeLabel(piece.size)}
          </p>
          <Tag
            priceCents={piece.currentPriceCents}
            previousPriceCents={piece.previousPriceCents}
            size="page"
          />
        </section>
      )}

      <BottomBar>
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          disabled={piece === null || (piece.status !== 'on_rail' && piece.status !== 'on_hold')}
          onClick={() => {
            requestKey.current = crypto.randomUUID();
            dialog.open();
          }}
        >
          Sell
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="Sell piece">
          <h2 class="dialog__heading">Sell piece</h2>
          <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          <p class="dialog__price price tabular">
            {piece === null ? '' : formatMoney(piece.currentPriceCents)}
          </p>
          <RadioGroup
            id="till-payment"
            label="Payment"
            value={payment}
            options={PAYMENTS}
            onChange={setPayment}
            columns
          />
          <DialogActions>
            <ActionButton label="Complete sale" pending={selling} onPress={() => void sell()} />
            <button type="button" class="button button--quiet" onClick={() => dialog.close()}>
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
