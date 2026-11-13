import { useRef, useState } from 'preact/hooks';
import { ApiError, del, get, patch, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import type { Consignor, ConsignorPayout, Piece, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatDateOnly, formatMonth } from '../../shared/brussels.js';
import { formatIban, formatMoney } from '../../shared/money.js';
import {
  consignorStatusLabel,
  payoutStatusLabel,
  pieceStatusLabel,
} from '../../shared/options.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link, TableFrame } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

interface ConsignorPage {
  consignor: Consignor;
  pieces: Piece[];
  payouts: ConsignorPayout[];
}

const CONTROL_IDS = {
  name: 'edit-consignor-name',
  email: 'edit-consignor-email',
  phone: 'edit-consignor-phone',
  iban: 'edit-consignor-iban',
};

export function ConsignorScreen({
  session,
  consignorId,
}: {
  session: Session;
  consignorId: string;
}) {
  const page = usePolling(
    () => get<ConsignorPage>(`/api/consignors/${consignorId}`),
    consignorId,
  );
  const editDialog = useOverlay();
  const eraseDialog = useOverlay();
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', iban: '' });
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState('');

  if (page.failure?.status === 404) return <NotFoundScreen />;
  const data = page.data;
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

  const sendPageAddress = async (): Promise<void> => {
    setPending('send');
    try {
      await post(`/api/consignors/${consignorId}/portal-link`);
      announce(copy.portalLinkSent);
      setProblems(noProblems);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const endPageAddress = async (): Promise<void> => {
    setPending('end');
    try {
      await del(`/api/consignors/${consignorId}/portal-link`);
      announce(copy.portalLinkEnded);
      setProblems(noProblems);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const saveEdit = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(draft.name)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(draft.email)) fields['email'] = fieldCopy.email;
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending('edit');
    try {
      await patch(`/api/consignors/${consignorId}`, {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim() === '' ? null : draft.phone.trim(),
        iban: draft.iban.trim() === '' ? null : draft.iban.trim(),
      });
      announce(copy.consignorSaved);
      setProblems(noProblems);
      editDialog.close();
      await page.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const erase = async (): Promise<void> => {
    setPending('erase');
    try {
      const result = await post<{ consignor: Consignor }>(
        `/api/consignors/${consignorId}/erase`,
      );
      setProblems(noProblems);
      eraseDialog.close();
      await page.reload();
      heading.current?.focus();
      announce(result.consignor.status === 'erased' ? copy.erased : copy.erasing);
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  return (
    <StaffShell session={session}>
      {data === null || data === undefined ? (
        <p class="screen__loading">Reading this consignor…</p>
      ) : (
        <>
          <h1 ref={heading} class="heading heading--1" tabIndex={-1}>
            {data.consignor.name}
          </h1>
          <p class="state-note">{consignorStatusLabel(data.consignor.status)}</p>
          {editDialog.mounted || eraseDialog.mounted ? null : (
            <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
          )}

          <dl class="facts">
            <dt>Email</dt>
            <dd>{data.consignor.email ?? ''}</dd>
            <dt>Phone</dt>
            <dd class="tabular">{data.consignor.phone ?? ''}</dd>
            <dt>IBAN</dt>
            <dd class="tabular">
              {data.consignor.iban === null ? '' : formatIban(data.consignor.iban)}
            </dd>
          </dl>

          <div class="actions-row">
            {owner ? (
              <ActionButton
                label="End page address"
                variant="quiet"
                pending={pending === 'end'}
                onPress={() => void endPageAddress()}
              />
            ) : null}
            <button
              type="button"
              class="button button--quiet"
              ref={editDialog.openerRef}
              onClick={() => {
                setDraft({
                  name: data.consignor.name,
                  email: data.consignor.email ?? '',
                  phone: data.consignor.phone ?? '',
                  iban: data.consignor.iban ?? '',
                });
                editDialog.open();
              }}
            >
              Edit consignor
            </button>
            {owner ? (
              <button
                type="button"
                class="button button--danger"
                ref={eraseDialog.openerRef}
                onClick={() => eraseDialog.open()}
              >
                Erase consignor
              </button>
            ) : null}
          </div>

          <section class="section">
            <h2 class="section__heading">Their pieces</h2>
            <TableFrame name="Pieces">
              <table class="table" aria-label="Pieces">
                <thead>
                  <tr>
                    <th scope="col">Tag code</th>
                    <th scope="col">Description</th>
                    <th scope="col">Price</th>
                    <th scope="col">Status</th>
                    <th scope="col">Intake</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pieces.map((piece) => (
                    <tr key={piece.id}>
                      <td class="tabular">
                        <Link href={`/staff/pieces/${piece.id}`}>{piece.tagCode}</Link>
                      </td>
                      <td>{piece.description}</td>
                      <td class="tabular">{formatMoney(piece.currentPriceCents)}</td>
                      <td>{pieceStatusLabel(piece.status)}</td>
                      <td class="tabular">{formatDateOnly(piece.intakeDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </section>

          <section class="section">
            <h2 class="section__heading">Their payouts</h2>
            <TableFrame name="Payouts">
              <table class="table" aria-label="Payouts">
                <thead>
                  <tr>
                    <th scope="col">Payout</th>
                    <th scope="col">Month</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((payout) => (
                    <tr key={payout.id}>
                      <td class="tabular">{payout.id}</td>
                      <td>{formatMonth(payout.month)}</td>
                      <td class="tabular">{formatMoney(payout.amountCents)}</td>
                      <td>{payout.reason ?? payoutStatusLabel(payout.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </section>

          <BottomBar>
            <ActionButton
              label="Send page address"
              pending={pending === 'send'}
              onPress={() => void sendPageAddress()}
            />
          </BottomBar>

          {editDialog.mounted ? (
            <Overlay state={editDialog} name="Edit consignor">
              <h2 class="dialog__heading">Edit consignor</h2>
              <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
              <Field
                id={CONTROL_IDS.name}
                label="Name"
                value={draft.name}
                onInput={(value) => setDraft((current) => ({ ...current, name: value }))}
                problem={problems.fields['name']}
              />
              <Field
                id={CONTROL_IDS.email}
                label="Email"
                type="email"
                value={draft.email}
                onInput={(value) => setDraft((current) => ({ ...current, email: value }))}
                problem={problems.fields['email']}
              />
              <Field
                id={CONTROL_IDS.phone}
                label="Phone"
                type="tel"
                value={draft.phone}
                onInput={(value) => setDraft((current) => ({ ...current, phone: value }))}
                problem={problems.fields['phone']}
              />
              <Field
                id={CONTROL_IDS.iban}
                label="IBAN"
                value={draft.iban}
                onInput={(value) => setDraft((current) => ({ ...current, iban: value }))}
                problem={problems.fields['iban']}
              />
              <DialogActions>
                <ActionButton
                  label="Save consignor"
                  pending={pending === 'edit'}
                  onPress={() => void saveEdit()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => editDialog.close()}
                >
                  Cancel
                </button>
              </DialogActions>
            </Overlay>
          ) : null}

          {eraseDialog.mounted ? (
            <Overlay state={eraseDialog} name="Erase consignor">
              <h2 class="dialog__heading">Erase consignor</h2>
              <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
              <p class="dialog__note">
                Their name, email, phone and IBAN go, their unsold pieces are archived and
                their photos are deleted. Their sales stay as Erased consignor.
              </p>
              <DialogActions>
                <ActionButton
                  label="Erase"
                  variant="danger"
                  pending={pending === 'erase'}
                  onPress={() => void erase()}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => eraseDialog.close()}
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
