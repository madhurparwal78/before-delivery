import { useRef, useState, type ChangeEvent, type RefObject } from "react";
import type { CaseKind, ClaimCase, Evidence, OrderLine, ReturnCase, TrialCase } from "../../shared/api";
import { ApiFail, api, newKey } from "../lib/api";
import { announce } from "../lib/store";
import { Dialog } from "./Dialog";
import { Choice, RadioGroup, TextArea } from "./Fields";

const REASONS = ["Changed my mind", "Wrong size", "Colour not as expected", "Arrived damaged", "Other"];
const COMPONENTS = ["Wheels", "Handle", "Shell", "Zipper", "Lock"];

interface Props {
  kind: CaseKind | null;
  line: OrderLine | null;
  openerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: () => void;
}

interface FormProps {
  line: OrderLine;
  onClose: () => void;
  onCreated: () => void;
}

/** Shared submit behaviour: first press disables, one Idempotency-Key from opening to closing. */
function useSubmit(onCreated: () => void, onClose: () => void) {
  const key = useRef(newKey());
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const run = async <T,>(send: (key: string) => Promise<T>, said: (created: T) => string) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setErrors({});
    setFailure(null);
    try {
      const created = await send(key.current);
      announce(said(created));
      onCreated();
      onClose();
    } catch (thrown) {
      if (thrown instanceof ApiFail && thrown.status === 422 && thrown.body.fields) setErrors(thrown.body.fields);
      else setFailure(thrown instanceof ApiFail ? thrown.message : "Something went wrong on our side. Try again.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return { run, pending, errors, failure };
}

function Failure({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="notice tone-red">
      {message}
    </div>
  ) : null;
}

function ReturnForm({ line, onClose, onCreated }: FormProps) {
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [outcome, setOutcome] = useState<"refund" | "exchange">("refund");
  const [exchange, setExchange] = useState("");
  const { run, pending, errors, failure } = useSubmit(onCreated, onClose);
  const options = line.exchange_options;
  const canExchange = options.length > 0;

  const submit = () =>
    run(
      (key) =>
        api.post<ReturnCase>(
          "/api/returns",
          { order_line_id: line.id, quantity: Number(quantity), reason, outcome, ...(outcome === "exchange" ? { exchange_sku: exchange } : {}) },
          key,
        ),
      (created) => `Return ${created.number} requested.`,
    );

  return (
    <form
      className="case-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Failure message={failure} />
      <RadioGroup name="reason" label="Reason" error={errors.reason}>
        {REASONS.map((r) => (
          <Choice key={r} name="reason" value={r} label={r} checked={reason === r} onChange={() => setReason(r)} />
        ))}
      </RadioGroup>
      <div className="field">
        <label htmlFor="f-quantity">Quantity to return</label>
        <input
          id="f-quantity"
          type="number"
          min={1}
          max={line.quantity}
          value={quantity}
          aria-describedby={errors.quantity ? "f-quantity-error" : undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuantity(event.target.value)}
        />
        {errors.quantity && (
          <p className="field-error" id="f-quantity-error">
            {errors.quantity}
          </p>
        )}
      </div>
      <RadioGroup name="outcome" label="Outcome" error={errors.outcome}>
        <Choice name="outcome" value="refund" label="Refund" checked={outcome === "refund"} onChange={() => setOutcome("refund")} />
        <Choice name="outcome" value="exchange" label="Exchange" disabled={!canExchange} checked={outcome === "exchange"} onChange={() => setOutcome("exchange")} />
      </RadioGroup>
      {outcome === "exchange" && (
        <RadioGroup name="exchange_sku" label="Exchange for" error={errors.exchange_sku}>
          {options.map((o) => (
            <Choice key={o.sku} name="exchange" value={o.sku} label={`${o.colour}, ${o.size}`} disabled={o.available === 0} checked={exchange === o.sku} onChange={() => setExchange(o.sku)} />
          ))}
        </RadioGroup>
      )}
      <div className="step-nav">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Submitting" : "Submit return request"}
        </button>
      </div>
    </form>
  );
}

function TrialForm({ line, onClose, onCreated }: FormProps) {
  const [note, setNote] = useState("");
  const { run, pending, errors, failure } = useSubmit(onCreated, onClose);
  return (
    <form
      className="case-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          (key) => api.post<TrialCase>("/api/trials", { order_line_id: line.id, note }, key),
          (created) => `Trial return ${created.number} requested.`,
        );
      }}
    >
      <Failure message={failure} />
      <TextArea name="note" label="How did it travel?" value={note} onChange={setNote} error={errors.note} />
      <div className="step-nav">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Submitting" : "Submit trial return"}
        </button>
      </div>
    </form>
  );
}

function ClaimForm({ line, onClose, onCreated }: FormProps) {
  const [component, setComponent] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [progress, setProgress] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const receipt = useRef<HTMLInputElement>(null);
  const { run, pending, errors, failure } = useSubmit(onCreated, onClose);

  const upload = async (event: ChangeEvent<HTMLInputElement>, kind: "photo" | "receipt") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    setProgress(`Uploading ${file.name}`);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    try {
      const stored = await api.upload<Evidence>("/api/warranty/evidence", form);
      setEvidence((list) => [...list, stored]);
      setProgress(`Uploaded ${file.name}`);
    } catch (thrown) {
      setProgress("");
      setUploadError(`${file.name}: ${thrown instanceof ApiFail ? (thrown.fields.file ?? thrown.message) : "Something went wrong on our side. Try again."}`);
    }
  };

  const registration = line.warranty?.registration_id ?? "";
  return (
    <form
      className="case-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          (key) =>
            api.post<ClaimCase>(
              "/api/warranty/claims",
              { registration_id: registration, component, description, evidence_ids: evidence.map((e) => e.id) },
              key,
            ),
          (created) => `Claim ${created.number} submitted.`,
        );
      }}
    >
      <Failure message={failure} />
      <RadioGroup name="component" label="Component" error={errors.component}>
        {COMPONENTS.map((c) => (
          <Choice key={c} name="component" value={c} label={c} checked={component === c} onChange={() => setComponent(c)} />
        ))}
      </RadioGroup>
      <TextArea name="description" label="What happened?" value={description} onChange={setDescription} error={errors.description} />
      <div className="field" id="f-evidence_ids" tabIndex={-1}>
        <span className="label">Evidence</span>
        <div className="evidence-actions">
          <button type="button" className="btn" onClick={() => photo.current?.click()}>
            Add photo
          </button>
          <button type="button" className="btn" onClick={() => receipt.current?.click()}>
            Add receipt
          </button>
        </div>
        <input ref={photo} type="file" aria-label="Evidence photo" accept="image/jpeg,image/png,image/webp" tabIndex={-1} className="sr-only" onChange={(event) => void upload(event, "photo")} />
        <input ref={receipt} type="file" aria-label="Receipt PDF" accept="application/pdf" tabIndex={-1} className="sr-only" onChange={(event) => void upload(event, "receipt")} />
        <ul aria-label="Evidence" className="evidence-list">
          {evidence.map((e) => (
            <li key={e.id}>{e.filename} — Evidence stored</li>
          ))}
        </ul>
        <div role="status" aria-label="Upload progress" className="muted">
          {progress}
        </div>
        {uploadError && (
          <div role="alert" className="notice tone-red">
            {uploadError}
          </div>
        )}
        {errors.evidence_ids && <p className="field-error">{errors.evidence_ids}</p>}
      </div>
      <div className="step-nav">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Submitting" : "Submit claim"}
        </button>
      </div>
    </form>
  );
}

const TITLES: Record<CaseKind, string> = { return: "Request a return", trial: "Send back from trial", claim: "Warranty claim" };

/** The three case dialogs; the form inside mounts on open, so it starts fresh with a new key. */
export function CaseDialogs({ kind, line, openerRef, onClose, onCreated }: Props) {
  const shown = kind ?? "return";
  return (
    <Dialog title={TITLES[shown]} kind="modal" open={kind !== null && line !== null} onClose={onClose} openerRef={openerRef}>
      {line && kind === "return" && <ReturnForm line={line} onClose={onClose} onCreated={onCreated} />}
      {line && kind === "trial" && <TrialForm line={line} onClose={onClose} onCreated={onCreated} />}
      {line && kind === "claim" && <ClaimForm line={line} onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}
