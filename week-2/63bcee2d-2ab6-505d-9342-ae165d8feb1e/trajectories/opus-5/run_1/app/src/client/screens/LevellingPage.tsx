import { useId, useState } from 'react';
import type { Currency, TimeZoneName } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { centsToDecimal, formatAmount, formatInstant } from '../../shared/format.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { useRouter } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../components/Fields.jsx';
import { Panel, TableRegion } from '../components/Panel.jsx';
import { NotFound } from './NotFound.jsx';
import { focusWhenReady } from '../lib/focus.js';

interface Exclusion {
  id: string;
  label: string;
  priceCents: number | null;
}

interface LevelledBid {
  id: string;
  reference: string;
  companyName: string;
  baseCents: number;
  provisionalSums: { label: string; amountCents: number }[];
  provisionalSumsCents: number;
  allowances: { label: string; amountCents: number }[];
  allowancesCents: number;
  exclusions: Exclusion[];
  pricedExclusionsCents: number;
  unpricedExclusions: number;
  subtotalCents: number;
  contingencyCents: number;
  levelledTotalCents: number;
  finalSubmittedAt: string;
  rank: number;
}

interface LevellingPayload {
  contingencyPercent: string;
  currency: Currency;
  bids: LevelledBid[];
}

type SortKey =
  | 'rank'
  | 'bidder'
  | 'base'
  | 'provisional'
  | 'allowances'
  | 'exclusions'
  | 'levelled'
  | 'submitted';

const COLUMNS: { key: SortKey | null; label: string; numeric: boolean }[] = [
  { key: 'rank', label: 'Rank', numeric: false },
  { key: 'bidder', label: 'Bidder', numeric: false },
  { key: 'base', label: 'Base', numeric: true },
  { key: 'provisional', label: 'Provisional sums', numeric: true },
  { key: 'allowances', label: 'Allowances', numeric: true },
  { key: 'exclusions', label: 'Priced exclusions', numeric: true },
  { key: null, label: 'Contingency', numeric: true },
  { key: 'levelled', label: 'Levelled total', numeric: true },
  { key: 'submitted', label: 'Submitted', numeric: false },
];

function valueFor(bid: LevelledBid, key: SortKey): number | string {
  switch (key) {
    case 'rank':
      return bid.rank;
    case 'bidder':
      return `${bid.reference} ${bid.companyName}`;
    case 'base':
      return bid.baseCents;
    case 'provisional':
      return bid.provisionalSumsCents;
    case 'allowances':
      return bid.allowancesCents;
    case 'exclusions':
      return bid.pricedExclusionsCents;
    case 'levelled':
      return bid.levelledTotalCents;
    case 'submitted':
      return bid.finalSubmittedAt;
  }
}

interface LevelDraft {
  allowances: { label: string; amount: string }[];
  prices: Record<string, string>;
}

function parseAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function LevellingPage({ tenderId }: { tenderId: string }): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { refresh, handleFailure } = useWorkspace();
  const { query, navigate } = useRouter();
  const errors = useFormErrors();
  const levelling = useResource<LevellingPayload>(`/api/tenders/${tenderId}/levelling`, [
    tenderId,
  ]);
  const tender = useResource<{
    tender: { title: string; status: string; timeZone: TimeZoneName; project: { id: string } };
  }>(`/api/tenders/${tenderId}`, [tenderId]);
  const [dialog, setDialog] = useState<
    { kind: 'level'; bid: LevelledBid } | { kind: 'award' } | null
  >(null);
  const [draft, setDraft] = useState<LevelDraft>({ allowances: [], prices: {} });
  const [awardBidId, setAwardBidId] = useState('');
  const [awardReason, setAwardReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (levelling.error && levelling.error.code === 'not_found') return <NotFound />;

  const sort = (query.get('sort') ?? 'rank') as SortKey;
  const direction = query.get('dir') === 'desc' ? 'desc' : 'asc';
  const unpriced = query.get('unpriced');
  const search = query.get('q') ?? '';

  const setView = (changes: Record<string, string | null>): void => {
    const params = new URLSearchParams(query);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(name);
      else params.set(name, value);
    }
    const text = params.toString();
    navigate(`/office/tenders/${tenderId}/levelling${text === '' ? '' : `?${text}`}`);
  };

  const all = levelling.data?.bids ?? [];
  const currency = levelling.data?.currency ?? 'HKD';
  const zone = tender.data?.tender.timeZone ?? 'Asia/Hong_Kong';

  const filtered = all
    .filter((bid) => {
      if (unpriced === 'only') return bid.unpricedExclusions > 0;
      if (unpriced === 'hide') return bid.unpricedExclusions === 0;
      return true;
    })
    .filter((bid) => {
      if (search.trim() === '') return true;
      const needle = search.trim().toLowerCase();
      return (
        bid.reference.toLowerCase().includes(needle) ||
        bid.companyName.toLowerCase().includes(needle)
      );
    })
    .slice()
    .sort((left, right) => {
      const a = valueFor(left, sort);
      const b = valueFor(right, sort);
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : a < b ? -1 : a > b ? 1 : 0;
      return direction === 'desc' ? -order : order;
    });

  const openLevel = (bid: LevelledBid): void => {
    errors.clear();
    setDraft({
      allowances: bid.allowances.map((entry) => ({
        label: entry.label,
        amount: centsToDecimal(entry.amountCents),
      })),
      prices: Object.fromEntries(
        bid.exclusions.map((entry) => [
          entry.id,
          entry.priceCents === null ? '' : centsToDecimal(entry.priceCents),
        ]),
      ),
    });
    setDialog({ kind: 'level', bid });
  };

  const saveLevelling = async (bid: LevelledBid): Promise<void> => {
    const found: Record<string, string> = {};
    const allowances = draft.allowances.map((entry, index) => {
      const amount = parseAmount(entry.amount);
      if (Number.isNaN(amount)) {
        found[`allowances[${index}].amountCents`] = fieldErrorCopy.badAmount();
      }
      return { label: entry.label, amountCents: Number.isNaN(amount) ? 0 : amount };
    });
    const exclusionPrices: { exclusionId: string; priceCents: number }[] = [];
    bid.exclusions.forEach((exclusion, index) => {
      const text = draft.prices[exclusion.id] ?? '';
      if (text.trim() === '') return;
      const amount = parseAmount(text);
      if (Number.isNaN(amount)) {
        found[`exclusionPrices[${index}].priceCents`] = fieldErrorCopy.badAmount();
        return;
      }
      exclusionPrices.push({ exclusionId: exclusion.id, priceCents: amount });
    });
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }

    setBusy(true);
    errors.clear();
    startPending(pending.saveLevelling);
    try {
      await request(`/api/bids/${bid.id}/levelling`, {
        method: 'PATCH',
        body: { allowances, exclusionPrices },
      });
      setDialog(null);
      refresh();
      levelling.reload();
      say(success.levellingSaved(bid.reference));
      focusWhenReady(`[data-level="${bid.reference}"]`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, {
          draft: { formKey: 'levelling', values: { ...draft } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const award = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.award);
    try {
      const result = await request<{ contract: { companyName: string } }>(
        `/api/tenders/${tenderId}/award`,
        { body: { bidId: awardBidId, ...(awardReason === '' ? {} : { reason: awardReason }) } },
      );
      setDialog(null);
      refresh();
      levelling.reload();
      tender.reload();
      say(success.awarded(result.contract.companyName));
      focusWhenReady('[data-tender-status]');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'unpriced_exclusions') {
        problem(refusal.unpricedExclusions(caught.extra<number>('count') ?? 0));
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught);
        focusFirstDialogButton();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      sheetCode="PL-03"
      revision="T-000"
      name="Tenders"
      heading={<h1>{`Levelling · ${tender.data?.tender.title ?? ''}`}</h1>}
    >
      <h2 data-tender-status tabIndex={-1}>
        Tender status
      </h2>
      <p className="stage-state">{tender.data?.tender.status ?? ''}</p>

      {levelling.error ? (
        <p>{refusal.otherIllegal('not opened yet')}</p>
      ) : (
        <>
          <div className="inline">
            <div className="field">
              <label className="field-label" htmlFor={`${formId}-find`}>
                Find bidder
              </label>
              <input
                id={`${formId}-find`}
                type="search"
                value={search}
                onChange={(event) => setView({ q: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${formId}-unpriced`}>
                Unpriced exclusions
              </label>
              <select
                id={`${formId}-unpriced`}
                value={unpriced === 'only' ? 'only' : unpriced === 'hide' ? 'hide' : 'all'}
                onChange={(event) =>
                  setView({ unpriced: event.target.value === 'all' ? null : event.target.value })
                }
              >
                <option value="all">Show all</option>
                <option value="only">Only unpriced</option>
                <option value="hide">Hide unpriced</option>
              </select>
            </div>
            <a href={`/api/tenders/${tenderId}/levelling.csv`}>Export levelling CSV</a>
            <button
              type="button"
              onClick={() => {
                errors.clear();
                setAwardBidId(all.find((bid) => bid.rank === 1)?.id ?? '');
                setAwardReason('');
                setDialog({ kind: 'award' });
              }}
            >
              Award
            </button>
          </div>

          <TableRegion label="Levelling table" className="levelling-region">
            <table>
              <caption>Levelling</caption>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      scope="col"
                      className={column.numeric ? 'numeric' : undefined}
                      {...(column.key !== null && column.key === sort
                        ? { 'aria-sort': direction === 'asc' ? ('ascending' as const) : ('descending' as const) }
                        : {})}
                    >
                      {column.key === null ? (
                        column.label
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setView({
                              sort: column.key,
                              dir:
                                column.key === sort && direction === 'asc' ? 'desc' : 'asc',
                            })
                          }
                        >
                          {column.label}
                        </button>
                      )}
                    </th>
                  ))}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bid) => (
                  <tr key={bid.id}>
                    <td>{bid.rank}</td>
                    <th scope="row">{`${bid.reference} ${bid.companyName}`}</th>
                    <td className="numeric">{formatAmount(bid.baseCents, currency)}</td>
                    <td className="numeric">
                      {formatAmount(bid.provisionalSumsCents, currency)}
                    </td>
                    <td className="numeric">{formatAmount(bid.allowancesCents, currency)}</td>
                    <td className="numeric">
                      {`${formatAmount(bid.pricedExclusionsCents, currency)}${
                        bid.unpricedExclusions > 0
                          ? ` · ${bid.unpricedExclusions} unpriced`
                          : ''
                      }`}
                    </td>
                    <td className="numeric">{formatAmount(bid.contingencyCents, currency)}</td>
                    <td className="numeric">
                      {formatAmount(bid.levelledTotalCents, currency)}
                    </td>
                    <td>{formatInstant(new Date(bid.finalSubmittedAt), zone)}</td>
                    <td>
                      <button
                        type="button"
                        data-level={bid.reference}
                        onClick={() => openLevel(bid)}
                      >
                        {`Level ${bid.reference}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        </>
      )}

      {dialog?.kind === 'level' ? (
        <Dialog
          title={`Level ${dialog.bid.reference}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.saveLevelling}
                onPress={() => void saveLevelling(dialog.bid)}
              >
                Save levelling
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          {draft.allowances.map((entry, index) => (
            <fieldset key={index}>
              <legend>{`Allowance ${index + 1}`}</legend>
              <Field
                formId={formId}
                path={`allowances[${index}].label`}
                label="Allowance label"
                errors={errors.errors}
              >
                {(attributes) => (
                  <input
                    {...attributes}
                    type="text"
                    value={entry.label}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        allowances: draft.allowances.map((item, at) =>
                          at === index ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <Field
                formId={formId}
                path={`allowances[${index}].amountCents`}
                label="Allowance amount"
                errors={errors.errors}
              >
                {(attributes) => (
                  <input
                    {...attributes}
                    type="text"
                    inputMode="decimal"
                    value={entry.amount}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        allowances: draft.allowances.map((item, at) =>
                          at === index ? { ...item, amount: event.target.value } : item,
                        ),
                      })
                    }
                  />
                )}
              </Field>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              setDraft({ ...draft, allowances: [...draft.allowances, { label: '', amount: '' }] })
            }
          >
            Add allowance
          </button>

          {dialog.bid.exclusions.map((exclusion, index) => (
            <Field
              key={exclusion.id}
              formId={formId}
              path={`exclusionPrices[${index}].priceCents`}
              label={`Price for ${exclusion.label}`}
              errors={errors.errors}
            >
              {(attributes) => (
                <input
                  {...attributes}
                  type="text"
                  inputMode="decimal"
                  value={draft.prices[exclusion.id] ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      prices: { ...draft.prices, [exclusion.id]: event.target.value },
                    })
                  }
                />
              )}
            </Field>
          ))}
        </Dialog>
      ) : null}

      {dialog?.kind === 'award' ? (
        <Dialog
          title="Award tender"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.award}
                onPress={() => void award()}
              >
                Confirm award
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <div role="radiogroup" aria-label="Awarded bidder">
            {all.map((bid) => (
              <div className="radio-row" key={bid.id}>
                <input
                  type="radio"
                  id={`${formId}-award-${bid.id}`}
                  name={`${formId}-award`}
                  checked={awardBidId === bid.id}
                  onChange={() => setAwardBidId(bid.id)}
                />
                <label htmlFor={`${formId}-award-${bid.id}`}>
                  {`${bid.reference} ${bid.companyName}`}
                </label>
              </div>
            ))}
          </div>
          <Field
            formId={formId}
            path="reason"
            label="Reason for not awarding the lowest"
            errors={errors.errors}
          >
            {(attributes) => (
              <textarea
                {...attributes}
                rows={3}
                value={awardReason}
                onChange={(event) => setAwardReason(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Panel>
  );
}
