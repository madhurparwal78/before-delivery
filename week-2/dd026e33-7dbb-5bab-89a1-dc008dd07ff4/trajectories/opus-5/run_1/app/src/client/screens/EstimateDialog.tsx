import { useState, type ReactNode } from 'react';
import { LINE_KIND_LABEL, type Car, type Job, type LineKind } from '../../shared/types';
import { MOVED_ON } from '../copy';
import { api, errorCode, fieldErrors } from '../lib/api';
import { useFirstLoad, useSubmit, type StatusHandle } from '../lib/hooks';
import { Dialog } from '../components/Dialog';
import { ErrorSummary, FieldMessage, type FieldError } from '../components/Status';

interface DraftLine {
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
}

function toDraft(job: Job): DraftLine[] {
  return job.lines.map((line) => ({
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.kind === 'labour' ? '' : line.unit_price,
  }));
}

/** The dialog holds the job version it opened with; re-reads never change it. */
export function EstimateDialog({
  status,
  job,
  onClose,
  onSaved,
}: {
  status: StatusHandle;
  job: Job | null;
  onClose: () => void;
  onSaved(job: Job): void;
}): ReactNode {
  const [cars, setCars] = useState<Car[]>([]);
  const [carId, setCarId] = useState(job?.car.id ?? '');
  const [title, setTitle] = useState(job?.title ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    job === null
      ? [{ kind: 'part', description: '', quantity: '1', unit_price: '' }]
      : toDraft(job),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const version = job?.version ?? null;

  useFirstLoad(async () => {
    if (job !== null) return;
    const outcome = await api<{ cars: Car[] }>('/api/cars');
    if (outcome.kind === 'ok') {
      const stored = outcome.body.cars.filter((car) => car.status === 'stored');
      setCars(stored);
      setCarId((current) => (current === '' ? (stored[0]?.id ?? '') : current));
    }
  });

  const submit = useSubmit<{ job: Job }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(`Estimate ${body.job.number} saved.`);
      onSaved(body.job);
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'estimate_changed') {
        status.error(
          `Estimate ${job?.number ?? ''} was changed by someone else. Your edits are kept; reload to see the latest.`,
        );
        return;
      }
      if (code === 'invalid_transition') {
        status.error(MOVED_ON);
        return;
      }
      if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
        return;
      }
      status.error('That could not be saved.');
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `estimate-${field.replace(/[[\].]/g, '-')}`,
  }));

  const body = {
    car_id: carId,
    title,
    lines: lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.kind === 'labour' ? null : line.unit_price,
    })),
  };

  return (
    <Dialog name="Estimate" onClose={onClose}>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run(() =>
            job === null
              ? api<{ job: Job }>('/api/jobs', { body })
              : api<{ job: Job }>(`/api/jobs/${job.id}`, {
                  method: 'PATCH',
                  body: { title, lines: body.lines },
                  ifMatch: version,
                }),
          );
        }}
      >
        {job === null ? (
          <>
            <label htmlFor="estimate-car">Car</label>
            <select
              id="estimate-car"
              value={carId}
              onChange={(event) => setCarId(event.target.value)}
            >
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label htmlFor="estimate-title">Job title</label>
        <input
          id="estimate-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldMessage id="estimate-title-error" message={errors.title} />
        <FieldMessage id="estimate-lines-error" message={errors.lines} />
        {lines.map((line, index) => (
          <fieldset key={index} className="estimate-line">
            <legend>{`Line ${String(index + 1)}`}</legend>
            <label htmlFor={`estimate-line-kind-${String(index)}`}>Line kind</label>
            <select
              id={`estimate-line-kind-${String(index)}`}
              aria-label="Line kind"
              value={line.kind}
              onChange={(event) => {
                const next = [...lines];
                next[index] = { ...line, kind: event.target.value as LineKind };
                setLines(next);
              }}
            >
              {(Object.keys(LINE_KIND_LABEL) as LineKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {LINE_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
            <label htmlFor={`estimate-line-description-${String(index)}`}>Description</label>
            <input
              id={`estimate-line-description-${String(index)}`}
              aria-label="Description"
              value={line.description}
              onChange={(event) => {
                const next = [...lines];
                next[index] = { ...line, description: event.target.value };
                setLines(next);
              }}
            />
            <FieldMessage
              id={`estimate-lines-${String(index)}-description-error`}
              message={errors[`lines[${index}].description`]}
            />
            <label htmlFor={`estimate-line-quantity-${String(index)}`}>Quantity</label>
            <input
              id={`estimate-line-quantity-${String(index)}`}
              aria-label="Quantity"
              value={line.quantity}
              onChange={(event) => {
                const next = [...lines];
                next[index] = { ...line, quantity: event.target.value };
                setLines(next);
              }}
            />
            <FieldMessage
              id={`estimate-lines-${String(index)}-quantity-error`}
              message={errors[`lines[${index}].quantity`]}
            />
            {line.kind === 'labour' ? null : (
              <>
                <label htmlFor={`estimate-line-price-${String(index)}`}>Unit price (CHF)</label>
                <input
                  id={`estimate-line-price-${String(index)}`}
                  aria-label="Unit price (CHF)"
                  value={line.unit_price}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, unit_price: event.target.value };
                    setLines(next);
                  }}
                />
                <FieldMessage
                  id={`estimate-lines-${String(index)}-unit_price-error`}
                  message={errors[`lines[${index}].unit_price`]}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => setLines(lines.filter((_, position) => position !== index))}
            >
              {`Remove line ${String(index + 1)}`}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            setLines([...lines, { kind: 'part', description: '', quantity: '1', unit_price: '' }])
          }
        >
          Add line
        </button>
        <button type="submit" className="primary" disabled={submit.busy}>
          Save estimate
        </button>
      </form>
    </Dialog>
  );
}
