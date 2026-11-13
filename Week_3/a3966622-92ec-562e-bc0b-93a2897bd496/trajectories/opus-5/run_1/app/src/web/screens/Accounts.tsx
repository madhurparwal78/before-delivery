import { useEffect, useState } from 'react';
import { NoReply, send } from '../api.ts';
import { INVOICE_PENDING, NO_REPLY, money } from '../format.ts';
import { useInterval, useKeyedControl } from '../hooks.ts';
import { FormErrors } from '../parts/FormErrors.tsx';
import type { Invoice, Move, TariffRevision } from '../types.ts';

type BandForm = { from: string; to: string; amount: string };

type RevisionForm = {
  label: string;
  date: string;
  time: string;
  draftFoot: string;
  minimum: string;
  detention: string;
  cancellation: string;
  nightPercent: string;
  allowance: string;
  bands: BandForm[];
};

const EMPTY_FORM: RevisionForm = {
  label: '',
  date: '',
  time: '',
  draftFoot: '0.00',
  minimum: '0.00',
  detention: '0.00',
  cancellation: '0.00',
  nightPercent: '0',
  allowance: '0',
  bands: [{ from: '0', to: '', amount: '0.00' }],
};

function centsOf(text: string): number {
  return Math.round(Number(text) * 100);
}

export function AccountsScreen(): JSX.Element {
  const [revisions, setRevisions] = useState<TariffRevision[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [form, setForm] = useState<RevisionForm>(EMPTY_FORM);
  const [announcement, setAnnouncement] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const control = useKeyedControl();

  const load = async (): Promise<void> => {
    const [revisionsReply, movesReply, invoicesReply] = await Promise.all([
      send<{ revisions: TariffRevision[] }>('GET', '/api/tariff-revisions').catch(() => null),
      send<{ moves: Move[] }>('GET', '/api/moves').catch(() => null),
      send<{ invoices: Invoice[] }>('GET', '/api/invoices').catch(() => null),
    ]);
    if (revisionsReply !== null && revisionsReply.ok) {
      const list = revisionsReply.data.revisions;
      setRevisions(list);
      const latest = list[list.length - 1];
      if (latest !== undefined) {
        setForm((current) =>
          current.label === ''
            ? {
                label: '',
                date: '',
                time: '',
                draftFoot: (latest.draft_foot_cents / 100).toFixed(2),
                minimum: (latest.minimum_cents / 100).toFixed(2),
                detention: (latest.detention_half_hour_cents / 100).toFixed(2),
                cancellation: (latest.cancellation_cents / 100).toFixed(2),
                nightPercent: String(latest.night_percent),
                allowance: String(latest.detention_allowance_half_hours),
                bands: latest.tonnage_bands.map((band) => ({
                  from: String(band.from_gt),
                  to: band.to_gt === null ? '' : String(band.to_gt),
                  amount: (band.cents / 100).toFixed(2),
                })),
              }
            : current,
        );
      }
    }
    if (movesReply !== null && movesReply.ok) setMoves(movesReply.data.moves);
    if (invoicesReply !== null && invoicesReply.ok) setInvoices(invoicesReply.data.invoices);
  };

  useEffect(() => {
    void load();
  }, []);

  useInterval(() => {
    void load();
  }, 30_000);

  const publish = (): void => {
    setAnnouncement('Publishing revision...');
    void (async () => {
      try {
        const reply = await send<TariffRevision>('POST', '/api/tariff-revisions', {
          body: {
            label: form.label,
            effective_at: `${form.date}T${form.time}`,
            draft_foot_cents: centsOf(form.draftFoot),
            minimum_cents: centsOf(form.minimum),
            detention_half_hour_cents: centsOf(form.detention),
            cancellation_cents: centsOf(form.cancellation),
            night_percent: Number(form.nightPercent),
            detention_allowance_half_hours: Number(form.allowance),
            tonnage_bands: form.bands.map((band) => ({
              from_gt: Number(band.from),
              to_gt: band.to === '' ? null : Number(band.to),
              cents: centsOf(band.amount),
            })),
          },
        });
        if (reply.ok) {
          setErrors({});
          setAnnouncement(
            `Revision ${reply.data.label} published, effective ${reply.data.effective_at.replace('T', ' ')} port time`,
          );
          await load();
          return;
        }
        const fields = reply.error.errors ?? { revision: reply.error.message };
        setErrors(fields);
        setAnnouncement(`${Object.keys(fields).length} fields need attention`);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      }
    })();
  };

  const issue = (invoice: Invoice): void => {
    if (control.pending) return;
    const key = control.keyFor(JSON.stringify([invoice.id]));
    control.setPending(true);
    setAnnouncement('Issuing invoice...');
    void (async () => {
      try {
        const reply = await send<Invoice>(
          'POST',
          `/api/invoices/${encodeURIComponent(invoice.id)}/issue`,
          { body: {}, key },
        );
        control.replyReceived();
        if (reply.ok && reply.status === 200 && reply.data.state === 'issued') {
          setAnnouncement(`Invoice ${reply.data.number ?? ''} issued`);
        } else {
          setAnnouncement(INVOICE_PENDING);
        }
        await load();
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  return (
    <div className="columns">
      <section className="pane" aria-label="Tariff revisions">
        <h2>Tariff revisions</h2>
        <div className="rows">
          {revisions.map((revision) => (
            <div key={revision.id} className="row">
              <span className="mono">{revision.label}</span>
              <span className="mono">{`${revision.effective_at.replace('T', ' ')} port time`}</span>
              <span className="dim">{`Priced ${revision.moves.join(', ') || 'no moves'}`}</span>
            </div>
          ))}
        </div>
        <h3>Publish revision</h3>
        <div className="form-grid">
          <label>
            Revision label
            <input
              id="revision-label"
              aria-label="Revision label"
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
          </label>
          <label>
            Effective date
            <input
              id="revision-effective_at"
              aria-label="Effective date"
              value={form.date}
              placeholder="YYYY-MM-DD"
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </label>
          <label>
            Effective time
            <input
              aria-label="Effective time"
              value={form.time}
              placeholder="HH:MM"
              onChange={(event) => setForm({ ...form, time: event.target.value })}
            />
          </label>
          <label>
            Rate per draft foot
            <input
              id="revision-draft_foot_cents"
              type="number"
              step="0.01"
              aria-label="Rate per draft foot"
              value={form.draftFoot}
              onChange={(event) => setForm({ ...form, draftFoot: event.target.value })}
            />
          </label>
          <label>
            Minimum charge
            <input
              id="revision-minimum_cents"
              type="number"
              step="0.01"
              aria-label="Minimum charge"
              value={form.minimum}
              onChange={(event) => setForm({ ...form, minimum: event.target.value })}
            />
          </label>
          <label>
            Detention per half hour
            <input
              type="number"
              step="0.01"
              aria-label="Detention per half hour"
              value={form.detention}
              onChange={(event) => setForm({ ...form, detention: event.target.value })}
            />
          </label>
          <label>
            Cancellation charge
            <input
              type="number"
              step="0.01"
              aria-label="Cancellation charge"
              value={form.cancellation}
              onChange={(event) => setForm({ ...form, cancellation: event.target.value })}
            />
          </label>
          <label>
            Night surcharge percent
            <input
              id="revision-night_percent"
              type="number"
              step="1"
              aria-label="Night surcharge percent"
              value={form.nightPercent}
              onChange={(event) => setForm({ ...form, nightPercent: event.target.value })}
            />
          </label>
          <label>
            Detention allowance half hours
            <input
              type="number"
              step="1"
              aria-label="Detention allowance half hours"
              value={form.allowance}
              onChange={(event) => setForm({ ...form, allowance: event.target.value })}
            />
          </label>
          {form.bands.map((band, index) => (
            <fieldset key={index}>
              <legend>{`Tonnage band ${index + 1}`}</legend>
              <label>
                {`Tonnage band ${index + 1} from GT`}
                <input
                  type="number"
                  step="1"
                  aria-label={`Tonnage band ${index + 1} from GT`}
                  value={band.from}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bands: form.bands.map((entry, position) =>
                        position === index ? { ...entry, from: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {`Tonnage band ${index + 1} to GT`}
                <input
                  type="number"
                  step="1"
                  aria-label={`Tonnage band ${index + 1} to GT`}
                  value={band.to}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bands: form.bands.map((entry, position) =>
                        position === index ? { ...entry, to: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {`Tonnage band ${index + 1} amount`}
                <input
                  type="number"
                  step="0.01"
                  aria-label={`Tonnage band ${index + 1} amount`}
                  value={band.amount}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bands: form.bands.map((entry, position) =>
                        position === index ? { ...entry, amount: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    bands: form.bands.filter((_, position) => position !== index),
                  })
                }
              >
                {`Remove tonnage band ${index + 1}`}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              setForm({ ...form, bands: [...form.bands, { from: '0', to: '', amount: '0.00' }] })
            }
          >
            Add tonnage band
          </button>
          <button type="button" className="primary" onClick={publish}>
            Publish revision
          </button>
        </div>
        <FormErrors errors={errors} prefix="revision" />
      </section>
      <section className="pane" aria-label="Moves and invoices">
        <h2>Moves with charges</h2>
        <div className="rows">
          {moves.map((move) => (
            <div key={move.ref} className="row">
              <span className="ref">{move.ref}</span>
              <span>{move.vessel.name}</span>
              <span>{move.detained ? 'On board - detained' : move.status}</span>
              <span className="dim">{`Priced by ${move.priced_by ?? ''}`}</span>
              <span className="mono">{money(move.total_cents ?? 0)}</span>
              <a href={`/moves/${move.ref}`}>{`Open ${move.ref}`}</a>
            </div>
          ))}
        </div>
        <p>
          <a href="/api/exports/moves.csv">Export moves</a>
        </p>
        <h2>Invoices</h2>
        <div className="rows">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="row">
              <span className="ref">{invoice.id}</span>
              <span>{invoice.move_ref}</span>
              <span>{invoice.state === 'issued' ? 'issued' : INVOICE_PENDING}</span>
              <span className="mono">{invoice.number ?? '-'}</span>
              <span className="mono">
                {invoice.balance_cents === null ? '-' : money(invoice.balance_cents)}
              </span>
              <span className="mono">{money(invoice.total_cents)}</span>
              <a href={`/invoices/${invoice.id}`}>{`Open invoice ${invoice.id}`}</a>
              {invoice.state === 'pending' && (
                <button type="button" onClick={() => issue(invoice)}>
                  {`Issue invoice ${invoice.id}`}
                </button>
              )}
            </div>
          ))}
        </div>
        <div role="status" aria-label="Billing announcements" className="announce">
          {announcement}
        </div>
      </section>
    </div>
  );
}
