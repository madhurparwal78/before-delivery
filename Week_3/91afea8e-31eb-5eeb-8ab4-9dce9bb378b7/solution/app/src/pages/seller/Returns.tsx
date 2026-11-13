import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Empty } from "../../components/Empty";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { Failure, Loading, StaffGate, useResource } from "./staff";

export interface SellerReturn {
  return_id: string;
  state: "requested" | "picked" | "declined";
  quantity: number;
  refund_paise: number;
  decline_reason: string | null;
  shipment_id: string;
  line_id: string;
  title: string;
  reason: string;
}

const REASON_MAX = 500;

function DeclineDialog({ id, onClose, onDeclined }: { id: string; onClose: () => void; onDeclined: (next: SellerReturn) => void }): ReactNode {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [other, setOther] = useState("");

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setOther("");
    try {
      onDeclined(await post<SellerReturn>(`/api/seller/returns/${id}/decline`, { reason }));
      return;
    } catch (error) {
      const field = error instanceof ApiFailure ? error.body.errors?.reason : undefined;
      if (field) setProblem(field);
      else setOther(failureMessage(error));
    }
    setBusy(false);
  };

  return (
    <Dialog title="Decline return" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={`reason-${id}`}>Reason</label>
          <textarea id={`reason-${id}`} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={problem ? true : undefined} aria-describedby={problem ? `reason-error-${id}` : undefined} />
          <span className={`counter${[...reason].length > REASON_MAX ? " counter--over" : ""}`}>
            {[...reason].length}/{REASON_MAX}
          </span>
          {problem && (
            <p className="field-error" id={`reason-error-${id}`}>
              {problem}
            </p>
          )}
        </div>
        {other && (
          <p className="field-error" role="alert">
            {other}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="primary" busy={busy}>
            Send decision
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Card({ item, onChange }: { item: SellerReturn; onChange: (next: SellerReturn) => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [dialog, setDialog] = useState(false);
  const [settled, setSettled] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (settled) heading.current?.focus();
  }, [settled]);

  const approve = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      onChange(await post<SellerReturn>(`/api/seller/returns/${item.return_id}/pickup`, {}));
    } catch (error) {
      setProblem(failureMessage(error));
    }
    setBusy(false);
  };

  return (
    <section className="card card--black shipment-card" aria-label={`Return ${item.return_id}`}>
      <h2 className="shipment-card__title" tabIndex={-1} ref={heading}>
        {item.title}
      </h2>
      <ul className="chips">
        <li>
          <span className={`chip ${item.state === "requested" ? "chip--yellow" : item.state === "picked" ? "chip--accent" : "chip--pink"}`}>{item.state}</span>
        </li>
      </ul>
      <p className="staff-value">
        {item.quantity} {item.quantity === 1 ? "unit" : "units"} from {item.shipment_id}
      </p>
      {item.reason !== "" && <p className="muted">Shopper says: {item.reason}</p>}
      {item.state === "picked" && <p className="bill amount">{rupees(item.refund_paise)} refunded</p>}
      {item.state === "declined" && item.decline_reason && <p className="muted">Declined: {item.decline_reason}</p>}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {item.state === "requested" && (
        <div className="shipment-card__actions">
          <Button variant="primary" busy={busy} onClick={() => void approve()}>
            Approve pickup
          </Button>
          <Button onClick={() => setDialog(true)}>Decline return</Button>
        </div>
      )}
      {dialog && (
        <DeclineDialog
          id={item.return_id}
          onClose={() => setDialog(false)}
          onDeclined={(next) => {
            setDialog(false);
            setSettled(true);
            onChange(next);
          }}
        />
      )}
    </section>
  );
}

function ReturnsPage(): ReactNode {
  useTitle("returns");
  const { resource, update } = useResource<{ returns: SellerReturn[] }>("/api/seller/returns");
  if (resource.phase === "failed") return <Failure status={resource.status} message={resource.message} />;
  const items = resource.phase === "ready" ? resource.data.returns : null;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>returns</h1>
      </section>
      {items === null && <Loading />}
      {items?.length === 0 && (
        <Empty tone="black" sign="box">
          no returns to handle.
        </Empty>
      )}
      {items && items.length > 0 && (
        <section className="panel panel--yellow staff-results">
          <div className="card-grid">
            {items.map((item) => (
              <Card
                key={item.return_id}
                item={item}
                onChange={(next) => update((data) => ({ returns: data.returns.map((row) => (row.return_id === next.return_id ? next : row)) }))}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function Returns(): ReactNode {
  return (
    <StaffGate role="seller">
      <ReturnsPage />
    </StaffGate>
  );
}
