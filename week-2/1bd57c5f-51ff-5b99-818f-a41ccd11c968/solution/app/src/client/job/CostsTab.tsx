import { Check, Plus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TRADE_LABELS, type ChangeOrder, type Costs } from "../../shared/domain";
import { formatDollars } from "../../shared/money";
import { useAnnounce } from "../activity";
import { ApiFailure, api } from "../api";
import { ErrorSummary, FieldError } from "../components/ErrorSummary";
import { COPY } from "../copy";
import { localDateTime } from "../time";
import { useJob } from "./context";

// The Costs tab reads like a ledger page: ruled rows, figures aligned on the right. It follows
// the job's costs events and re-reads whenever the job refreshes.

type Errors = Record<string, string>;

function Contingency({ percent, onSaved }: { percent: string; onSaved: () => void }) {
  const { job, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [value, setValue] = useState(percent);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  useEffect(() => setValue(percent), [percent]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api("PUT", `/api/jobs/${job.id}/contingency`, { percent: value.trim() });
      setErrors({});
      announce("Contingency saved.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Saving the contingency needs a connection.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="ledger-form" onSubmit={submit} noValidate>
      <ErrorSummary problems={errors.percent ? [{ target: "contingency-percent", message: errors.percent }] : []} />
      <div className="field">
        <label htmlFor="contingency-percent">Contingency percent</label>
        <input
          id="contingency-percent"
          className="input mono"
          inputMode="decimal"
          value={value}
          disabled={!online || readOnly}
          aria-invalid={errors.percent ? true : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        <FieldError id="contingency-percent-error" message={errors.percent} />
      </div>
      <button type="submit" className="btn" disabled={!online || readOnly || pending} aria-busy={pending}>
        Save contingency
      </button>
    </form>
  );
}

const ORDER_IDS = { description: "order-description", amount: "order-amount" };

function AddChangeOrder({ onSaved }: { onSaved: () => void }) {
  const { job, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [form, setForm] = useState({ description: "", amount: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    announce(COPY.saving);
    try {
      await api<ChangeOrder>("POST", `/api/jobs/${job.id}/change-orders`, { description: form.description, amount: form.amount.trim() });
      setForm({ description: "", amount: "" });
      setErrors({});
      announce("Change order added.");
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.fields ?? {});
        announce(error.message);
      } else announce("Adding a change order needs a connection.");
    } finally {
      setPending(false);
    }
  };
  const disabled = !online || readOnly;
  return (
    <form className="ledger-form" onSubmit={submit} noValidate>
      <ErrorSummary problems={Object.entries(errors).map(([field, message]) => ({ target: ORDER_IDS[field as keyof typeof ORDER_IDS] ?? ORDER_IDS.description, message }))} />
      <div className="field field--grow">
        <label htmlFor={ORDER_IDS.description}>Change order description</label>
        <input
          id={ORDER_IDS.description}
          className="input"
          value={form.description}
          disabled={disabled}
          aria-invalid={errors.description ? true : undefined}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
        <FieldError id="order-description-error" message={errors.description} />
      </div>
      <div className="field">
        <label htmlFor={ORDER_IDS.amount}>Change order amount</label>
        <input
          id={ORDER_IDS.amount}
          className="input mono"
          inputMode="decimal"
          value={form.amount}
          disabled={disabled}
          aria-invalid={errors.amount ? true : undefined}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
        />
        <FieldError id="order-amount-error" message={errors.amount} />
      </div>
      <button type="submit" className="btn" disabled={disabled || pending} aria-busy={pending}>
        <Plus size={16} aria-hidden="true" />
        Add change order
      </button>
    </form>
  );
}

export function CostsTab() {
  const { session, job, role, online, readOnly } = useJob();
  const announce = useAnnounce();
  const [costs, setCosts] = useState<Costs | null>(null);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const owner = role === "owner";

  const load = useCallback(async () => {
    try {
      const [figures, { change_orders: list }] = await Promise.all([
        api<Costs>("GET", `/api/jobs/${job.id}/costs`),
        api<{ change_orders: ChangeOrder[] }>("GET", `/api/jobs/${job.id}/change-orders`),
      ]);
      setCosts(figures);
      setOrders(list);
    } catch (error) {
      if (!(error instanceof ApiFailure)) return;
    }
  }, [job.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => session.watch("costs", () => void load()), [session, load]);

  const approve = async (order: ChangeOrder) => {
    announce(COPY.saving);
    try {
      await api("POST", `/api/jobs/${job.id}/change-orders/${order.id}/approve`);
      announce("Change order approved.");
      void load();
    } catch (error) {
      announce(error instanceof ApiFailure ? error.message : "Approving needs a connection.");
    }
  };

  if (!costs) return <p className="loading">Loading</p>;
  return (
    <div className="panel ledger">
      <div className="ledger-tables">
        <section className="panel-section" aria-labelledby="cost-room-heading">
          <h2 id="cost-room-heading">By room</h2>
          <div className="table-wrap">
            <table aria-label="Cost by room">
              <thead>
                <tr>
                  <th scope="col">Room</th>
                  <th scope="col" className="num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.by_room.map((row) => (
                  <tr key={row.room_id}>
                    <td className="wrap">{row.name}</td>
                    <td className="mono num">{formatDollars(row.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel-section" aria-labelledby="cost-trade-heading">
          <h2 id="cost-trade-heading">By trade</h2>
          <div className="table-wrap">
            <table aria-label="Cost by trade">
              <thead>
                <tr>
                  <th scope="col">Trade</th>
                  <th scope="col" className="num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.by_trade.map((row) => (
                  <tr key={row.trade ?? "crew"}>
                    <td>{row.trade ? TRADE_LABELS[row.trade] : "Crew"}</td>
                    <td className="mono num">{formatDollars(row.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="panel-section totals" aria-label="Totals">
        <p className="total-line">
          Subtotal <span className="mono">{formatDollars(costs.items_subtotal)}</span>
        </p>
        <p className="total-line">
          Change orders <span className="mono">{formatDollars(costs.change_orders_total)}</span>
        </p>
        <p className="total-line">
          Contingency <span className="mono">{costs.contingency_percent}%</span> <span className="mono">{formatDollars(costs.contingency)}</span>
        </p>
        <p className="total-line total-line--grand">
          Total <span className="mono">{formatDollars(costs.total)}</span>
        </p>
        {owner && <Contingency percent={costs.contingency_percent} onSaved={() => void load()} />}
      </section>
      <section className="panel-section" aria-labelledby="orders-heading">
        <h2 id="orders-heading">Change orders</h2>
        <div className="table-wrap">
          <table aria-label="Change orders">
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Status</th>
                <th scope="col">Approved at</th>
                {owner && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="wrap">{order.description}</td>
                  <td className="mono num">{formatDollars(order.amount)}</td>
                  <td>{order.status === "approved" ? "Approved" : "Pending"}</td>
                  <td className="mono">{order.approved_at ? localDateTime(order.approved_at, job.time_zone) : "—"}</td>
                  {owner && (
                    <td>
                      {order.status === "pending" && !readOnly && (
                        <button type="button" className="btn btn--small" disabled={!online} onClick={() => void approve(order)}>
                          <Check size={14} aria-hidden="true" />
                          Approve {order.description}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && <p className="muted">No change orders yet.</p>}
        <AddChangeOrder onSaved={() => void load()} />
      </section>
    </div>
  );
}
