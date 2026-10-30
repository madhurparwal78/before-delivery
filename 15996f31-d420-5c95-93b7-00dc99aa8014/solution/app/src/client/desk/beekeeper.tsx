// Beekeeper panels: Open orders, My drops, Commit truckload and Log drop (brief: Interactions).

import { Package, Truck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DROP_STATUS_LABELS, TIER_LABELS, type BeekeeperOrder, type BeekeeperOrderListItem, type Drop, type Tier } from "../../shared/api.js";
import { countyName, humanDate, humanTime, money, pacificWallClock, pacificWallToIso, parseDateInput, parseTimeInput } from "../../shared/format.js";
import { get, post } from "../api.js";
import { navigate } from "../hooks.js";
import { Dialog } from "../ui/Dialog.js";
import { Button, ErrorSummary, clearEdited, SelectField, TextField, errorFor, fieldErrors, type FieldError } from "../ui/forms.js";
import { useAction } from "./session.js";
import { DataTable, Empty, type Column } from "./tables.js";

const TIERS: Tier[] = ["none", "reduced", "standard", "bonus"];

export function OpenOrders({ orders, onCommit }: { orders: BeekeeperOrderListItem[]; onCommit: (order: BeekeeperOrderListItem, opener: HTMLElement) => void }) {
  return (
    <section className="open-orders" aria-labelledby="open-orders-title" role="region">
      <h2 id="open-orders-title">Open orders</h2>
      {orders.length === 0 ? (
        <Empty icon={<Truck aria-hidden="true" size={20} strokeWidth={1.5} />}>No open orders right now.</Empty>
      ) : (
        <ul className="order-cards">
          {orders.map((order) => (
            <li key={order.id} className="order-card">
              <div className="order-card-head">
                <h3>{order.ref}</h3>
                <p className="muted">
                  {order.orchard.name} · {countyName(order.orchard.county)}
                </p>
              </div>
              <dl className="figures">
                <div>
                  <dt>Deliver by</dt>
                  <dd>{humanDate(order.delivery_deadline)}</dd>
                </div>
                <div>
                  <dt>Still open</dt>
                  <dd>{order.hives_remaining} hives</dd>
                </div>
              </dl>
              <dl className="figures pay-tiers" aria-label={`Pay per hive by tier, ${order.ref}`}>
                {TIERS.map((tier) => (
                  <div key={tier}>
                    <dt>{TIER_LABELS[tier]}</dt>
                    <dd>{money(order.pay_per_hive_cents[tier])}</dd>
                  </div>
                ))}
              </dl>
              <Button variant="primary" aria-label={`Commit truckload to ${order.ref}`} onClick={(event) => onCommit(order, event.currentTarget)}>
                <Truck aria-hidden="true" size={18} strokeWidth={1.5} />
                Commit truckload
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyDrops({ drops, onLog }: { drops: Drop[]; onLog: (drop: Drop, opener: HTMLElement) => void }) {
  const columns: Column<Drop>[] = [
    {
      label: "Drop",
      cell: (drop) => (
        <a
          href={`/desk/drops/${encodeURIComponent(drop.id)}`}
          aria-label={`View drop ${drop.yard_name}, ${drop.hives} hives`}
          onClick={(event) => {
            event.preventDefault();
            navigate(`/desk/drops/${encodeURIComponent(drop.id)}`);
          }}
        >
          {drop.yard_name}
        </a>
      ),
    },
    { label: "Hives", cell: (drop) => drop.hives, numeric: true },
    {
      label: "Order",
      cell: (drop) => (
        <span className="stacked">
          <span className="num">{drop.order.ref}</span>
          <span className="muted">{drop.orchard.name}</span>
        </span>
      ),
    },
    { label: "Block", cell: (drop) => drop.block?.name ?? "—" },
    { label: "Delivered", cell: (drop) => (drop.delivered_on ? humanDate(drop.delivered_on) : "—"), numeric: true },
    { label: "Status", cell: (drop) => DROP_STATUS_LABELS[drop.status] },
    { label: "Expected pay", cell: (drop) => (drop.payout_cents === null ? "—" : money(drop.payout_cents)), numeric: true },
  ];
  if (drops.some((drop) => drop.status === "committed")) {
    columns.push({
      label: "Action",
      cell: (drop) => (drop.status === "committed" ? <Button onClick={(event) => onLog(drop, event.currentTarget)}>Log drop</Button> : null),
    });
  }
  return (
    <section className="my-drops" aria-labelledby="my-drops-title">
      <h2 id="my-drops-title">My drops</h2>
      {drops.length === 0 ? (
        <Empty icon={<Package aria-hidden="true" size={20} strokeWidth={1.5} />}>You haven't committed any truckloads yet.</Empty>
      ) : (
        <DataTable label="My drops" columns={columns} rows={drops} rowKey={(drop) => drop.id} />
      )}
    </section>
  );
}

interface CommitProps {
  open: boolean;
  opener: HTMLElement | null;
  order: BeekeeperOrderListItem;
  onClose: () => void;
  onRefused: (remaining: number) => void;
  onCommitted: () => Promise<void>;
}

function refusalCopy(remaining: number, ref: string): string {
  return `Only ${remaining} hives are still open on ${ref}.`;
}

export function CommitDialog({ open, opener, order, onClose, onRefused, onCommitted }: CommitProps) {
  const { busy, run } = useAction();
  const [yard, setYard] = useState("");
  // The still-open count is read when the dialog opens and not re-read while it stays open.
  const [max, setMax] = useState(order.hives_remaining);
  const [hives, setHives] = useState(String(order.hives_remaining));
  const [errors, setErrors] = useState<FieldError[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const count = Number(hives);
    const result = await run("commit", {
      pending: `Committing ${hives} hives to ${order.ref}…`,
      call: () => post<Drop>(`/api/orders/${order.id}/drops`, { yard_name: yard, hives: hives.trim() === "" ? null : count }),
      success: (drop) => `${drop.hives} hives committed to ${order.ref}.`,
      refusal: (failure) =>
        failure.error?.error === "not_enough_open_hives" ? refusalCopy(failure.error.remaining ?? 0, order.ref) : undefined,
      then: async () => {
        setErrors([]);
        await onCommitted();
      },
    });
    if (result.ok) return;
    if (result.error?.error === "not_enough_open_hives") {
      const remaining = result.error.remaining ?? 0;
      setMax(remaining);
      onRefused(remaining);
      setErrors([{ target: "commit-hives", message: refusalCopy(remaining, order.ref) }]);
    } else if (result.status === 422) {
      setErrors(fieldErrors(result.error?.fields, { yard_name: "commit-yard", hives: "commit-hives" }, "commit-yard"));
    }
  };

  return (
    <Dialog title="Commit truckload" open={open} opener={opener} onClose={onClose}>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label={`Commit a truckload to ${order.ref}`}>
        <p className="dialog-lede">
          {order.ref} · {order.orchard.name}. {max} hives still open when you opened this form.
        </p>
        <ErrorSummary errors={errors} />
        <TextField id="commit-yard" label="Yard name" value={yard} onChange={(event) => setYard(event.target.value)} error={errorFor(errors, "commit-yard")} />
        <TextField
          id="commit-hives"
          label="Hives"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          value={hives}
          onChange={(event) => setHives(event.target.value)}
          error={errorFor(errors, "commit-hives")}
        />
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "commit"}>
            Commit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface LogDropProps {
  open: boolean;
  opener: HTMLElement | null;
  drop: Drop;
  onClose: () => void;
  onLogged: () => Promise<void>;
}

export function LogDropDialog({ open, opener, drop, onClose, onLogged }: LogDropProps) {
  const { busy, run } = useAction();
  const [order, setOrder] = useState<BeekeeperOrder | null>(null);
  const [blockId, setBlockId] = useState("");
  // Defaults are the current Pacific wall-clock time, whatever the browser's time zone.
  const [now] = useState(() => pacificWallClock(new Date()));
  const [date, setDate] = useState(humanDate(now.date));
  const [time, setTime] = useState(humanTime(now.hour, now.minute));
  const [errors, setErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    void get<BeekeeperOrder>(`/api/orders/${drop.order.id}`).then((result) => {
      if (!result.ok) return;
      setOrder(result.data);
      const roomy = result.data.blocks.find((block) => block.hives_ordered - block.hives_delivered >= drop.hives) ?? result.data.blocks[0];
      setBlockId((current) => current || (roomy?.id ?? ""));
    });
  }, [drop]);

  const chosen = order?.blocks.find((block) => block.id === blockId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const day = parseDateInput(date);
    const clock = parseTimeInput(time);
    const deliveredAt = day && clock ? pacificWallToIso(day, clock.hour, clock.minute) : `${date} ${time}`;
    const result = await run("logDrop", {
      pending: "Logging drop…",
      call: () => post<Drop>(`/api/drops/${drop.id}/deliver`, { block_id: blockId, delivered_at: deliveredAt }),
      success: (logged) => `Drop logged: ${logged.hives} hives in ${logged.block?.name ?? ""}, delivered ${logged.delivered_on ? humanDate(logged.delivered_on) : ""}.`,
      then: async () => {
        setErrors([]);
        await onLogged();
      },
    });
    if (!result.ok && result.status === 422) {
      setErrors(fieldErrors(result.error?.fields, { block_id: "log-block", delivered_at: "log-date" }, "log-block"));
    }
  };

  return (
    <Dialog title="Log drop" open={open} opener={opener} onClose={onClose}>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label={`Log the drop from ${drop.yard_name}`}>
        <p className="dialog-lede">
          {drop.yard_name} · {drop.hives} hives for {drop.order.ref}.
        </p>
        <ErrorSummary errors={errors} />
        <SelectField
          id="log-block"
          label="Block"
          value={blockId}
          onChange={(event) => setBlockId(event.target.value)}
          error={errorFor(errors, "log-block")}
          hint={chosen ? `Room for ${chosen.hives_ordered - chosen.hives_delivered} more hives` : undefined}
        >
          {order?.blocks.map((block) => (
            <option key={block.id} value={block.id}>
              {block.name}
            </option>
          ))}
        </SelectField>
        <div className="field-pair">
          <TextField
            id="log-date"
            label="Delivery date (Pacific)"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            error={errorFor(errors, "log-date")}
            hint="Like Feb 5, 2027"
          />
          <TextField id="log-time" label="Delivery time (Pacific)" value={time} onChange={(event) => setTime(event.target.value)} hint="Like 3:30 PM" />
        </div>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "logDrop"}>
            Log drop
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
