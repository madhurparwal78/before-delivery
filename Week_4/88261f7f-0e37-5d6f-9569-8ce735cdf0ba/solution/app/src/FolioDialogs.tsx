import { useEffect, useState } from "react";
import type { Entry, Folio } from "../shared/api";
import { digitsToInteger } from "../shared/digits";
import { formatMoney, parseDollars } from "../shared/money";
import { MAX_SHARES, splitShares, validPercents } from "../shared/split";
import { post, refusalText } from "./api";
import { Layer } from "./dialogs";
import { useBusy } from "./hooks";
import { FieldMessage, FormErrors, type FieldErrors } from "./ui";

const SPLIT_DELAY_MS = 150;
const LETTERS = "ABCD";

type FolioSay = (text: string) => void;

interface Shared { open: boolean; onClose: () => void; say: FolioSay; onDone: () => void }

export function SplitDialog({ entry, open, onClose, say, onDone }: Shared & { entry: Entry | null }) {
  const [fields, setFields] = useState<string[]>(["", ""]);
  const [shown, setShown] = useState<string[]>(["", ""]);
  const [message, setMessage] = useState("");
  const [busy, guard] = useBusy();

  useEffect(() => {
    if (open) {
      setFields(["", ""]);
      setShown(["", ""]);
      setMessage("");
    }
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(fields), SPLIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [fields]);

  const percents = shown.map((text) => (/^\d{1,3}$/.test(text.trim()) ? digitsToInteger(text.trim()) : Number.NaN));
  const shares = entry && validPercents(percents) ? splitShares(entry.amountCents, percents) : null;

  const apply = (): void =>
    void guard(async () => {
      if (!entry) return;
      const wanted = fields.map((text) => (/^\d{1,3}$/.test(text.trim()) ? digitsToInteger(text.trim()) : Number.NaN));
      if (!validPercents(wanted)) {
        setMessage("Enter 2 to 4 whole percentages that add up to 100.");
        return;
      }
      setMessage("");
      say("Splitting charge…");
      const answer = await post<{ folios: Folio[] }>(`/api/entries/${entry.id}/split`, { percents: wanted });
      if (!answer.ok) {
        say(refusalText(answer));
        setMessage(refusalText(answer));
        return;
      }
      say(`Split ${formatMoney(entry.amountCents)} across ${wanted.length} folios.`);
      onDone();
      onClose();
    });

  return (
    <Layer name="Split charge" open={open} onClose={onClose} className="dialog">
      <h2>Split charge</h2>
      <p className="muted">{entry ? `${entry.description} · ${formatMoney(entry.amountCents)}` : ""}</p>
      {message ? <FormErrors errors={{ percents: message }} labels={{ percents: "Percents" }} onFollow={() => undefined} /> : null}
      <div className="field-grid">
        {fields.map((text, index) => (
          <div key={LETTERS[index]} className="field">
            <label htmlFor={`split-${index}`}>{`Folio ${LETTERS[index]} percent`}</label>
            <input
              id={`split-${index}`}
              type="number"
              value={text}
              onChange={(event) => setFields((previous) => previous.map((value, at) => (at === index ? event.target.value : value)))}
            />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => fields.length < MAX_SHARES && setFields((previous) => [...previous, ""])}>Add payer</button>
      <table aria-label="Split preview" className="ledger">
        <thead>
          <tr><th scope="col">Folio</th><th scope="col" className="money-head">Percent</th><th scope="col" className="money-head">Share</th></tr>
        </thead>
        <tbody>
          {fields.map((_, index) => {
            const text = shown[index] ?? "";
            return (
              <tr key={LETTERS[index]}>
                <td>{`Folio ${LETTERS[index]}`}</td>
                <td className="money">{text.trim() === "" ? "—" : `${text.trim()}%`}</td>
                <td className="money">{shares ? formatMoney(shares[index] ?? 0) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="button-row">
        <button type="button" className="primary" aria-busy={busy} onClick={apply}>Apply split</button>
        <button type="button" className="quiet" onClick={onClose}>Close</button>
      </div>
    </Layer>
  );
}

export function PaymentDialog({ folio, open, onClose, say, onDone }: Shared & { folio: Folio | null }) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, guard] = useBusy();

  useEffect(() => {
    if (open) {
      setMethod("cash");
      setAmount("");
      setReference("");
      setErrors({});
    }
  }, [open]);

  const save = (): void =>
    void guard(async () => {
      if (!folio) return;
      setErrors({});
      say("Saving payment…");
      const cents = parseDollars(amount) ?? 0;
      const answer = await post<Entry>(`/api/folios/${folio.id}/payments`, { method, amountCents: cents, reference });
      if (!answer.ok) {
        setErrors(answer.errors);
        say(refusalText(answer));
        return;
      }
      say(`Payment of ${formatMoney(cents)} recorded.`);
      onDone();
      onClose();
    });

  return (
    <Layer name="Record payment" open={open} onClose={onClose} className="dialog narrow">
      <h2>Record payment</h2>
      <FormErrors errors={errors} labels={{ amountCents: "Amount", reference: "Terminal reference", method: "Payment method" }} onFollow={() => undefined} />
      <div className="field">
        <label htmlFor="payment-method">Payment method</label>
        <select id="payment-method" value={method} onChange={(event) => setMethod(event.target.value)}>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="payment-amount">Amount</label>
        <input id="payment-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <FieldMessage message={errors.amountCents} />
      </div>
      <div className="field">
        <label htmlFor="payment-reference">Terminal reference</label>
        <input id="payment-reference" type="text" value={reference} onChange={(event) => setReference(event.target.value)} />
        <FieldMessage message={errors.reference} />
      </div>
      <div className="button-row">
        <button type="button" className="primary" aria-busy={busy} onClick={save}>Save payment</button>
        <button type="button" className="quiet" onClick={onClose}>Close</button>
      </div>
    </Layer>
  );
}

export function ChargeDialog({ folio, open, onClose, say, onDone }: Shared & { folio: Folio | null }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, guard] = useBusy();

  useEffect(() => {
    if (open) {
      setDescription("");
      setAmount("");
      setErrors({});
    }
  }, [open]);

  const save = (): void =>
    void guard(async () => {
      if (!folio) return;
      setErrors({});
      say("Saving charge…");
      const cents = parseDollars(amount) ?? 0;
      const answer = await post<Entry>(`/api/folios/${folio.id}/charges`, { description, amountCents: cents });
      if (!answer.ok) {
        setErrors(answer.errors);
        say(refusalText(answer));
        return;
      }
      say(`Charge of ${formatMoney(cents)} added.`);
      onDone();
      onClose();
    });

  return (
    <Layer name="Add charge" open={open} onClose={onClose} className="dialog narrow">
      <h2>Add charge</h2>
      <FormErrors errors={errors} labels={{ description: "Description", amountCents: "Amount" }} onFollow={() => undefined} />
      <div className="field">
        <label htmlFor="charge-description">Description</label>
        <input id="charge-description" type="text" value={description} onChange={(event) => setDescription(event.target.value)} />
        <FieldMessage message={errors.description} />
      </div>
      <div className="field">
        <label htmlFor="charge-amount">Amount</label>
        <input id="charge-amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <FieldMessage message={errors.amountCents} />
      </div>
      <div className="button-row">
        <button type="button" className="primary" aria-busy={busy} onClick={save}>Save charge</button>
        <button type="button" className="quiet" onClick={onClose}>Close</button>
      </div>
    </Layer>
  );
}

export function MoveEntryDialog({ entry, targets, open, onClose, say, onDone }: Shared & { entry: Entry | null; targets: Folio[] }) {
  const [target, setTarget] = useState("");
  const [busy, guard] = useBusy();

  useEffect(() => {
    if (open) setTarget("");
  }, [open]);

  const save = (): void =>
    void guard(async () => {
      if (!entry) return;
      say("Moving entry…");
      const answer = await post<{ folios: Folio[] }>(`/api/entries/${entry.id}/move`, { toFolioId: target });
      if (!answer.ok) {
        say(refusalText(answer));
        return;
      }
      say(`Entry moved to ${answer.data.folios.find((folio) => folio.id === target)?.name ?? "folio"}.`);
      onDone();
      onClose();
    });

  return (
    <Layer name="Move entry" open={open} onClose={onClose} className="dialog narrow">
      <h2>Move entry</h2>
      <p className="muted">{entry?.description}</p>
      <div className="field">
        <label htmlFor="move-target">To folio</label>
        <select id="move-target" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose</option>
          {targets.map((folio) => <option key={folio.id} value={folio.id}>{folio.name}</option>)}
        </select>
      </div>
      <div className="button-row">
        <button type="button" className="primary" aria-busy={busy} onClick={save}>Save move</button>
        <button type="button" className="quiet" onClick={onClose}>Close</button>
      </div>
    </Layer>
  );
}

