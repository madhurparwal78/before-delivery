import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DeskReservation, Inventory } from '../shared/api.js';
import { DESK_BILLING_BANNER, deskUpdates, missingWords } from '../shared/copy.js';
import { formatDollars } from '../shared/money.js';
import { ApiFailure, api, idempotencyKey } from './api.js';
import { LiveRegion } from './ui.js';

interface DeskResponse {
  billing: 'ok' | 'unavailable';
  reservations: DeskReservation[];
}

export function SeatsRegion({ inventory }: { readonly inventory: Inventory | null }): ReactNode {
  return (
    <section aria-label="Seats" className="seats-region">
      <p>
        Sold <span className="num">{inventory?.sold ?? 0}</span>
      </p>
      <p>
        Held <span className="num">{inventory?.held ?? 0}</span>
      </p>
      <p>
        Waitlisted{' '}
        <span className="num">
          {(inventory?.waitlisted.bench ?? 0) + (inventory?.waitlisted.atelier ?? 0)}
        </span>
      </p>
    </section>
  );
}

export function useInventory(): Inventory | null {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  useEffect(() => {
    const load = (): void => {
      void api<Inventory>('/api/desk/inventory').then(setInventory).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 1_500);
    return () => window.clearInterval(timer);
  }, []);
  return inventory;
}

export function DeskPage(): ReactNode {
  const [query, setQuery] = useState('');
  const [desk, setDesk] = useState<DeskResponse | null>(null);
  const [message, setMessage] = useState('');
  const inventory = useInventory();
  const latest = useRef('');
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async (text: string) => {
    latest.current = text;
    const result = await api<DeskResponse>(`/api/desk/reservations?q=${encodeURIComponent(text)}`);
    if (latest.current !== text) return;
    setDesk(result);
  }, []);

  useEffect(() => {
    void load('').catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query).catch(() => undefined), 150);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const act = useCallback(
    async (work: () => Promise<string>) => {
      try {
        setMessage(await work());
      } catch (error) {
        if (error instanceof ApiFailure) setMessage(error.body.message);
        else setMessage('Something went wrong.');
      }
      await load(latest.current).catch(() => undefined);
    },
    [load],
  );

  const unavailable = desk?.billing === 'unavailable';

  return (
    <main className="staff desk">
      <h1>Registrar desk</h1>
      <p>
        <a href="/">Back to the programme</a>
      </p>
      {unavailable ? (
        <p role="alert" className="banner">
          {DESK_BILLING_BANNER}
        </p>
      ) : null}
      <SeatsRegion inventory={inventory} />
      <p className="field">
        <label htmlFor="desk-search">Find a reservation</label>
        <input
          id="desk-search"
          ref={search}
          type="search"
          role="searchbox"
          aria-label="Find a reservation"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </p>
      <table className="desk-table">
        <caption className="visually-hidden">Reservations</caption>
        <thead>
          <tr>
            <th scope="col">Bench</th>
            <th scope="col">Attendee</th>
            <th scope="col">Buyer</th>
            <th scope="col">Tier</th>
            <th scope="col">State</th>
            <th scope="col">Paid in Kill Bill</th>
            <th scope="col">Refunded in Kill Bill</th>
            <th scope="col">Refund due</th>
            <th scope="col">Licence</th>
          </tr>
        </thead>
        <tbody>
          {(desk?.reservations ?? []).map((seat) => (
            <tr key={seat.id}>
              <th scope="row" className="num">
                {seat.bench}
              </th>
              <td>{seat.attendee?.name ?? '—'}</td>
              <td>{seat.buyer.name}</td>
              <td>{seat.tier === 'atelier' ? 'Atelier' : 'Bench'}</td>
              <td>{seat.state}</td>
              <td className="num">
                {seat.kb === null ? 'Unavailable' : `$${formatDollars(seat.kb.paid_cents)}`}
              </td>
              <td className="num">
                {seat.kb === null ? 'Unavailable' : `$${formatDollars(seat.kb.refunded_cents)}`}
              </td>
              <td className="num">
                {seat.refund_due_cents === null ? '—' : `$${formatDollars(seat.refund_due_cents)}`}
              </td>
              <td className="licence-cell">
                <span className="licence-status">{seat.licence_status}</span>
                <span className="row-actions">
                {seat.state === 'cancelled' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void act(async () => {
                        try {
                          const result = await api<{
                            refund: { amount_cents: number };
                          }>(`/api/desk/reservations/${seat.id}/refund`, {
                            body: {},
                            idempotencyKey: idempotencyKey('refund'),
                          });
                          return deskUpdates.refundSent(result.refund.amount_cents, seat.bench);
                        } catch (error) {
                          if (error instanceof ApiFailure && error.code === 'billing_unavailable') {
                            return deskUpdates.refundBlocked;
                          }
                          throw error;
                        }
                      })
                    }
                  >
                    Issue refund ${formatDollars(seat.refund_due_cents ?? 0)}
                  </button>
                ) : null}
                {seat.licence_status === 'none' ? null : (
                  <button
                    type="button"
                    onClick={() =>
                      void act(async () => {
                        const result = await api<{ url: string }>(
                          `/api/reservations/${seat.id}/licence`,
                        );
                        window.open(result.url, '_blank', 'noopener');
                        return `Licence opened for ${seat.attendee?.name ?? seat.bench}.`;
                      })
                    }
                  >
                    Open licence
                  </button>
                )}
                {seat.licence_status === 'submitted' || seat.licence_status === 'rejected' ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void act(async () => {
                          await api(`/api/desk/reservations/${seat.id}/licence-review`, {
                            body: { decision: 'matched' },
                          });
                          return deskUpdates.licenceMatched(seat.attendee?.name ?? seat.bench);
                        })
                      }
                    >
                      Mark licence matched
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void act(async () => {
                          await api(`/api/desk/reservations/${seat.id}/licence-review`, {
                            body: { decision: 'rejected' },
                          });
                          return deskUpdates.licenceRejected(seat.attendee?.name ?? seat.bench);
                        })
                      }
                    >
                      Reject licence
                    </button>
                  </>
                ) : null}
                {seat.passport_status === 'submitted' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void act(async () => {
                        try {
                          await api(`/api/desk/reservations/${seat.id}/visa-letter`, { body: {} });
                          return deskUpdates.visaIssued(seat.attendee?.name ?? seat.bench);
                        } catch (error) {
                          if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
                            return deskUpdates.visaBlocked;
                          }
                          throw error;
                        }
                      })
                    }
                  >
                    Issue visa letter
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    void act(async () => {
                      try {
                        await api(`/api/desk/reservations/${seat.id}/certificate`, { body: {} });
                        return deskUpdates.certificateIssued(seat.attendee?.name ?? seat.bench);
                      } catch (error) {
                        if (error instanceof ApiFailure) {
                          if (error.code === 'storage_unavailable') {
                            return deskUpdates.certificateBlocked;
                          }
                          if (error.code === 'certificate_not_eligible') {
                            return deskUpdates.certificateNotReady(
                              missingWords(error.body.missing ?? []),
                            );
                          }
                        }
                        throw error;
                      }
                    })
                  }
                >
                  Issue certificate
                </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LiveRegion name="Desk updates" message={message} />
    </main>
  );
}
