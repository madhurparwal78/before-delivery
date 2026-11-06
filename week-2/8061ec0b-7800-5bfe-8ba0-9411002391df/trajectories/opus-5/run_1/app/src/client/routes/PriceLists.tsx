import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMoney, formatTaxPercent } from '../../shared/money';
import { instrumentName } from '../../shared/labels';
import { formatStoreDate, storeDateOf } from '../../shared/time';
import { INSTRUMENT_TYPES, type PriceList } from '../../shared/types';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { Dialog } from '../components/Dialog';
import { StatusLine } from '../components/StatusLine';

interface TierDraft {
  name: string;
  from_month: string;
  to_month: string;
  percent: string;
}

interface ItemDraft {
  base_rent: string;
  waiver: string;
  purchase_price: string;
}

/** Dollars typed as text to whole cents, with no floating-point arithmetic. */
function toCents(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function toWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function standing(list: PriceList, lists: PriceList[], today: string): string {
  if (list.withdrawn_at !== null) return 'Withdrawn';
  const inForce = lists
    .filter((entry) => entry.withdrawn_at === null && entry.effective_date <= today)
    .sort((a, b) =>
      a.effective_date === b.effective_date
        ? b.created_at.localeCompare(a.created_at)
        : b.effective_date.localeCompare(a.effective_date),
    )[0];
  if (inForce?.id === list.id) return 'In force';
  if (list.effective_date > today) return 'Scheduled';
  return 'Superseded';
}

export function PriceLists(): ReactNode {
  const [lists, setLists] = useState<PriceList[]>([]);
  const [today, setToday] = useState('');
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [withdrawing, setWithdrawing] = useState<PriceList | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [items, setItems] = useState<Record<string, ItemDraft>>({});
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const withdrawButton = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    const schools = await api<{ server_now: string }>('/schools');
    setToday(storeDateOf(new Date(schools.server_now)));
    const answer = await api<{ price_lists: PriceList[] }>('/price-lists');
    setLists(answer.price_lists);
    const current = await api<{ price_list: PriceList }>('/price-lists/current');
    return current.price_list;
  }, []);

  useEffect(() => {
    void (async () => {
      const current = await load();
      const nextItems: Record<string, ItemDraft> = {};
      for (const item of current.items) {
        nextItems[item.instrument_type] = {
          base_rent: (item.base_rent_cents / 100).toFixed(2),
          waiver: (item.waiver_cents / 100).toFixed(2),
          purchase_price: (item.purchase_price_cents / 100).toFixed(2),
        };
      }
      setItems(nextItems);
      setTiers(
        current.tiers.map((tier) => ({
          name: tier.name,
          from_month: String(tier.from_month),
          to_month: tier.to_month === null ? '' : String(tier.to_month),
          percent: String(tier.percent),
        })),
      );
    })();
  }, [load]);

  const fieldOrder = [
    'effective_date',
    'tax_rate_bp',
    ...INSTRUMENT_TYPES.flatMap((type) => [
      `items.${type}.base_rent_cents`,
      `items.${type}.waiver_cents`,
      `items.${type}.purchase_price_cents`,
    ]),
    ...tiers.flatMap((_, index) => [
      `tiers.${index}.name`,
      `tiers.${index}.from_month`,
      `tiers.${index}.to_month`,
      `tiers.${index}.percent`,
    ]),
  ];

  const fieldIdFor = (key: string): string => {
    if (key === 'items') return 'pl-items.flute.base_rent_cents';
    if (key === 'tiers') return 'pl-tiers.0.name';
    return `pl-${key}`;
  };

  const applyErrors = (fields: Record<string, string> | undefined): void => {
    setErrors(fields ?? {});
    const keys = Object.keys(fields ?? {});
    const first =
      fieldOrder.find((key) => keys.includes(key)) ??
      (keys.includes('items') ? 'items' : keys.includes('tiers') ? 'tiers' : keys[0]);
    if (first === undefined) return;
    requestAnimationFrame(() => document.getElementById(fieldIdFor(first))?.focus());
  };

  const errorFor = (key: string): string | undefined => {
    if (errors[key] !== undefined) return errors[key];
    if (key === 'items.flute.base_rent_cents' && errors.items !== undefined) return errors.items;
    if (key === 'tiers.0.name' && errors.tiers !== undefined) return errors.tiers;
    return undefined;
  };

  const publish = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setStatus(PENDING.publish);
    setStatusError(false);
    setErrors({});
    const body = {
      effective_date: effectiveDate.trim(),
      tax_rate_bp: toCents(taxRate),
      items: INSTRUMENT_TYPES.map((type) => ({
        instrument_type: type,
        base_rent_cents: toCents(items[type]?.base_rent ?? ''),
        waiver_cents: toCents(items[type]?.waiver ?? ''),
        purchase_price_cents: toCents(items[type]?.purchase_price ?? ''),
      })),
      tiers: tiers.map((tier) => ({
        name: tier.name,
        from_month: toWholeNumber(tier.from_month),
        to_month: tier.to_month.trim() === '' ? null : toWholeNumber(tier.to_month),
        percent: toWholeNumber(tier.percent),
      })),
    };
    try {
      const answer = await api<{ price_list: PriceList }>('/price-lists', { method: 'POST', body });
      setStatus(
        `Price list ${answer.price_list.id} takes effect ${formatStoreDate(
          answer.price_list.effective_date,
        )}. Contracts signed before then keep their terms.`,
      );
      await load();
    } catch (error) {
      setStatusError(true);
      if (error instanceof ApiFailure && error.status === 422) {
        applyErrors(error.fields);
        setStatus('Check the highlighted fields.');
      } else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
      } else if (error instanceof ApiFailure) {
        setStatus(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (list: PriceList): Promise<void> => {
    setBusy(true);
    setStatus(PENDING.withdraw);
    setStatusError(false);
    try {
      await api(`/price-lists/${list.id}/withdraw`, { method: 'POST', body: {} });
      setWithdrawing(null);
      setStatus(`Price list ${list.id} withdrawn before it took effect.`);
      await load();
      statusRef.current?.focus();
    } catch (error) {
      setStatusError(true);
      setWithdrawing(null);
      if (error instanceof ApiFailure && error.code === 'price_list_in_force') {
        setStatus(`${list.id} is already in force and can't be withdrawn.`);
      } else if (error instanceof ApiFailure && error.code === 'price_list_withdrawn') {
        setStatus(`${list.id} was already withdrawn.`);
      } else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
      } else if (error instanceof ApiFailure) {
        setStatus(error.message);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1>Price lists</h1>
      <StatusLine name="Price list status" text={status} error={statusError} ref={statusRef} />

      <table>
        <caption>Price lists</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Effective date</th>
            <th scope="col">Tax rate</th>
            <th scope="col">Status</th>
            {INSTRUMENT_TYPES.map((type) => (
              <th scope="col" key={type}>
                {instrumentName(type)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => {
            const word = standing(list, lists, today);
            return (
              <tr key={list.id}>
                <td className="mono">{list.id}</td>
                <td className="figure">{formatStoreDate(list.effective_date)}</td>
                <td className="figure">{formatTaxPercent(list.tax_rate_bp)}</td>
                <td>
                  {word}
                  {word === 'Scheduled' ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="danger"
                        onClick={(event) => {
                          withdrawButton.current = event.currentTarget;
                          setWithdrawing(list);
                        }}
                      >
                        {`Withdraw ${list.id}`}
                      </button>
                    </>
                  ) : null}
                </td>
                {INSTRUMENT_TYPES.map((type) => (
                  <td className="figure" key={type}>
                    {formatMoney(
                      list.items.find((item) => item.instrument_type === type)?.base_rent_cents ?? 0,
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <form aria-label="New price list" onSubmit={(event) => void publish(event)}>
        <h2>New price list</h2>
        <div className="field">
          <label htmlFor="pl-effective_date">Effective date</label>
          <input
            id="pl-effective_date"
            type="text"
            placeholder="YYYY-MM-DD"
            value={effectiveDate}
            aria-invalid={errorFor('effective_date') === undefined ? undefined : 'true'}
            aria-describedby={errorFor('effective_date') === undefined ? undefined : 'pl-error-effective_date'}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
          {errorFor('effective_date') === undefined ? null : (
            <span className="field-error" id="pl-error-effective_date">
              {errorFor('effective_date')}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="pl-tax_rate_bp">Sales tax rate</label>
          <input
            id="pl-tax_rate_bp"
            type="text"
            value={taxRate}
            aria-invalid={errorFor('tax_rate_bp') === undefined ? undefined : 'true'}
            aria-describedby={errorFor('tax_rate_bp') === undefined ? undefined : 'pl-error-tax_rate_bp'}
            onChange={(event) => setTaxRate(event.target.value)}
          />
          {errorFor('tax_rate_bp') === undefined ? null : (
            <span className="field-error" id="pl-error-tax_rate_bp">
              {errorFor('tax_rate_bp')}
            </span>
          )}
        </div>

        {INSTRUMENT_TYPES.map((type) => (
          <fieldset key={type}>
            <legend>{instrumentName(type)}</legend>
            {(
              [
                ['base_rent_cents', 'monthly rent', 'base_rent'],
                ['waiver_cents', 'waiver', 'waiver'],
                ['purchase_price_cents', 'purchase price', 'purchase_price'],
              ] as const
            ).map(([key, labelSuffix, draftKey]) => {
              const fieldKey = `items.${type}.${key}`;
              const message = errorFor(fieldKey);
              return (
                <div className="field" key={key}>
                  <label htmlFor={`pl-${fieldKey}`}>{`${instrumentName(type)} ${labelSuffix}`}</label>
                  <input
                    id={`pl-${fieldKey}`}
                    type="text"
                    value={items[type]?.[draftKey] ?? ''}
                    aria-invalid={message === undefined ? undefined : 'true'}
                    aria-describedby={message === undefined ? undefined : `pl-error-${fieldKey}`}
                    onChange={(event) =>
                      setItems((current) => ({
                        ...current,
                        [type]: {
                          base_rent: current[type]?.base_rent ?? '',
                          waiver: current[type]?.waiver ?? '',
                          purchase_price: current[type]?.purchase_price ?? '',
                          [draftKey]: event.target.value,
                        },
                      }))
                    }
                  />
                  {message === undefined ? null : (
                    <span className="field-error" id={`pl-error-${fieldKey}`}>
                      {message}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}

        {tiers.map((tier, index) => (
          <fieldset key={index}>
            <legend>{`Tier ${index + 1}`}</legend>
            {(
              [
                ['name', 'name'],
                ['from_month', 'from month'],
                ['to_month', 'to month'],
                ['percent', 'percent'],
              ] as const
            ).map(([key, labelSuffix]) => {
              const fieldKey = `tiers.${index}.${key}`;
              const message = errorFor(fieldKey);
              return (
                <div className="field" key={key}>
                  <label htmlFor={`pl-${fieldKey}`}>{`Tier ${index + 1} ${labelSuffix}`}</label>
                  <input
                    id={`pl-${fieldKey}`}
                    type="text"
                    value={tier[key]}
                    aria-invalid={message === undefined ? undefined : 'true'}
                    aria-describedby={message === undefined ? undefined : `pl-error-${fieldKey}`}
                    onChange={(event) =>
                      setTiers((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, [key]: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  {message === undefined ? null : (
                    <span className="field-error" id={`pl-error-${fieldKey}`}>
                      {message}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}

        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => setTiers((current) => [...current, { name: '', from_month: '', to_month: '', percent: '' }])}
          >
            Add tier
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Publish price list
          </button>
        </div>
      </form>

      <Dialog
        name="Confirm withdrawal"
        open={withdrawing !== null}
        onCancel={() => {
          setWithdrawing(null);
          withdrawButton.current?.focus();
        }}
      >
        <h2>Confirm withdrawal</h2>
        <p>
          {withdrawing === null
            ? ''
            : `Withdraw ${withdrawing.id} before it takes effect on ${formatStoreDate(
                withdrawing.effective_date,
              )}? Contracts and reservations keep the terms in force without it.`}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (withdrawing !== null) void withdraw(withdrawing);
            }}
          >
            Withdraw price list
          </button>
          <button
            type="button"
            onClick={() => {
              setWithdrawing(null);
              withdrawButton.current?.focus();
            }}
          >
            Cancel
          </button>
        </div>
      </Dialog>
    </main>
  );
}
