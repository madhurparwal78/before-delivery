import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { RateCard } from '../../shared/types';
import { formatAmount } from '../../shared/format';
import { ApiFailure, api } from '../api';
import type { Session } from '../app';
import { DataTable, type Column } from '../ui/DataTable';

function dollarsToCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function RatesScreen({ session }: { session: Session }): ReactNode {
  const { kitchen } = session;
  const [cards, setCards] = useState<RateCard[]>([]);
  const [cutoff, setCutoff] = useState(kitchen.same_day_cutoff);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [effectiveFrom, setEffectiveFrom] = useState(kitchen.today);
  const [tiers, setTiers] = useState(['', '', '', '']);
  const [surcharges, setSurcharges] = useState<Record<string, string>>(() =>
    Object.fromEntries(kitchen.stations.map((station) => [station.id, ''])),
  );
  const [windowHours, setWindowHours] = useState('72');
  const [packPrice, setPackPrice] = useState('');

  const reload = useCallback(() => {
    void api
      .rateCards(kitchen.id)
      .then(({ rate_cards }) => setCards(rate_cards))
      .catch(() => undefined);
  }, [kitchen.id]);

  useEffect(reload, [reload]);

  const say = (message: string, error = false): void => {
    setStatus(message);
    setStatusError(error);
  };

  const saveCutoff = (): void => {
    setBusy(true);
    say('Saving…');
    void api
      .saveCutoff(kitchen.id, cutoff)
      .then(({ kitchen: updated }) => {
        say(`Same-day cutoff set to ${updated.same_day_cutoff}.`);
        session.reload();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) say('Enter a time on a quarter hour.', true);
      })
      .finally(() => setBusy(false));
  };

  const addCard = (event: React.FormEvent): void => {
    event.preventDefault();
    setFieldErrors({});
    const tierCents = tiers.map(dollarsToCents);
    const surchargeCents: Record<string, number> = {};
    let bad = false;
    for (const station of kitchen.stations) {
      const parsed = dollarsToCents(surcharges[station.id] ?? '');
      if (parsed === null) bad = true;
      else surchargeCents[station.id] = parsed;
    }
    const packCents = dollarsToCents(packPrice);
    const hours = Number(windowHours);
    if (tierCents.some((value) => value === null || value <= 0) || bad || packCents === null) {
      setFieldErrors({ amounts: 'Enter an amount in dollars and cents.' });
      say('Enter an amount in dollars and cents.', true);
      return;
    }
    if (!Number.isInteger(hours) || hours < 0 || hours > 336) {
      setFieldErrors({ window: 'Enter whole hours from 0 to 336.' });
      say('Enter whole hours from 0 to 336.', true);
      return;
    }

    setBusy(true);
    say('Saving rate card…');
    void api
      .addRateCard(kitchen.id, {
        effective_from: effectiveFrom,
        tier_rates_cents: tierCents as number[],
        station_surcharges_cents: surchargeCents,
        cancellation_window_hours: hours,
        pack_price_cents: packCents,
      })
      .then(({ rate_card }) => {
        say(`Rate card added. It applies from ${rate_card.effective_from}.`);
        reload();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.body.error === 'rate_card_exists') {
          say(`A rate card already starts on ${effectiveFrom}.`, true);
        } else if (failure instanceof ApiFailure && failure.body.errors) {
          if (failure.body.errors.effective_from) {
            setFieldErrors({ effective_from: 'Choose today or a later date.' });
            say('Choose today or a later date.', true);
          } else {
            setFieldErrors({ amounts: 'Enter an amount in dollars and cents.' });
            say('Enter an amount in dollars and cents.', true);
          }
        } else if (failure instanceof ApiFailure) {
          say(failure.message, true);
        }
      })
      .finally(() => setBusy(false));
  };

  const columns: Column<RateCard>[] = [
    { label: 'Effective from', render: (row) => <span className="num">{row.effective_from}</span> },
    ...[0, 1, 2, 3].map((index) => ({
      label: `Tier ${index + 1}`,
      num: true,
      render: (row: RateCard) => `$${formatAmount(row.tier_rates_cents[index])}`,
    })),
    {
      label: 'Cancellation window',
      num: true,
      render: (row) => `${row.cancellation_window_hours} h`,
    },
    { label: 'Pack price', num: true, render: (row) => `$${formatAmount(row.pack_price_cents)}` },
    {
      label: 'In force',
      render: (row) => (row.in_force ? <span className="pill lit">in force</span> : ''),
    },
  ];

  return (
    <div className="page">
      <header>
        <h1>Rates</h1>
        <p>Rate cards are added, never changed. Bookings keep the terms they were priced on.</p>
      </header>

      <p role="status" aria-label="Form status" className={`status-line${statusError ? ' error' : ''}`}>
        {status}
      </p>

      <section className="section">
        <h3>Same-day cutoff</h3>
        <div className="row-split">
          <div className="field" style={{ maxWidth: 200 }}>
            <label htmlFor="cutoff">Same-day cutoff</label>
            <input
              id="cutoff"
              type="time"
              step={900}
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
            />
          </div>
          <div>
            <button type="button" disabled={busy} onClick={saveCutoff}>
              Save cutoff
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>Rate cards</h3>
        <DataTable
          label="Rate cards"
          columns={columns}
          rows={cards}
          rowKey={(row) => row.id}
          empty="No rate cards yet."
        />
      </section>

      <section className="section">
        <h3>New rate card</h3>
        <form onSubmit={addCard} aria-label="New rate card" style={{ maxWidth: 520 }}>
          <div className="field">
            <label htmlFor="rc-from">Effective from</label>
            <input
              id="rc-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              aria-describedby={fieldErrors.effective_from ? 'rc-from-error' : undefined}
            />
            {fieldErrors.effective_from && (
              <p className="field-error" id="rc-from-error">
                {fieldErrors.effective_from}
              </p>
            )}
          </div>

          {[0, 1, 2, 3].map((index) => (
            <div className="field" key={index}>
              <label htmlFor={`rc-tier-${index}`}>Tier {index + 1} hourly rate</label>
              <input
                id={`rc-tier-${index}`}
                type="text"
                inputMode="decimal"
                placeholder="32.00"
                value={tiers[index]}
                onChange={(event) =>
                  setTiers((current) =>
                    current.map((value, position) => (position === index ? event.target.value : value)),
                  )
                }
              />
            </div>
          ))}

          {kitchen.stations.map((station) => (
            <div className="field" key={station.id}>
              <label htmlFor={`rc-sur-${station.id}`}>{station.name} surcharge</label>
              <input
                id={`rc-sur-${station.id}`}
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={surcharges[station.id] ?? ''}
                onChange={(event) =>
                  setSurcharges((current) => ({ ...current, [station.id]: event.target.value }))
                }
              />
            </div>
          ))}

          <div className="field">
            <label htmlFor="rc-window">Cancellation window (hours)</label>
            <input
              id="rc-window"
              type="number"
              min={0}
              max={336}
              value={windowHours}
              onChange={(event) => setWindowHours(event.target.value)}
              aria-describedby={fieldErrors.window ? 'rc-window-error' : undefined}
            />
            {fieldErrors.window && (
              <p className="field-error" id="rc-window-error">
                {fieldErrors.window}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="rc-pack">Pack price</label>
            <input
              id="rc-pack"
              type="text"
              inputMode="decimal"
              placeholder="560.00"
              value={packPrice}
              onChange={(event) => setPackPrice(event.target.value)}
              aria-describedby={fieldErrors.amounts ? 'rc-amounts-error' : undefined}
            />
            {fieldErrors.amounts && (
              <p className="field-error" id="rc-amounts-error">
                {fieldErrors.amounts}
              </p>
            )}
          </div>

          <button type="submit" className="primary" disabled={busy}>
            Add rate card
          </button>
        </form>
      </section>
    </div>
  );
}
