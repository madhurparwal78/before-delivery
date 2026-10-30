// Broker dialogs: New orchard, New order, Send inspection link, Settle orchard, Cancel order.

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AnyOrder, BrokerOrder, Grower, InspectionLinkView, OrchardSummary, Settlement } from "../../shared/api.js";
import { humanDate, money, pacificDate, parseDateInput } from "../../shared/format.js";
import { get, newKey, post } from "../api.js";
import { Dialog } from "../ui/Dialog.js";
import { Button, ErrorSummary, clearEdited, SelectField, TextField, errorFor, fieldErrors, type FieldError } from "../ui/forms.js";
import { useAction } from "./session.js";
import { DataTable } from "./tables.js";

interface DialogBase {
  open: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
}

/** A Pacific date typed as "2027-02-05" or "Feb 5, 2027", sent as YYYY-MM-DD; anything else goes as typed. */
function isoOrRaw(text: string): string {
  return parseDateInput(text) ?? text;
}

interface BlockRow {
  key: number;
  name: string;
  acres: string;
}

export function NewOrchardDialog({ open, opener, onClose, onSaved }: DialogBase & { onSaved: (orchard: OrchardSummary) => Promise<void> }) {
  const { busy, run } = useAction();
  const [growers, setGrowers] = useState<Grower[]>([]);
  const [growerId, setGrowerId] = useState("");
  const [name, setName] = useState("");
  const [county, setCounty] = useState("");
  const [rows, setRows] = useState<BlockRow[]>([{ key: 0, name: "", acres: "" }]);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const focusRow = useRef<number | null>(null);

  useEffect(() => {
    void get<Grower[]>("/api/growers").then((result) => result.ok && setGrowers(result.data));
  }, []);

  useEffect(() => {
    if (focusRow.current === null) return;
    document.getElementById(`no-block-${focusRow.current}-name`)?.focus();
    focusRow.current = null;
  }, [rows]);

  const setRow = (key: number, patch: Partial<BlockRow>) => setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run("saveOrchard", {
      pending: "Saving orchard…",
      call: () =>
        post<OrchardSummary>("/api/orchards", {
          grower_id: growerId,
          name,
          county,
          blocks: rows.map((row) => ({ name: row.name, acres: row.acres.trim() === "" ? null : Number(row.acres) })),
        }),
      success: (orchard) => `Orchard ${orchard.name} saved.`,
      then: async (orchard) => {
        setErrors([]);
        await onSaved(orchard);
      },
    });
    if (!result.ok && result.status === 422) {
      const ids: Record<string, string> = { grower_id: "no-grower", name: "no-name", county: "no-county", blocks: `no-block-${rows[0]?.key ?? 0}-name` };
      rows.forEach((row, index) => {
        ids[`blocks.${index}.name`] = `no-block-${row.key}-name`;
        ids[`blocks.${index}.acres`] = `no-block-${row.key}-acres`;
      });
      setErrors(fieldErrors(result.error?.fields, ids, "no-name"));
    }
  };

  return (
    <Dialog title="New orchard" open={open} opener={opener} onClose={onClose} wide>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label="New orchard details">
        <ErrorSummary errors={errors} />
        <SelectField id="no-grower" label="Grower" value={growerId} onChange={(event) => setGrowerId(event.target.value)} error={errorFor(errors, "no-grower")}>
          <option value="">Choose a grower</option>
          {growers.map((grower) => (
            <option key={grower.id} value={grower.id}>
              {grower.name}
            </option>
          ))}
        </SelectField>
        <div className="field-pair">
          <TextField id="no-name" label="Orchard name" value={name} onChange={(event) => setName(event.target.value)} error={errorFor(errors, "no-name")} />
          <TextField id="no-county" label="County" value={county} onChange={(event) => setCounty(event.target.value)} error={errorFor(errors, "no-county")} />
        </div>
        <fieldset className="block-rows">
          <legend>Blocks</legend>
          {rows.map((row, index) => (
            <div className="block-row" key={row.key}>
              <TextField
                id={`no-block-${row.key}-name`}
                label="Block name"
                value={row.name}
                onChange={(event) => setRow(row.key, { name: event.target.value })}
                error={errorFor(errors, `no-block-${row.key}-name`)}
              />
              <TextField
                id={`no-block-${row.key}-acres`}
                label="Acres"
                type="number"
                inputMode="decimal"
                min={1}
                max={500}
                step={0.1}
                value={row.acres}
                onChange={(event) => setRow(row.key, { acres: event.target.value })}
                error={errorFor(errors, `no-block-${row.key}-acres`)}
              />
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove block ${index + 1}`}
                  onClick={() => setRows((list) => list.filter((entry) => entry.key !== row.key))}
                >
                  <Trash2 aria-hidden="true" size={18} strokeWidth={1.5} />
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          ))}
          {rows.length < 12 ? (
            <Button
              onClick={() => {
                const key = Math.max(...rows.map((row) => row.key)) + 1;
                focusRow.current = key;
                setRows((list) => [...list, { key, name: "", acres: "" }]);
              }}
            >
              <Plus aria-hidden="true" size={18} strokeWidth={1.5} />
              Add block
            </Button>
          ) : null}
        </fieldset>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "saveOrchard"}>
            Save orchard
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface NewOrderProps extends DialogBase {
  orchards: OrchardSummary[];
  defaultOrchard: string | null;
  onSaved: (order: BrokerOrder) => Promise<void>;
}

export function NewOrderDialog({ open, opener, onClose, orchards, defaultOrchard, onSaved }: NewOrderProps) {
  const { busy, run } = useAction();
  const [orchardId, setOrchardId] = useState(defaultOrchard ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [deadline, setDeadline] = useState("");
  const [hives, setHives] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const orchard = orchards.find((entry) => entry.id === orchardId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const lines = (orchard?.blocks ?? []).filter((block) => (hives[block.id] ?? "").trim() !== "");
    const result = await run("saveOrder", {
      pending: "Saving draft order…",
      call: () =>
        post<BrokerOrder>("/api/orders", {
          orchard_id: orchardId,
          bloom_start: isoOrRaw(start),
          bloom_end: isoOrRaw(end),
          delivery_deadline: isoOrRaw(deadline),
          blocks: lines.map((block) => ({ block_id: block.id, hives: Number(hives[block.id]) })),
        }),
      success: (order) => `Draft order ${order.ref} saved.`,
      then: async (order) => {
        setErrors([]);
        await onSaved(order);
      },
    });
    if (!result.ok && result.status === 422) {
      const firstHives = orchard?.blocks[0] ? `nw-hives-${orchard.blocks[0].id}` : "nw-orchard";
      const ids: Record<string, string> = { orchard_id: "nw-orchard", bloom_start: "nw-start", bloom_end: "nw-end", delivery_deadline: "nw-deadline", blocks: firstHives };
      lines.forEach((block, index) => {
        ids[`blocks.${index}.hives`] = `nw-hives-${block.id}`;
        ids[`blocks.${index}.block_id`] = `nw-hives-${block.id}`;
      });
      setErrors(fieldErrors(result.error?.fields, ids, "nw-orchard"));
    }
  };

  const dateHint = "Pacific date, like 2027-02-05";
  return (
    <Dialog title="New order" open={open} opener={opener} onClose={onClose} wide>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label="New order details">
        <ErrorSummary errors={errors} />
        <SelectField id="nw-orchard" label="Orchard" value={orchardId} onChange={(event) => setOrchardId(event.target.value)} error={errorFor(errors, "nw-orchard")}>
          <option value="">Choose an orchard</option>
          {orchards.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </SelectField>
        <div className="field-trio">
          <TextField id="nw-start" label="Bloom start" hint={dateHint} value={start} onChange={(event) => setStart(event.target.value)} error={errorFor(errors, "nw-start")} />
          <TextField id="nw-end" label="Bloom end" hint={dateHint} value={end} onChange={(event) => setEnd(event.target.value)} error={errorFor(errors, "nw-end")} />
          <TextField
            id="nw-deadline"
            label="Delivery deadline"
            hint={dateHint}
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            error={errorFor(errors, "nw-deadline")}
          />
        </div>
        {orchard ? (
          <fieldset className="block-rows">
            <legend>Hives per block</legend>
            <p className="field-hint">Leave a block empty to leave it out of this order.</p>
            <div className="hive-grid">
              {orchard.blocks.map((block) => (
                <TextField
                  key={block.id}
                  id={`nw-hives-${block.id}`}
                  label={`Hives, ${block.name}`}
                  hint={`${block.acres} ac`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2000}
                  step={1}
                  value={hives[block.id] ?? ""}
                  onChange={(event) => setHives((current) => ({ ...current, [block.id]: event.target.value }))}
                  error={errorFor(errors, `nw-hives-${block.id}`)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "saveOrder"}>
            Save draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SendLinkDialog({ open, opener, onClose, order, onSent }: DialogBase & { order: AnyOrder; onSent: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run("sendLink", {
      pending: "Sending inspection link…",
      call: () => post<InspectionLinkView>(`/api/orders/${order.id}/inspection-links`, { inspector_email: email }),
      success: (link) => `Inspection link for ${order.ref} is on its way to ${link.inspector_email}. Any earlier link has stopped working.`,
      then: async () => {
        setErrors([]);
        await onSent();
      },
    });
    if (!result.ok && result.status === 422) {
      setErrors(fieldErrors(result.error?.fields, { inspector_email: "sl-email" }, "sl-email"));
    }
  };
  return (
    <Dialog title="Send inspection link" open={open} opener={opener} onClose={onClose}>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label="Inspection link details">
        <p className="dialog-lede">The link opens only {order.orchard.name}'s inspection sheet for {order.ref}. Sending a new link stops any earlier one.</p>
        <ErrorSummary errors={errors} />
        <TextField id="sl-email" label="Inspector email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errorFor(errors, "sl-email")} />
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "sendLink"}>
            Send link
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SettleDialog({ open, opener, onClose, order, split, onSettled }: DialogBase & { order: AnyOrder; split: Settlement; onSettled: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [paidOn, setPaidOn] = useState(humanDate(pacificDate(new Date())));
  const [errors, setErrors] = useState<FieldError[]>([]);
  // One key per settle attempt, kept across retries so a repeat never records a second payment.
  const [key] = useState(newKey);
  const name = order.orchard.name;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run("settle", {
      pending: `Settling ${name}…`,
      call: () => post<{ status: "settled" | "queued" }>(`/api/orders/${order.id}/settle`, { payment_received_on: isoOrRaw(paidOn) }, { "Idempotency-Key": key }),
      success: (_data, status) =>
        status === 202 ? "Settlement queued: billing is unreachable. It will finish on its own when billing returns." : `${name} settled.`,
      refusal: (failure) => (failure.error?.error === "drops_not_accepted" ? `Every drop must be accepted before ${name} can be settled.` : undefined),
      then: async () => {
        setErrors([]);
        await onSettled();
      },
    });
    if (!result.ok && result.status === 422) {
      setErrors(fieldErrors(result.error?.fields, { payment_received_on: "st-paid" }, "st-paid"));
    }
  };

  type Row = { key: string; party: string; hives: string; gross: string; payout: string };
  const rows: Row[] = [
        ...split.shares.map((share) => ({
          key: share.beekeeper.id,
          party: share.beekeeper.name,
          hives: String(share.hives),
          gross: money(share.gross_cents),
          payout: money(share.payout_cents),
        })),
        { key: "broker", party: `Broker commission (${(split.commission_bps / 100).toFixed(2)}%)`, hives: "", gross: "", payout: money(split.commission_cents) },
        { key: "total", party: "Orchard payable", hives: "", gross: money(split.payable_cents), payout: money(split.payable_cents) },
      ];

  return (
    <Dialog title="Settle orchard" open={open} opener={opener} onClose={onClose} wide>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label={`Settle ${name}`}>
        <p className="dialog-lede">
          {name} · {order.ref} · {split.rule_set.name}
        </p>
        <DataTable
          label="Settlement split"
          rows={rows}
          rowKey={(row) => row.key}
          columns={[
            { label: "Party", cell: (row) => row.party },
            { label: "Hives", cell: (row) => row.hives, numeric: true },
            { label: "Gross", cell: (row) => row.gross, numeric: true },
            { label: "Payout", cell: (row) => row.payout, numeric: true },
          ]}
        />
        <ErrorSummary errors={errors} />
        <TextField
          id="st-paid"
          label="Payment received"
          hint="Pacific date the grower's payment arrived"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          error={errorFor(errors, "st-paid")}
        />
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy === "settle"}>
            Settle
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CancelDialog({ open, opener, onClose, order, onDone }: DialogBase & { order: AnyOrder; onDone: () => Promise<void> }) {
  const { busy, run } = useAction();
  const cancel = async () => {
    await run("cancel", {
      pending: `Cancelling ${order.ref}…`,
      call: () => post<BrokerOrder>(`/api/orders/${order.id}/cancel`),
      success: () => `${order.ref} cancelled. Its deposit invoice is void.`,
      refusal: (failure) =>
        failure.error?.error === "drops_delivered"
          ? `${order.ref} has delivered drops and can't be cancelled.`
          : failure.status === 503
            ? `Billing is unreachable, so ${order.ref} is not cancelled. Try again in a minute.`
            : undefined,
      then: onDone,
    });
  };
  return (
    <Dialog title="Cancel order" open={open} opener={opener} onClose={onClose}>
      <p className="dialog-lede">
        Cancelling {order.ref} for {order.orchard.name} takes it off the beekeepers' open orders and voids its deposit invoice.
      </p>
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Keep order
        </Button>
        <Button variant="primary" busy={busy === "cancel"} onClick={cancel}>
          Cancel order {order.ref}
        </Button>
      </div>
    </Dialog>
  );
}
