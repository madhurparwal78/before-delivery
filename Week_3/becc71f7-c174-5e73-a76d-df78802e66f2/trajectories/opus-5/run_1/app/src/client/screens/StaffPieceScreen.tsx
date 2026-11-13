import { useRef, useState } from 'preact/hooks';
import { ApiError, call, get, patch, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { focusHeadingOnArrival, useArrivalFocus } from '../lib/landing.js';
import type { Hold, Piece, Sale, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatDateOnly, formatTime } from '../../shared/brussels.js';
import { formatMoney, parseEuros } from '../../shared/money.js';
import { PAYMENTS, conditionLabel, pieceStatusLabel, sizeLabel } from '../../shared/options.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Garment } from '../components/Garment.js';
import { Overlay } from '../components/Overlay.js';
import { Stations } from '../components/Stations.js';
import { Tag } from '../components/Tag.js';
import { ActionButton, DialogActions, Field, RadioGroup } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

export function StaffPieceScreen({ session, pieceId }: { session: Session; pieceId: string }) {
  const piece = usePolling(() => get<{ piece: Piece }>(`/api/pieces/${pieceId}`), pieceId);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useArrivalFocus(heading, piece.data !== null);

  const priceDialog = useOverlay();
  const holdDialogState = useOverlay();
  const sellDialog = useOverlay();
  const archiveDialog = useOverlay();

  const [askingPrice, setAskingPrice] = useState('');
  const [shopperName, setShopperName] = useState('');
  const [shopperEmail, setShopperEmail] = useState('');
  const [payment, setPayment] = useState('card');
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState('');

  if (piece.failure?.status === 404) return <NotFoundScreen />;
  const found = piece.data?.piece;

  const owner = session.member.role === 'owner';

  const refuse = (error: unknown): void => {
    if (!(error instanceof ApiError)) return;
    const { failure } = error;
    setProblems(
      Object.keys(failure.fields).length > 0
        ? problemsOf(failure.fields)
        : problemsOf({}, failure.message),
    );
    announce(failure.message);
  };

  const savePrice = async (): Promise<void> => {
    const cents = parseEuros(askingPrice);
    if (cents === null || cents < 100 || cents > 1_000_000) {
      setProblems(problemsOf({ askingPriceCents: fieldCopy.askingPrice }));
      return;
    }
    setPending('price');
    try {
      const updated = await patch<{ piece: Piece }>(
        `/api/pieces/${pieceId}`,
        { askingPriceCents: cents },
        { 'If-Match': `"${found?.version ?? 1}"` },
      );
      announce(copy.priceSaved(formatMoney(updated.piece.currentPriceCents)));
      setProblems(noProblems);
      priceDialog.close();
      await piece.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const placeHold = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(shopperName)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(shopperEmail)) fields['email'] = fieldCopy.email;
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending('hold');
    try {
      const result = await post<{ hold: Hold }>(`/api/pieces/${pieceId}/holds`, {
        name: shopperName.trim(),
        email: shopperEmail.trim(),
      });
      announce(copy.holdPlacedStaff(formatTime(Date.parse(result.hold.endsAt))));
      setProblems(noProblems);
      holdDialogState.close();
      focusHeadingOnArrival();
      go(`/staff/holds/${result.hold.id}`);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const sell = async (): Promise<void> => {
    setPending('sell');
    try {
      const result = await post<{ sale: Sale }>(
        '/api/sales',
        { pieceId, payment },
        { 'Request-Key': crypto.randomUUID() },
      );
      announce(copy.saleComplete(result.sale.tagCode, formatMoney(result.sale.priceCents)));
      setProblems(noProblems);
      sellDialog.close();
      focusHeadingOnArrival();
      go(`/staff/sales/${result.sale.id}`);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const archive = async (): Promise<void> => {
    setPending('archive');
    try {
      await post(`/api/pieces/${pieceId}/archive`);
      archiveDialog.close();
      await piece.reload();
      heading.current?.focus();
      announce(copy.pieceArchived);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const bringBack = async (): Promise<void> => {
    setPending('restore');
    try {
      await post(`/api/pieces/${pieceId}/restore`);
      await piece.reload();
      announce(copy.pieceBroughtBack);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const markCollected = async (): Promise<void> => {
    setPending('collected');
    try {
      const result = await post<{ piece: Piece }>(`/api/pieces/${pieceId}/collected`);
      await piece.reload();
      announce(copy.pieceCollected(result.piece.tagCode));
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const addPhoto = async (file: File): Promise<void> => {
    const body = new FormData();
    body.append('photo', file);
    setPending('photo');
    try {
      await call('POST', `/api/pieces/${pieceId}/photos`, { raw: body });
      announce(copy.photoSaved);
      setProblems(noProblems);
      await piece.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const sellable = found?.status === 'on_rail' || found?.status === 'on_hold';
  const anyDialogOpen =
    priceDialog.mounted || holdDialogState.mounted || sellDialog.mounted || archiveDialog.mounted;

  return (
    <StaffShell session={session}>
      {found === undefined ? (
        <p class="screen__loading">Reading this piece…</p>
      ) : (
        <>
          <h1 ref={heading} class="heading heading--1 tabular" tabIndex={-1}>
            {found.tagCode}
          </h1>
          {anyDialogOpen ? null : (
            <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          )}

          <div class="piece-page__layout">
            <div class="piece-page__photos">
              {found.photos.length === 0 ? (
                <Garment category={found.category} seed={found.tagCode} />
              ) : (
                found.photos.map((photo) => (
                  <figure key={photo.id}>
                    <img src={photo.publicUrl} alt="" />
                    {owner ? (
                      <figcaption>
                        <a href={`/api/photos/${photo.id}/original`}>Download original</a>
                      </figcaption>
                    ) : null}
                  </figure>
                ))
              )}
            </div>
            <div class="piece-page__facts">
              <Tag
                priceCents={found.currentPriceCents}
                previousPriceCents={found.previousPriceCents}
                size="page"
              />
              <dl class="facts">
                <dt>Description</dt>
                <dd>{found.description}</dd>
                <dt>Consignor</dt>
                <dd>
                  <Link href={`/staff/consignors/${found.consignor.id}`}>
                    {found.consignor.name}
                  </Link>
                </dd>
                <dt>Brand</dt>
                <dd>{found.brand}</dd>
                <dt>Size</dt>
                <dd>{sizeLabel(found.size)}</dd>
                <dt>Condition</dt>
                <dd>{conditionLabel(found.condition)}</dd>
                <dt>Asking price</dt>
                <dd class="tabular">{formatMoney(found.askingPriceCents)}</dd>
                <dt>Intake date</dt>
                <dd class="tabular">{formatDateOnly(found.intakeDate)}</dd>
                <dt>Status</dt>
                <dd>{pieceStatusLabel(found.status)}</dd>
              </dl>
            </div>
          </div>

          <Stations stations={found.stations} />

          <section class="section">
            <h2 class="section__heading">Photos</h2>
            <p class="field">
              <label class="field__label" for="piece-photo">
                Photo
              </label>
              <input
                ref={fileInput}
                id="piece-photo"
                class="field__input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = (event.currentTarget as HTMLInputElement).files?.[0];
                  if (file !== undefined) void addPhoto(file);
                }}
              />
            </p>
            <ActionButton
              label="Add photo"
              pending={pending === 'photo'}
              variant="quiet"
              onPress={() => fileInput.current?.click()}
            />
          </section>

          <section class="section">
            <h2 class="section__heading">Actions</h2>
            <div class="actions-row">
              {owner && sellable ? (
                <button
                  type="button"
                  class="button button--quiet"
                  ref={priceDialog.openerRef}
                  onClick={() => {
                    setAskingPrice((found.askingPriceCents / 100).toFixed(2));
                    priceDialog.open();
                  }}
                >
                  Change price
                </button>
              ) : null}
              {found.status === 'on_rail' ? (
                <button
                  type="button"
                  class="button button--quiet"
                  ref={holdDialogState.openerRef}
                  onClick={() => holdDialogState.open()}
                >
                  Place hold
                </button>
              ) : null}
              {owner &&
              (found.status === 'on_rail' ||
                found.status === 'returns_shelf' ||
                found.status === 'donation_box' ||
                found.status === 'returned') ? (
                <button
                  type="button"
                  class="button button--quiet"
                  ref={archiveDialog.openerRef}
                  onClick={() => archiveDialog.open()}
                >
                  Archive
                </button>
              ) : null}
              {owner && found.status === 'archived' ? (
                <ActionButton
                  label="Bring back"
                  variant="quiet"
                  pending={pending === 'restore'}
                  onPress={() => void bringBack()}
                />
              ) : null}
              {found.status === 'returns_shelf' ? (
                <ActionButton
                  label="Mark collected"
                  variant="quiet"
                  pending={pending === 'collected'}
                  onPress={() => void markCollected()}
                />
              ) : null}
            </div>
          </section>

          <BottomBar>
            <button
              type="button"
              class="button button--primary"
              ref={sellDialog.openerRef}
              disabled={!sellable}
              onClick={() => sellDialog.open()}
            >
              Sell
            </button>
          </BottomBar>

          {priceDialog.mounted ? (
            <Overlay state={priceDialog} name="Change price">
              <h2 class="dialog__heading">Change price</h2>
              <ProblemsSummary
                problems={problems}
                controlIds={{ askingPriceCents: 'change-price' }}
                labels={{}}
              />
              <Field
                id="change-price"
                label="Asking price"
                value={askingPrice}
                inputMode="decimal"
                onInput={setAskingPrice}
                problem={problems.fields['askingPriceCents']}
              />
              <DialogActions>
                <ActionButton
                  label="Save price"
                  pending={pending === 'price'}
                  onPress={() => void savePrice()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => priceDialog.close()}
                >
                  Cancel
                </button>
              </DialogActions>
            </Overlay>
          ) : null}

          {holdDialogState.mounted ? (
            <Overlay state={holdDialogState} name="Place hold">
              <h2 class="dialog__heading">Place hold</h2>
              <ProblemsSummary
                problems={problems}
                controlIds={{ name: 'staff-hold-name', email: 'staff-hold-email' }}
                labels={{}}
              />
              <Field
                id="staff-hold-name"
                label="Shopper name"
                value={shopperName}
                onInput={setShopperName}
                problem={problems.fields['name']}
              />
              <Field
                id="staff-hold-email"
                label="Shopper email"
                type="email"
                value={shopperEmail}
                onInput={setShopperEmail}
                problem={problems.fields['email']}
              />
              <DialogActions>
                <ActionButton
                  label="Hold piece"
                  pending={pending === 'hold'}
                  onPress={() => void placeHold()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => holdDialogState.close()}
                >
                  Cancel
                </button>
              </DialogActions>
            </Overlay>
          ) : null}

          {sellDialog.mounted ? (
            <Overlay state={sellDialog} name="Sell piece">
              <h2 class="dialog__heading">Sell piece</h2>
              <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
              <p class="dialog__price price tabular">{formatMoney(found.currentPriceCents)}</p>
              <RadioGroup
                id="sell-payment"
                label="Payment"
                value={payment}
                options={PAYMENTS}
                onChange={setPayment}
                columns
              />
              <DialogActions>
                <ActionButton
                  label="Complete sale"
                  pending={pending === 'sell'}
                  onPress={() => void sell()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => sellDialog.close()}
                >
                  Cancel
                </button>
              </DialogActions>
            </Overlay>
          ) : null}

          {archiveDialog.mounted ? (
            <Overlay state={archiveDialog} name="Archive piece">
              <h2 class="dialog__heading">Archive piece</h2>
              <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
              <DialogActions>
                <ActionButton
                  label="Archive piece"
                  pending={pending === 'archive'}
                  onPress={() => void archive()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => archiveDialog.close()}
                >
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
