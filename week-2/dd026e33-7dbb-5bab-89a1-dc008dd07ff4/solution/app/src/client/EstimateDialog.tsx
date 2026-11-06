// The Estimate dialog (brief: Jobs and job page; Interactions › Estimate versions). New estimates
// post a draft; edits send the version the dialog was opened with. A stale version keeps the dialog
// open with every value and focus on Save estimate.
import { useEffect, useRef, useState } from "react";
import type { Car, Job } from "../shared/api.js";
import { LINE_KINDS, LINE_KIND_LABEL, type LineKind } from "../shared/domain.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "./api.js";
import { JOB_MOVED_ON, SIGNED_IN_AGAIN } from "./labels.js";
import { Dialog } from "./ui/Dialog.js";
import { ErrorSummary, FieldError, summaryOf } from "./ui/Feedback.js";

interface DraftLine {
  key: number;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
}

let nextLineKey = 1;

function blankLine(): DraftLine {
  return { key: nextLineKey++, kind: "part", description: "", quantity: "", unit_price: "" };
}

function fieldId(field: string): string {
  return `estimate-${field.replace(/[^a-z0-9_]/g, "-")}`;
}

export function EstimateDialog({
  job,
  onClose,
  onSaved,
  say,
}: {
  /** The job as the page last read it, or null for a new estimate. */
  job: Job | null;
  onClose: () => void;
  onSaved: (job: Job) => void;
  say: (text: string, tone?: "info" | "error") => void;
}): JSX.Element {
  const [cars, setCars] = useState<Car[]>([]);
  const [carId, setCarId] = useState(job?.car.id ?? "");
  const [title, setTitle] = useState(job?.title ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    job
      ? job.lines.map((line) => ({
          key: nextLineKey++,
          kind: line.kind,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.kind === "labour" ? "" : line.unit_price,
        }))
      : [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const version = useRef(job?.version ?? 0);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (job) return;
    get<{ cars: Car[] }>("/api/cars").then(
      (answer) => {
        const stored = answer.cars
          .filter((car) => car.status === "stored" && car.bay)
          .sort((a, b) => (a.bay?.code ?? "").localeCompare(b.bay?.code ?? ""));
        setCars(stored);
        setCarId((current) => current || (stored[0]?.id ?? ""));
      },
      () => undefined,
    );
  }, [job]);

  const update = (key: number, patch: Partial<DraftLine>): void =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const save = async (): Promise<void> => {
    say("Saving...");
    const body = {
      title,
      lines: lines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.kind === "labour" ? null : line.unit_price,
      })),
    };
    try {
      const answer = job
        ? await request<{ job: Job }>(`/api/jobs/${job.id}`, { method: "PATCH", body, ifMatch: version.current })
        : await request<{ job: Job }>("/api/jobs", { method: "POST", body: { car_id: carId, ...body } });
      setErrors({});
      onSaved(answer.data.job);
      say(`Estimate ${answer.data.job.number} saved.`);
    } catch (error) {
      const code = errorCode(error);
      if (code === "estimate_changed" && job) {
        say(`Estimate ${job.number} was changed by someone else. Your edits are kept; reload to see the latest.`, "error");
        saveRef.current?.focus();
      } else if (code === "invalid_transition") say(JOB_MOVED_ON, "error");
      else if (error instanceof HttpError && error.status === 422) {
        setErrors(error.fields);
        say(Object.values(error.fields)[0] ?? "", "error");
      } else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (error instanceof NoAnswer) say("No answer from the server. Nothing was saved; press Save estimate again.", "error");
      else if (code) say(code === "job_already_open" ? "This car already has an open job." : "This car is not in a bay.", "error");
    }
  };

  const order = ["car_id", "title", "lines", ...lines.flatMap((_, i) => [`lines[${i}].description`, `lines[${i}].quantity`, `lines[${i}].unit_price`])];

  return (
    <Dialog title="Estimate" onClose={onClose} wide>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorSummary items={summaryOf(errors, order)} idFor={fieldId} />
        <div className="field">
          <label htmlFor={fieldId("car_id")}>Car</label>
          <select id={fieldId("car_id")} value={carId} disabled={job !== null} onChange={(event) => setCarId(event.target.value)}>
            {job ? (
              <option value={job.car.id}>{job.car.name}</option>
            ) : (
              cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))
            )}
          </select>
          <FieldError id="estimate-car-error" message={errors.car_id} />
        </div>
        <div className="field">
          <label htmlFor={fieldId("title")}>Job title</label>
          <input id={fieldId("title")} type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
          <FieldError id="estimate-title-error" message={errors.title} />
        </div>
        <fieldset className="estimate-lines" id={fieldId("lines")} tabIndex={-1}>
          <legend>Lines</legend>
          <FieldError id="estimate-lines-error" message={errors.lines} />
          {lines.map((line, index) => (
            <div className="estimate-line" key={line.key}>
              <div className="field">
                <label htmlFor={fieldId(`lines[${index}].kind`)}>Line kind</label>
                <select
                  id={fieldId(`lines[${index}].kind`)}
                  value={line.kind}
                  onChange={(event) => update(line.key, { kind: event.target.value as LineKind })}
                >
                  {LINE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {LINE_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field line-description">
                <label htmlFor={fieldId(`lines[${index}].description`)}>Description</label>
                <input
                  id={fieldId(`lines[${index}].description`)}
                  type="text"
                  value={line.description}
                  onChange={(event) => update(line.key, { description: event.target.value })}
                />
                <FieldError id={`${fieldId(`lines[${index}].description`)}-error`} message={errors[`lines[${index}].description`]} />
              </div>
              <div className="field">
                <label htmlFor={fieldId(`lines[${index}].quantity`)}>Quantity</label>
                <input
                  id={fieldId(`lines[${index}].quantity`)}
                  type="text"
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                />
                <FieldError id={`${fieldId(`lines[${index}].quantity`)}-error`} message={errors[`lines[${index}].quantity`]} />
              </div>
              {line.kind === "labour" ? (
                <p className="sub labour-rate">Billed at the house rate</p>
              ) : (
                <div className="field">
                  <label htmlFor={fieldId(`lines[${index}].unit_price`)}>Unit price (CHF)</label>
                  <input
                    id={fieldId(`lines[${index}].unit_price`)}
                    type="text"
                    inputMode="decimal"
                    value={line.unit_price}
                    onChange={(event) => update(line.key, { unit_price: event.target.value })}
                  />
                  <FieldError id={`${fieldId(`lines[${index}].unit_price`)}-error`} message={errors[`lines[${index}].unit_price`]} />
                </div>
              )}
              <button
                type="button"
                className="button small"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => setLines(lines.filter((entry) => entry.key !== line.key))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="button" onClick={() => setLines([...lines, blankLine()])}>
            Add line
          </button>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button ref={saveRef} type="submit" className="button primary">
            Save estimate
          </button>
        </div>
      </form>
    </Dialog>
  );
}
