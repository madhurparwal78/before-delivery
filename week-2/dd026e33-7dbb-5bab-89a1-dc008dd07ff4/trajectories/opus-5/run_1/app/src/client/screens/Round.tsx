import { useRef, useState, type ReactNode } from 'react';
import type { CareRoundCar, Entry, Startup } from '../../shared/types';
import { PRESSURE_UNIT_LABEL, pressureReading, voltageReading } from '../../shared/units';
import { NO_ANSWER, IDEMPOTENCY_CONFLICT, startupLabel } from '../copy';
import { api, errorCode, fieldErrors } from '../lib/api';
import {
  useFirstLoad,
  useIsNarrow,
  useReread,
  useStatus,
  useSubmit,
  type StatusHandle,
} from '../lib/hooks';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import { ErrorSummary, FieldMessage, StatusRegion, type FieldError } from '../components/Status';

interface OpenEntry {
  readonly carId: string;
  readonly carName: string;
}

export function RoundScreen(): ReactNode {
  const narrow = useIsNarrow();
  const { units } = useSession();
  const status = useStatus();
  const [cars, setCars] = useState<CareRoundCar[]>([]);
  const [open, setOpen] = useState<OpenEntry | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const load = async (): Promise<void> => {
    const outcome = await api<{ cars: CareRoundCar[] }>('/api/care-round');
    if (outcome.kind === 'ok') setCars(outcome.body.cars);
  };

  useFirstLoad(load);
  useReread(load, 15_000);

  const overdue = cars.filter((entry) => entry.startup.status === 'overdue');
  const rest = cars.filter((entry) => entry.startup.status !== 'overdue');

  const rows = [...overdue, ...rest];

  return (
    <div className="screen round-screen">
      <h1 tabIndex={-1} ref={headingRef}>
        Care round
      </h1>
      {narrow ? (
        <ul className="round-list" aria-label="Care round">
          {rows.map((entry) => (
            <li
              key={entry.car.id}
              className={`round-card${open?.carId === entry.car.id ? ' in-progress' : ''}`}
            >
              <RoundRowBody entry={entry} units={units.pressure} />
              <button
                type="button"
                data-round-open={entry.car.id}
                onClick={() => setOpen({ carId: entry.car.id, carName: entry.car.name })}
              >
                {`Log round entry for ${entry.car.name}`}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <table className="data-table">
          <caption className="visually-hidden">Care round</caption>
          <thead>
            <tr>
              <th scope="col">Car</th>
              <th scope="col">Bay</th>
              <th scope="col">Start-up</th>
              <th scope="col">Battery</th>
              <th scope="col">Flags</th>
              <th scope="col">Entry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr
                key={entry.car.id}
                className={open?.carId === entry.car.id ? 'in-progress' : undefined}
              >
                <th scope="row">{entry.car.name}</th>
                <td className="mono">{entry.bay_code}</td>
                <td>{startupLabel(entry.startup)}</td>
                <td className="mono">
                  {entry.last_entry?.battery_v === null || entry.last_entry === null
                    ? '—'
                    : voltageReading(entry.last_entry.battery_v)}
                </td>
                <td>
                  {(entry.last_entry?.flags ?? []).map((flag) => (
                    <span className="chip chip-flag" key={flag}>
                      {flag === 'battery_low' ? 'battery low' : 'tyre pressure off'}
                    </span>
                  ))}
                </td>
                <td>
                  <button
                    type="button"
                    data-round-open={entry.car.id}
                    onClick={() => setOpen({ carId: entry.car.id, carName: entry.car.name })}
                  >
                    {`Log round entry for ${entry.car.name}`}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open === null ? null : (
        <RoundEntryDialog
          key={open.carId}
          carId={open.carId}
          carName={open.carName}
          status={status}
          pressureUnit={units.pressure}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void load();
          }}
          fallbackFocus={() => headingRef.current}
        />
      )}
      <StatusRegion name="Round updates" status={status} />
    </div>
  );
}

function RoundRowBody({
  entry,
  units,
}: {
  entry: CareRoundCar;
  units: 'bar' | 'psi';
}): ReactNode {
  return (
    <div className="round-card-body">
      <p className="round-car">{entry.car.name}</p>
      <p className="mono">{entry.bay_code}</p>
      <p>{startupLabel(entry.startup)}</p>
      <p className="mono">
        {entry.last_entry?.battery_v === null || entry.last_entry === null
          ? '—'
          : voltageReading(entry.last_entry.battery_v)}
      </p>
      <p>
        {(entry.last_entry?.tyres_bar === null || entry.last_entry === null
          ? []
          : [
              entry.last_entry.tyres_bar.fl,
              entry.last_entry.tyres_bar.fr,
              entry.last_entry.tyres_bar.rl,
              entry.last_entry.tyres_bar.rr,
            ]
        )
          .map((bar) => pressureReading(bar, units))
          .join(' / ')}
      </p>
      <p>
        {(entry.last_entry?.flags ?? []).map((flag) => (
          <span className="chip chip-flag" key={flag}>
            {flag === 'battery_low' ? 'battery low' : 'tyre pressure off'}
          </span>
        ))}
      </p>
    </div>
  );
}

interface RoundEntryResponse {
  entry: Entry;
  startup: Startup;
  message: string;
}

function RoundEntryDialog({
  carId,
  carName,
  status,
  pressureUnit,
  onClose,
  onSaved,
  fallbackFocus,
}: {
  carId: string;
  carName: string;
  status: StatusHandle;
  pressureUnit: 'bar' | 'psi';
  onClose: () => void;
  onSaved: () => void;
  fallbackFocus: () => HTMLElement | null;
}): ReactNode {
  const [started, setStarted] = useState(false);
  const [battery, setBattery] = useState('');
  const [tyres, setTyres] = useState({ fl: '', fr: '', rl: '', rr: '' });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useSubmit<RoundEntryResponse>({
    status,
    pendingText: 'Saving round entry...',
    idempotent: true,
    noAnswerText: NO_ANSWER.roundEntry,
    onOk: (body) => {
      status.success(body.message);
      onSaved();
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'car_not_stored') {
        status.error('This car is no longer in a bay.');
        onClose();
        return;
      }
      if (code === 'idempotency_conflict') {
        status.error(IDEMPOTENCY_CONFLICT);
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

  const anyTyre = Object.values(tyres).some((value) => value.trim() !== '');
  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `round-${field}`,
  }));

  return (
    <Dialog
      name={`Round entry: ${carName}`}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
    >
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run((key) =>
            api<RoundEntryResponse>(`/api/cars/${carId}/care-entries`, {
              idempotencyKey: key,
              body: {
                started,
                battery_v: battery.trim() === '' ? null : battery.trim(),
                tyres: anyTyre ? { unit: pressureUnit, ...tyres } : null,
                note,
              },
            }),
          );
        }}
      >
        <label className="checkbox">
          <input
            type="checkbox"
            checked={started}
            onChange={(event) => setStarted(event.target.checked)}
          />
          Started the engine
        </label>
        <label htmlFor="round-battery_v">Battery voltage (V)</label>
        <input
          id="round-battery_v"
          value={battery}
          onChange={(event) => setBattery(event.target.value)}
        />
        <FieldMessage id="round-battery_v-error" message={errors.battery_v} />
        {(
          [
            ['fl', 'Front left tyre'],
            ['fr', 'Front right tyre'],
            ['rl', 'Rear left tyre'],
            ['rr', 'Rear right tyre'],
          ] as const
        ).map(([corner, label]) => (
          <div key={corner} className="field">
            <label htmlFor={`round-tyre-${corner}`}>
              {`${label} (${PRESSURE_UNIT_LABEL[pressureUnit]})`}
            </label>
            <input
              id={`round-tyre-${corner}`}
              value={tyres[corner]}
              onChange={(event) => setTyres({ ...tyres, [corner]: event.target.value })}
            />
          </div>
        ))}
        <FieldMessage id="round-tyres-error" message={errors.tyres} />
        <FieldMessage id="round-entry-error" message={errors.entry} />
        <label htmlFor="round-note">Note</label>
        <input id="round-note" value={note} onChange={(event) => setNote(event.target.value)} />
        <FieldMessage id="round-note-error" message={errors.note} />
        <button type="submit" className="primary" disabled={submit.busy}>
          Save entry
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Dialog>
  );
}
