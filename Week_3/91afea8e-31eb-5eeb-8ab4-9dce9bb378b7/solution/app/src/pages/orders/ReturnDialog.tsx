import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import type { ShipmentLine } from "./types";

interface Props {
  line: ShipmentLine;
  onClose: () => void;
  /** The server's estimate of the refund on pickup, in paise. */
  onRequested: (refundPaise: number) => void;
}

export function ReturnDialog({ line, onClose, onRequested }: Props): ReactNode {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    try {
      const made = await post<{ refund_estimate_paise: number }>("/api/returns", { shipment_line_id: line.line_id, quantity: Number(quantity), reason });
      onRequested(made.refund_estimate_paise);
      onClose();
    } catch (failure) {
      const fields = failure instanceof ApiFailure && failure.body.errors ? Object.values(failure.body.errors) : [];
      setProblems(fields.length > 0 ? fields : [failureMessage(failure)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Return item" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate className="stack">
        <p className="muted">{line.title}</p>
        <div className="field">
          <label htmlFor="return-quantity">Quantity to return</label>
          <input id="return-quantity" type="number" inputMode="numeric" min={1} max={line.quantity} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="return-reason">Reason</label>
          <textarea id="return-reason" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        {problems.length > 0 && (
          <div role="alert" className="ord__problems">
            {problems.map((text) => (
              <p key={text} className="field-error">
                {text}
              </p>
            ))}
          </div>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="primary" busy={busy}>
            Request return
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}
