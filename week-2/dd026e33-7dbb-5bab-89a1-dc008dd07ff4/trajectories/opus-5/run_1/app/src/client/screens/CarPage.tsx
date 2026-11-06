import { useRef, useState, type ReactNode } from 'react';
import type { Bay, CarDetail, Item, Photo, Report } from '../../shared/types';
import { ITEM_KIND_LABEL, type ItemKind } from '../../shared/types';
import { distanceReading, pressureReading, voltageReading } from '../../shared/units';
import { momentLabel } from '../../shared/zurich';
import {
  NOT_FOUND_HEADING,
  STORAGE_DOWN_UPLOAD,
  UPLOAD_CUT_OFF,
  UPLOAD_TOO_LARGE,
  bayBillingLabel,
  startupLabel,
} from '../copy';
import { api, errorCode, fieldErrors, upload } from '../lib/api';
import { useFirstLoad, useReread, useStatus, useSubmit, type StatusHandle } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import { FloorPlan } from '../components/FloorPlan';
import { ErrorSummary, FieldMessage, StatusRegion, type FieldError } from '../components/Status';

export function CarPageScreen({ carId }: { carId: string }): ReactNode {
  const { units } = useSession();
  const [car, setCar] = useState<CarDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const bayStatus = useStatus();
  const belongingsStatus = useStatus();
  const uploadStatus = useStatus();
  const [bayPickerOpen, setBayPickerOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);

  const load = async (): Promise<void> => {
    const outcome = await api<{ car: CarDetail }>(`/api/cars/${carId}`);
    if (outcome.kind === 'ok') setCar(outcome.body.car);
    else if (outcome.kind === 'error' && outcome.status === 404) setMissing(true);
  };

  useFirstLoad(load);
  const watching =
    car !== null &&
    (car.open_release ||
      car.bay_billing.status === 'pending' ||
      (car.bay_billing.cancel_requested && car.bay_billing.status !== 'ending'));
  useReread(load, 10_000, watching);

  if (missing) return <h1>{NOT_FOUND_HEADING}</h1>;
  if (car === null) return <p>Loading…</p>;

  const startup = startupLabel(car.startup);
  const billing = bayBillingLabel(car.bay_billing);

  return (
    <div className="screen car-page">
      <header className="car-identity">
        <h1 className="display">{car.name}</h1>
        <p className="car-subline mono">
          {car.registration} · {car.colour}
        </p>
        <p className="car-spec mono">
          {distanceReading(car.odometer_km, units.distance)} ·{' '}
          {pressureReading(car.tyre_spec_bar, units.pressure)}
        </p>
      </header>

      <div className="car-columns">
        <div className="car-column">
          <section className="pane">
            <h2 className="pane-heading">Bay</h2>
            <p>
              {car.bay === null ? 'No bay' : `Bay ${car.bay.code}`}
              {startup === null ? null : <span className="chip">{startup}</span>}
            </p>
            <p>
              <span className="label">Bay billing</span>{' '}
              <span className="mono">{billing ?? 'No bay billing'}</span>
            </p>
            {car.status === 'released' ? null : (
              <button type="button" onClick={() => setBayPickerOpen(true)}>
                Choose bay
              </button>
            )}
          </section>

          <section className="pane">
            <h2 className="pane-heading">Belongings</h2>
            <table className="data-table">
              <caption className="visually-hidden">Belongings</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Checked in</th>
                  <th scope="col">Movements</th>
                </tr>
              </thead>
              <tbody>
                {car.belongings.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    status={belongingsStatus}
                    onChanged={(next) =>
                      setCar((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              belongings: current.belongings.map((entry) =>
                                entry.id === next.id ? next : entry,
                              ),
                            },
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setAddItemOpen(true)}>
              Add item
            </button>
          </section>

          <section className="pane">
            <h2 className="pane-heading">Condition report</h2>
            <ReportSection
              carId={carId}
              carName={car.name}
              report={car.condition_report}
              status={uploadStatus}
              onStored={load}
            />
          </section>
        </div>

        <div className="car-column">
          <section className="pane">
            <h2 className="pane-heading">Photos</h2>
            <PhotoSection
              carId={carId}
              carName={car.name}
              photos={car.photos}
              status={uploadStatus}
              onStored={load}
            />
          </section>

          <section className="pane">
            <h2 className="pane-heading">Care history</h2>
            <ul className="entry-list">
              {car.care_entries.map((entry) => (
                <li key={entry.id}>
                  <span className="mono">{momentLabel(new Date(entry.at))}</span>{' '}
                  <span>{entry.by.name}</span>
                  {entry.started ? <span className="chip">Start-up</span> : null}
                  {entry.battery_v === null ? null : (
                    <span className="mono"> {voltageReading(entry.battery_v)}</span>
                  )}
                  {entry.tyres_bar === null ? null : (
                    <span className="mono">
                      {' '}
                      {[entry.tyres_bar.fl, entry.tyres_bar.fr, entry.tyres_bar.rl, entry.tyres_bar.rr]
                        .map((bar) => pressureReading(bar, units.pressure))
                        .join(' / ')}
                    </span>
                  )}
                  {entry.flags.map((flag) => (
                    <span className="chip chip-flag" key={flag}>
                      {flag === 'battery_low' ? 'battery low' : 'tyre pressure off'}
                    </span>
                  ))}
                </li>
              ))}
              {car.care_entries.length === 0 ? <li>No care entries yet.</li> : null}
            </ul>
          </section>

          <section className="pane">
            <h2 className="pane-heading">Releases</h2>
            <ul className="entry-list">
              {car.releases.map((release) => (
                <li key={release.id}>
                  <span className="mono">{release.slot_label}</span> <span>{release.status}</span>
                </li>
              ))}
              {car.releases.length === 0 ? <li>No releases yet.</li> : null}
            </ul>
          </section>
        </div>
      </div>

      {bayPickerOpen ? (
        <BayPickerDialog
          car={car}
          status={bayStatus}
          onClose={() => setBayPickerOpen(false)}
          onAssigned={() => {
            setBayPickerOpen(false);
            void load();
          }}
        />
      ) : null}
      {addItemOpen ? (
        <AddItemDialog
          carId={carId}
          status={belongingsStatus}
          onClose={() => setAddItemOpen(false)}
          onAdded={() => {
            setAddItemOpen(false);
            void load();
          }}
        />
      ) : null}
      <StatusRegion name="Bay updates" status={bayStatus} />
      <StatusRegion name="Belongings updates" status={belongingsStatus} />
      <StatusRegion name="Upload updates" status={uploadStatus} />
    </div>
  );
}

function ItemRow({
  item,
  status,
  onChanged,
}: {
  item: Item;
  status: StatusHandle;
  onChanged(item: Item): void;
}): ReactNode {
  const submit = useSubmit<{ item: Item }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(`${body.item.label}: ${String(body.item.count_in)} checked in.`);
      onChanged(body.item);
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'insufficient_items') {
        status.error(`Nothing left to check out for ${item.label}.`);
      } else if (code === 'car_released') {
        status.error('This car has been released.');
      } else {
        status.error('That could not be saved.');
      }
    },
  });

  const move = (direction: 'in' | 'out'): void => {
    void submit.run(() =>
      api<{ item: Item }>(`/api/belongings/${item.id}/movements`, {
        body: { direction, count: 1 },
      }),
    );
  };

  return (
    <tr>
      <th scope="row">{item.label}</th>
      <td>{ITEM_KIND_LABEL[item.kind]}</td>
      <td className="mono">{item.count_in}</td>
      <td className="row-actions">
        <button type="button" onClick={() => move('in')}>
          {`Check in ${item.label}`}
        </button>
        <button type="button" onClick={() => move('out')}>
          {`Check out ${item.label}`}
        </button>
      </td>
    </tr>
  );
}

function BayPickerDialog({
  car,
  status,
  onClose,
  onAssigned,
}: {
  car: CarDetail;
  status: StatusHandle;
  onClose: () => void;
  onAssigned(): void;
}): ReactNode {
  const [bays, setBays] = useState<Bay[]>([]);
  const [selected, setSelected] = useState<Bay | null>(null);
  const assignRef = useRef<HTMLButtonElement | null>(null);

  useFirstLoad(async () => {
    const outcome = await api<{ bays: Bay[] }>(`/api/bays?fits=${car.id}`);
    if (outcome.kind === 'ok') setBays(outcome.body.bays);
  });

  const submit = useSubmit<{ car: CarDetail }>({
    status,
    pendingText: selected === null ? 'Assigning bay...' : `Assigning bay ${selected.code}...`,
    onOk: (body) => {
      status.success(`${body.car.name} assigned to bay ${body.car.bay?.code ?? ''}.`);
      onAssigned();
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      const bayCode = selected?.code ?? '';
      if (code === 'bay_occupied') {
        status.error(`Bay ${bayCode} was just taken. Choose another bay.`);
      } else if (code === 'bay_too_small') {
        status.error(`Bay ${bayCode} is too small for this car.`);
      } else if (code === 'bay_class_change') {
        status.error(
          `Bay ${bayCode} is a different bay class. Moves stay within the same class.`,
        );
      } else if (code === 'car_released') {
        status.error('This car has been released.');
      } else {
        status.error('That bay could not be assigned.');
      }
    },
  });

  return (
    <Dialog name="Choose bay" onClose={onClose}>
      <FloorPlan
        bays={bays}
        mode="picker"
        selected={selected?.id ?? null}
        onActivate={(bay) => {
          setSelected(bay);
          window.setTimeout(() => assignRef.current?.focus(), 0);
        }}
      />
      {selected === null ? null : (
        <button
          type="button"
          ref={assignRef}
          className="primary"
          disabled={submit.busy}
          onClick={() => {
            void submit.run(() =>
              api<{ car: CarDetail }>(`/api/cars/${car.id}/bay`, {
                body: { bay_id: selected.id },
              }),
            );
          }}
        >
          {`Assign bay ${selected.code}`}
        </button>
      )}
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </Dialog>
  );
}

function AddItemDialog({
  carId,
  status,
  onClose,
  onAdded,
}: {
  carId: string;
  status: StatusHandle;
  onClose: () => void;
  onAdded(): void;
}): ReactNode {
  const [kind, setKind] = useState<ItemKind>('key_set');
  const [label, setLabel] = useState('');
  const [count, setCount] = useState('1');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useSubmit<{ item: Item }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(`${body.item.label}: ${String(body.item.count_in)} checked in.`);
      onAdded();
    },
    onError: (outcome) => {
      if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
        return;
      }
      if (errorCode(outcome) === 'car_released') {
        status.error('This car has been released.');
        return;
      }
      status.error('That could not be saved.');
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `add-item-${field}`,
  }));

  return (
    <Dialog name="Add item" onClose={onClose}>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run(() =>
            api<{ item: Item }>(`/api/cars/${carId}/belongings`, {
              body: { kind, label, count: Number(count) },
            }),
          );
        }}
      >
        <label htmlFor="add-item-kind">Item kind</label>
        <select
          id="add-item-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ItemKind)}
        >
          {(Object.keys(ITEM_KIND_LABEL) as ItemKind[]).map((option) => (
            <option key={option} value={option}>
              {ITEM_KIND_LABEL[option]}
            </option>
          ))}
        </select>
        <label htmlFor="add-item-label">Item label</label>
        <input
          id="add-item-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <FieldMessage id="add-item-label-error" message={errors.label} />
        <label htmlFor="add-item-count">Count</label>
        <input
          id="add-item-count"
          type="number"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
        <FieldMessage id="add-item-count-error" message={errors.count} />
        <button type="submit" className="primary" disabled={submit.busy}>
          Add
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Dialog>
  );
}

function ReportSection({
  carId,
  carName,
  report,
  status,
  onStored,
}: {
  carId: string;
  carName: string;
  report: Report | null;
  status: StatusHandle;
  onStored(): Promise<void>;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (): Promise<void> => {
    if (file === null) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    status.pending('Uploading signed condition report...');
    const outcome = await upload<{ report: Report }>(
      `/api/cars/${carId}/condition-report`,
      form,
      () => undefined,
    ).promise;
    setBusy(false);
    if (outcome.kind === 'ok') {
      await onStored();
      status.success(`Signed condition report stored for ${carName}.`);
      return;
    }
    if (outcome.kind === 'no-answer') {
      status.error(UPLOAD_CUT_OFF);
      return;
    }
    const code = errorCode(outcome);
    if (outcome.status === 413) status.error(UPLOAD_TOO_LARGE);
    else if (code === 'storage_unavailable') status.error(STORAGE_DOWN_UPLOAD);
    else if (code === 'report_already_signed') {
      status.error('A signed condition report is already stored for this stay.');
    } else status.error('That file could not be stored.');
  };

  return (
    <div className="stack">
      {report === null ? null : (
        <>
          <a href={`/api/condition-reports/${report.id}/file`}>Download signed report</a>
          <p className="mono fingerprint">{report.sha256}</p>
        </>
      )}
      <label htmlFor="report-file">Signed condition report (PDF)</label>
      <input
        id="report-file"
        type="file"
        accept="application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button type="button" disabled={busy} onClick={() => void send()}>
        Upload report
      </button>
    </div>
  );
}

function PhotoSection({
  carId,
  carName,
  photos,
  status,
  onStored,
}: {
  carId: string;
  carName: string;
  photos: Photo[];
  status: StatusHandle;
  onStored(): Promise<void>;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const send = async (): Promise<void> => {
    if (file === null) return;
    const form = new FormData();
    form.append('kind', 'intake');
    form.append('file', file);
    setProgress(0);
    status.pending(`Uploading ${file.name}...`);
    const outcome = await upload<{ photo: Photo }>(`/api/cars/${carId}/photos`, form, (fraction) =>
      setProgress(Math.min(95, Math.round(fraction * 95))),
    ).promise;
    if (outcome.kind === 'ok') {
      setProgress(100);
      await onStored();
      setProgress(null);
      status.success(`Photo attached to ${carName}.`);
      return;
    }
    setProgress(null);
    if (outcome.kind === 'no-answer') {
      status.error(UPLOAD_CUT_OFF);
      return;
    }
    const code = errorCode(outcome);
    if (outcome.status === 413) status.error(UPLOAD_TOO_LARGE);
    else if (code === 'storage_unavailable') status.error(STORAGE_DOWN_UPLOAD);
    else status.error('That file could not be stored.');
  };

  return (
    <div className="stack">
      <ul className="photo-list" aria-label="Photos">
        {photos.map((photo) => (
          <li key={photo.id}>
            <img src={`/api/photos/${photo.id}/content`} alt="" />
          </li>
        ))}
      </ul>
      <label htmlFor="photo-file">Intake photo</label>
      <input
        id="photo-file"
        type="file"
        accept="image/jpeg,image/png"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button type="button" onClick={() => void send()}>
        Upload photo
      </button>
      {progress === null ? null : (
        <progress
          aria-label="Upload progress"
          max={100}
          value={progress}
          className="upload-progress"
        >
          {progress}
        </progress>
      )}
    </div>
  );
}
