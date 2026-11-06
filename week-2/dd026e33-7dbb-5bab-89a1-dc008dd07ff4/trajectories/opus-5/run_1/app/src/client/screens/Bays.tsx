import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bay, Car } from '../../shared/types';
import { DISTANCE_UNIT_LABEL, PRESSURE_UNIT_LABEL } from '../../shared/units';
import { searchAnnouncement } from '../copy';
import { api, fieldErrors } from '../lib/api';
import { useFirstLoad, useStatus, useSubmit } from '../lib/hooks';
import { Link, navigate, replaceAddress, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import { FloorPlan } from '../components/FloorPlan';
import { ErrorSummary, FieldMessage, StatusRegion, type FieldError } from '../components/Status';

const STATUS_TEXT: Record<Car['status'], string> = {
  awaiting_intake: 'Awaiting intake',
  stored: 'Stored',
  released: 'Released',
};

export function BaysScreen(): ReactNode {
  const location = useLocation();
  const initial = new URLSearchParams(location.search).get('q') ?? '';
  const status = useStatus();
  const [bays, setBays] = useState<Bay[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [text, setText] = useState(initial);
  const [registerOpen, setRegisterOpen] = useState(false);
  const sequence = useRef(0);
  const settled = useRef(initial);

  useFirstLoad(async () => {
    const [bayList, carList] = await Promise.all([
      api<{ bays: Bay[] }>('/api/bays'),
      api<{ cars: Car[]; total: number }>(`/api/cars${initial === '' ? '' : `?q=${encodeURIComponent(initial)}`}`),
    ]);
    if (bayList.kind === 'ok') setBays(bayList.body.bays);
    if (carList.kind === 'ok') setCars(carList.body.cars);
  });

  const runSearch = async (query: string): Promise<void> => {
    const ticket = sequence.current + 1;
    sequence.current = ticket;
    const outcome = await api<{ cars: Car[]; total: number }>(
      `/api/cars${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`,
    );
    // An answer for earlier text that arrives later is discarded.
    if (ticket !== sequence.current) return;
    if (outcome.kind !== 'ok') return;
    settled.current = query;
    setCars(outcome.body.cars);
    replaceAddress(query === '' ? '/bays' : `/bays?q=${encodeURIComponent(query)}`);
    status.announceOnce(`search:${query}`, searchAnnouncement(outcome.body.total));
  };

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => void runSearch(text), 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  const reloadBays = async (): Promise<void> => {
    const outcome = await api<{ bays: Bay[] }>('/api/bays');
    if (outcome.kind === 'ok') setBays(outcome.body.bays);
  };

  return (
    <div className="screen bays-screen">
      <h1>Bays</h1>
      <div className="bays-layout">
        <section className="pane floor-pane">
          <h2 className="pane-heading">Floor plan</h2>
          <FloorPlan
            bays={bays}
            mode="browse"
            onActivate={(bay) => {
              if (bay.car !== null) navigate(`/cars/${bay.car.id}`);
            }}
          />
        </section>
        <section className="pane cars-pane">
          <h2 className="pane-heading">Cars</h2>
          <div className="pane-actions">
            <label htmlFor="search-cars" className="visually-hidden">
              Search cars
            </label>
            <input
              id="search-cars"
              type="search"
              aria-label="Search cars"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <button type="button" onClick={() => setRegisterOpen(true)}>
              Register car
            </button>
          </div>
          <table className="data-table">
            <caption className="visually-hidden">Cars</caption>
            <thead>
              <tr>
                <th scope="col">Car</th>
                <th scope="col">Owner</th>
                <th scope="col">Status</th>
                <th scope="col">Bay</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car) => (
                <tr key={car.id}>
                  <th scope="row">
                    <Link to={`/cars/${car.id}`}>{car.name}</Link>
                  </th>
                  <td>{car.owner.name}</td>
                  <td>{STATUS_TEXT[car.status]}</td>
                  <td className="mono">{car.bay === null ? '—' : car.bay.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {registerOpen ? (
        <RegisterCarDialog
          status={status}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(car) => {
            setCars((list) => [...list, car]);
            void reloadBays();
            setRegisterOpen(false);
          }}
        />
      ) : null}
      <StatusRegion name="Bay updates" status={status} />
    </div>
  );
}

interface Owner {
  id: string;
  name: string;
  email: string;
}

function RegisterCarDialog({
  status,
  onClose,
  onRegistered,
}: {
  status: ReturnType<typeof useStatus>;
  onClose: () => void;
  onRegistered(car: Car): void;
}): ReactNode {
  const { units } = useSession();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    owner_id: '',
    year: '',
    make: '',
    model: '',
    registration: '',
    colour: '',
    length_mm: '',
    width_mm: '',
    odometer: '',
    tyre_spec: '',
    startup_schedule: true,
  });

  useFirstLoad(async () => {
    const outcome = await api<{ owners: Owner[] }>('/api/owners');
    if (outcome.kind === 'ok') {
      setOwners(outcome.body.owners);
      setForm((current) => ({
        ...current,
        owner_id: current.owner_id === '' ? (outcome.body.owners[0]?.id ?? '') : current.owner_id,
      }));
    }
  });

  const submit = useSubmit<{ car: Car }>({
    status,
    pendingText: 'Registering car...',
    onOk: (body) => {
      status.success(`${body.car.name} registered.`);
      onRegistered(body.car);
    },
    onError: (outcome) => {
      if (outcome.kind === 'error' && outcome.status === 422) {
        setErrors(fieldErrors(outcome.body));
        status.error('Check the form and try again.');
      } else {
        status.error('That could not be saved.');
      }
    },
  });

  const summary: FieldError[] = Object.entries(errors).map(([field, message]) => ({
    field,
    message,
    inputId: `register-${field.replace(/\./g, '-')}`,
  }));

  return (
    <Dialog name="Register car" onClose={onClose}>
      <ErrorSummary errors={summary} />
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          void submit.run(() =>
            api<{ car: Car }>('/api/cars', {
              body: {
                owner_id: form.owner_id,
                year: Number(form.year),
                make: form.make,
                model: form.model,
                registration: form.registration,
                colour: form.colour,
                length_mm: Number(form.length_mm),
                width_mm: Number(form.width_mm),
                odometer: { value: form.odometer, unit: units.distance },
                tyre_spec: { value: form.tyre_spec, unit: units.pressure },
                startup_schedule: form.startup_schedule,
              },
            }),
          );
        }}
      >
        <label htmlFor="register-owner_id">Owner</label>
        <select
          id="register-owner_id"
          value={form.owner_id}
          onChange={(event) => setForm({ ...form, owner_id: event.target.value })}
        >
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
        <label htmlFor="register-year">Year</label>
        <input
          id="register-year"
          type="number"
          value={form.year}
          onChange={(event) => setForm({ ...form, year: event.target.value })}
        />
        <FieldMessage id="register-year-error" message={errors.year} />
        <label htmlFor="register-make">Make</label>
        <input
          id="register-make"
          value={form.make}
          onChange={(event) => setForm({ ...form, make: event.target.value })}
        />
        <FieldMessage id="register-make-error" message={errors.make} />
        <label htmlFor="register-model">Model</label>
        <input
          id="register-model"
          value={form.model}
          onChange={(event) => setForm({ ...form, model: event.target.value })}
        />
        <FieldMessage id="register-model-error" message={errors.model} />
        <label htmlFor="register-registration">Registration</label>
        <input
          id="register-registration"
          value={form.registration}
          onChange={(event) => setForm({ ...form, registration: event.target.value })}
        />
        <FieldMessage id="register-registration-error" message={errors.registration} />
        <label htmlFor="register-colour">Colour</label>
        <input
          id="register-colour"
          value={form.colour}
          onChange={(event) => setForm({ ...form, colour: event.target.value })}
        />
        <FieldMessage id="register-colour-error" message={errors.colour} />
        <label htmlFor="register-length_mm">Length (mm)</label>
        <input
          id="register-length_mm"
          type="number"
          value={form.length_mm}
          onChange={(event) => setForm({ ...form, length_mm: event.target.value })}
        />
        <FieldMessage id="register-length_mm-error" message={errors.length_mm} />
        <label htmlFor="register-width_mm">Width (mm)</label>
        <input
          id="register-width_mm"
          type="number"
          value={form.width_mm}
          onChange={(event) => setForm({ ...form, width_mm: event.target.value })}
        />
        <FieldMessage id="register-width_mm-error" message={errors.width_mm} />
        <label htmlFor="register-odometer">{`Odometer (${DISTANCE_UNIT_LABEL[units.distance]})`}</label>
        <input
          id="register-odometer"
          value={form.odometer}
          onChange={(event) => setForm({ ...form, odometer: event.target.value })}
        />
        <FieldMessage id="register-odometer-value-error" message={errors['odometer.value']} />
        <label htmlFor="register-tyre_spec">{`Tyre pressure (${PRESSURE_UNIT_LABEL[units.pressure]})`}</label>
        <input
          id="register-tyre_spec"
          value={form.tyre_spec}
          onChange={(event) => setForm({ ...form, tyre_spec: event.target.value })}
        />
        <FieldMessage id="register-tyre_spec-value-error" message={errors['tyre_spec.value']} />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.startup_schedule}
            onChange={(event) => setForm({ ...form, startup_schedule: event.target.checked })}
          />
          Start-up schedule
        </label>
        <button type="submit" className="primary" disabled={submit.busy}>
          Register
        </button>
      </form>
    </Dialog>
  );
}
