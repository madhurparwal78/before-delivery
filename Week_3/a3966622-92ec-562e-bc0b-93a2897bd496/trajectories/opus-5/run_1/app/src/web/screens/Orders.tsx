import { useEffect, useMemo, useRef, useState } from 'react';
import { draughtMmFromFeetInches, draughtMmFromMetres, feetInchesFromMm } from '../../domain/numerals.ts';
import { NoReply, send } from '../api.ts';
import { NO_REPLY, clearanceCell, marginFromMm, money } from '../format.ts';
import { useInterval, useKeyedControl } from '../hooks.ts';
import { useNavigation } from '../main.tsx';
import { FormErrors } from '../parts/FormErrors.tsx';
import type { Invoice, Move, Plan, SessionUser, Vessel } from '../types.ts';

const PLAN_DEBOUNCE_MS = 300;
const ANNOUNCE_REST_MS = 500;

type FormState = {
  vesselId: string;
  draughtMm: number;
  unit: 'metres' | 'feet';
  metresText: string;
  feetText: string;
  inchesText: string;
  speed: string;
  block: string;
  length: string;
  tonnage: string;
  duty: string;
  boardingDate: string;
  boardingTime: string;
};

const EMPTY: FormState = {
  vesselId: '',
  draughtMm: 0,
  unit: 'metres',
  metresText: '',
  feetText: '',
  inchesText: '',
  speed: '',
  block: '',
  length: '',
  tonnage: '',
  duty: '300',
  boardingDate: '',
  boardingTime: '',
};

function signatureOf(form: FormState): string {
  return JSON.stringify([
    form.vesselId,
    form.draughtMm,
    form.speed,
    form.block,
    form.length,
    form.tonnage,
    form.boardingDate,
    form.boardingTime,
  ]);
}

function feetPartsOf(millimetres: number): { feet: string; inches: string } {
  const text = feetInchesFromMm(millimetres);
  const match = /^(-?\d+) ft ([\d.]+) in$/.exec(text);
  if (match === null) return { feet: '0', inches: '0' };
  return { feet: match[1] as string, inches: match[2] as string };
}

export function OrdersScreen({ user }: { user: SessionUser }): JSX.Element {
  const navigation = useNavigation();
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [boardAnnouncement, setBoardAnnouncement] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState(() => navigation.search.get('q') ?? '');
  const planToken = useRef(0);
  const announcedSignature = useRef<string | null>(null);
  const control = useKeyedControl();

  const refresh = async (): Promise<void> => {
    const [movesReply, invoicesReply] = await Promise.all([
      send<{ moves: Move[] }>('GET', '/api/moves').catch(() => null),
      send<{ invoices: Invoice[] }>('GET', '/api/invoices').catch(() => null),
    ]);
    if (movesReply !== null && movesReply.ok) setMoves(movesReply.data.moves);
    if (invoicesReply !== null && invoicesReply.ok) setInvoices(invoicesReply.data.invoices);
  };

  useEffect(() => {
    void (async () => {
      const reply = await send<{ vessels: Vessel[] }>('GET', '/api/vessels').catch(() => null);
      if (reply !== null && reply.ok) setVessels(reply.data.vessels);
      await refresh();
    })();
  }, []);

  useInterval(() => {
    void refresh();
  }, 30_000);

  const signature = signatureOf(form);

  /** A reply paints only if its inputs are still the form's current inputs. */
  useEffect(() => {
    if (form.vesselId === '' || form.boardingDate === '' || form.boardingTime === '') return;
    const token = planToken.current + 1;
    planToken.current = token;
    const timer = setTimeout(() => {
      void (async () => {
        const body: Record<string, unknown> = {
          vessel_id: form.vesselId,
          boarding_at: `${form.boardingDate}T${form.boardingTime}`,
          speed_kn: Number(form.speed),
          draught_m: form.draughtMm / 1000,
          block_coefficient: Number(form.block),
          gross_tonnage: Number(form.tonnage),
          length_m: Number(form.length),
        };
        try {
          const reply = await send<Plan>('POST', '/api/plan', { body });
          if (planToken.current !== token) return;
          if (!reply.ok) {
            setPlanFailed(true);
            setAnnouncement('Plan unavailable - last values shown');
            return;
          }
          setPlan(reply.data);
          setPlanFailed(false);
        } catch {
          if (planToken.current !== token) return;
          setPlanFailed(true);
          setAnnouncement('Plan unavailable - last values shown');
        }
      })();
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signature]);

  /** The live plan announcement is made once per set of inputs. */
  useEffect(() => {
    if (plan === null || planFailed) return;
    if (announcedSignature.current === signature) return;
    const timer = setTimeout(() => {
      const pinch = plan.waypoints.find((waypoint) => waypoint.pinch);
      announcedSignature.current = signature;
      setAnnouncement(
        `${plan.window_state === 'open' ? 'Window open' : 'Window closed'}, pinch ${
          pinch?.name ?? ''
        } ${marginFromMm(plan.pinch.margin_mm)} m, estimate ${money(plan.estimate.total_cents)} CAD`,
      );
    }, ANNOUNCE_REST_MS);
    return () => clearTimeout(timer);
  }, [plan, planFailed, signature]);

  const chooseVessel = (vesselId: string): void => {
    const vessel = vessels.find((entry) => entry.id === vesselId);
    if (vessel === undefined) {
      setForm({ ...EMPTY });
      return;
    }
    const parts = feetPartsOf(vessel.draught_mm);
    setForm((current) => ({
      ...current,
      vesselId,
      draughtMm: vessel.draught_mm,
      metresText: (vessel.draught_mm / 1000).toFixed(3),
      feetText: parts.feet,
      inchesText: parts.inches,
      speed: String(vessel.speed_kn),
      block: String(vessel.block_coefficient),
      length: String(vessel.length_m),
      tonnage: String(vessel.gross_tonnage),
    }));
  };

  const placeOrder = (): void => {
    if (control.pending) return;
    const body: Record<string, unknown> = {
      vessel_id: form.vesselId,
      boarding_at: `${form.boardingDate}T${form.boardingTime}`,
      speed_kn: Number(form.speed),
      duty_minutes: Number(form.duty),
      draught_m: form.draughtMm / 1000,
      block_coefficient: Number(form.block),
      gross_tonnage: Number(form.tonnage),
      length_m: Number(form.length),
    };
    const key = control.keyFor(JSON.stringify(body));
    control.setPending(true);
    setAnnouncement('Placing order...');
    void (async () => {
      try {
        const reply = await send<Move>('POST', '/api/moves', { body, key });
        control.replyReceived();
        if (reply.ok) {
          setErrors({});
          setAnnouncement(`Order ${reply.data.ref} placed`);
          await refresh();
          return;
        }
        const fields = reply.error.errors ?? { form: reply.error.message };
        setErrors(fields);
        setAnnouncement(`${Object.keys(fields).length} fields need attention`);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return moves;
    return moves.filter((move) =>
      `${move.ref} ${move.vessel.name} ${move.status}`.toLowerCase().includes(needle),
    );
  }, [moves, query]);

  useEffect(() => {
    if (query === '' || moves.length === 0) return;
    setBoardAnnouncement(`${filtered.length} moves shown`);
  }, [moves.length]);

  const pinch = plan?.waypoints.find((waypoint) => waypoint.pinch);

  return (
    <div className="columns">
      <section className="pane" aria-label="Order form">
        <h2>{`Order a pilot move - ${user.agency_code ?? ''}`}</h2>
        <div className="form-grid">
          <label>
            Vessel
            <select
              id="order-vessel_id"
              aria-label="Vessel"
              value={form.vesselId}
              onChange={(event) => chooseVessel(event.target.value)}
            >
              <option value="">Choose a vessel</option>
              {vessels.map((vessel) => (
                <option key={vessel.id} value={vessel.id}>
                  {vessel.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Draught units</legend>
            <div role="radiogroup" aria-label="Draught units" className="keel-controls">
              <label className="choice">
                <input
                  type="radio"
                  name="unit"
                  aria-label="Metres"
                  checked={form.unit === 'metres'}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      unit: 'metres',
                      metresText: (current.draughtMm / 1000).toFixed(3),
                    }))
                  }
                />
                Metres
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="unit"
                  aria-label="Feet and inches"
                  checked={form.unit === 'feet'}
                  onChange={() =>
                    setForm((current) => {
                      const parts = feetPartsOf(current.draughtMm);
                      return {
                        ...current,
                        unit: 'feet',
                        feetText: parts.feet,
                        inchesText: parts.inches,
                      };
                    })
                  }
                />
                Feet and inches
              </label>
            </div>
            {form.unit === 'metres' ? (
              <label>
                Draught in metres
                <input
                  id="order-draught_m"
                  type="number"
                  step="0.001"
                  aria-label="Draught in metres"
                  value={form.metresText}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      metresText: event.target.value,
                      draughtMm: draughtMmFromMetres(Number(event.target.value)),
                    }))
                  }
                />
              </label>
            ) : (
              <>
                <label>
                  Draught feet
                  <input
                    id="order-draught_ft"
                    type="number"
                    step="1"
                    aria-label="Draught feet"
                    value={form.feetText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        feetText: event.target.value,
                        draughtMm: draughtMmFromFeetInches(
                          Number(event.target.value),
                          Number(current.inchesText),
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  Draught inches
                  <input
                    id="order-draught_in"
                    type="number"
                    step="0.25"
                    aria-label="Draught inches"
                    value={form.inchesText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        inchesText: event.target.value,
                        draughtMm: draughtMmFromFeetInches(
                          Number(current.feetText),
                          Number(event.target.value),
                        ),
                      }))
                    }
                  />
                </label>
              </>
            )}
          </fieldset>
          <label>
            Speed in knots
            <input
              id="order-speed_kn"
              type="number"
              step="0.5"
              aria-label="Speed in knots"
              value={form.speed}
              onChange={(event) => setForm((current) => ({ ...current, speed: event.target.value }))}
            />
          </label>
          <label>
            Block coefficient
            <input
              id="order-block_coefficient"
              type="number"
              step="0.01"
              aria-label="Block coefficient"
              value={form.block}
              onChange={(event) => setForm((current) => ({ ...current, block: event.target.value }))}
            />
          </label>
          <label>
            Length in metres
            <input
              id="order-length_m"
              type="number"
              step="1"
              aria-label="Length in metres"
              value={form.length}
              onChange={(event) =>
                setForm((current) => ({ ...current, length: event.target.value }))
              }
            />
          </label>
          <label>
            Gross tonnage
            <input
              id="order-gross_tonnage"
              type="number"
              step="1"
              aria-label="Gross tonnage"
              value={form.tonnage}
              onChange={(event) =>
                setForm((current) => ({ ...current, tonnage: event.target.value }))
              }
            />
          </label>
          <label>
            Duty minutes
            <input
              id="order-duty_minutes"
              type="number"
              step="30"
              aria-label="Duty minutes"
              value={form.duty}
              onChange={(event) => setForm((current) => ({ ...current, duty: event.target.value }))}
            />
          </label>
          <label>
            Boarding date
            <input
              id="order-boarding_at"
              aria-label="Boarding date"
              value={form.boardingDate}
              placeholder="YYYY-MM-DD"
              onChange={(event) =>
                setForm((current) => ({ ...current, boardingDate: event.target.value }))
              }
            />
          </label>
          <label>
            Boarding time
            <input
              aria-label="Boarding time"
              value={form.boardingTime}
              placeholder="HH:MM"
              onChange={(event) =>
                setForm((current) => ({ ...current, boardingTime: event.target.value }))
              }
            />
          </label>
          <button type="button" className="primary" onClick={placeOrder}>
            Place order
          </button>
        </div>
        <FormErrors errors={errors} prefix="order" />
        <div role="status" aria-label="Order announcements" className="announce">
          {announcement}
        </div>
        <section aria-label="Order clearances">
          <h3>Order clearances</h3>
          {form.vesselId === '' || plan === null ? (
            <p>Choose a vessel to see clearances</p>
          ) : (
            <>
              <div className="scroll-x">
                <table aria-label="Clearances">
                <tbody>
                  {plan.waypoints.map((waypoint) => (
                    <tr key={waypoint.id}>
                      <th scope="row">{waypoint.name}</th>
                      <td>{clearanceCell(waypoint.clearance_mm)}</td>
                      <td className={waypoint.margin_mm < 0 ? 'negative' : undefined}>
                        {`${marginFromMm(waypoint.margin_mm)} m`}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
              <p className="mono">{plan.window_state === 'open' ? 'Window open' : 'Window closed'}</p>
              <p className="mono">{`Pinch ${pinch?.name ?? ''} ${marginFromMm(plan.pinch.margin_mm)} m`}</p>
              <p className="mono">{`Estimate ${money(plan.estimate.total_cents)} CAD`}</p>
            </>
          )}
        </section>
      </section>
      <section className="pane" aria-label="Moves">
        <h2>Your moves</h2>
        <label>
          Search moves
          <input
            type="search"
            aria-label="Search moves"
            value={query}
            onChange={(event) => {
              const text = event.target.value;
              setQuery(text);
              const params = new URLSearchParams();
              if (text !== '') params.set('q', text);
              const search = params.toString();
              navigation.replace(`/orders${search === '' ? '' : `?${search}`}`);
              const needle = text.trim().toLowerCase();
              const count =
                needle === ''
                  ? moves.length
                  : moves.filter((move) =>
                      `${move.ref} ${move.vessel.name} ${move.status}`
                        .toLowerCase()
                        .includes(needle),
                    ).length;
              setBoardAnnouncement(`${count} moves shown`);
            }}
          />
        </label>
        <div className="rows">
          {filtered.map((move) => (
            <div key={move.ref} className="row">
              <span className="ref">{move.ref}</span>
              <span>{move.vessel.name}</span>
              <span>{move.detained ? 'On board - detained' : move.status}</span>
              <span className="mono">{move.boarding_at.replace('T', ' ')}</span>
              <span className="dim">{`Priced by ${move.priced_by ?? ''}`}</span>
              <a href={`/moves/${move.ref}`}>{`Open ${move.ref}`}</a>
            </div>
          ))}
        </div>
        <div role="status" aria-label="Board announcements" className="announce">
          {boardAnnouncement}
        </div>
        <h2>Invoices</h2>
        <div className="rows">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="row">
              <span className="ref">{invoice.id}</span>
              <span>{invoice.move_ref}</span>
              <span>{invoice.state}</span>
              <span className="mono">{invoice.number ?? '-'}</span>
              <span className="mono">
                {invoice.balance_cents === null ? '-' : money(invoice.balance_cents)}
              </span>
              <a href={`/invoices/${invoice.id}`}>{`Open invoice ${invoice.id}`}</a>
            </div>
          ))}
        </div>
        <p>
          <a href="/api/exports/moves.csv">Export moves</a>
        </p>
      </section>
    </div>
  );
}
