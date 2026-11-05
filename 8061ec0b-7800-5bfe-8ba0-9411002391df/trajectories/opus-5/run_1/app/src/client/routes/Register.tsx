import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { INSTRUMENT_TYPES, STRING_SIZES, type FleetInstrument, type InstrumentType } from '../../shared/types';
import { instrumentName, sizeLabel } from '../../shared/labels';
import { useSession } from '../app';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { useBand } from '../lib/motion';
import { setRowOrigin } from '../lib/transition';
import { Dialog } from '../components/Dialog';

interface Family {
  id: string;
  parent_name: string;
  students: Array<{ id: string; name: string }>;
}

interface School {
  id: string;
  name: string;
}

const STATUS_WORDS: Record<string, string> = {
  available: 'Available',
  on_contract: 'On contract',
  sold: 'Sold',
  retired: 'Retired',
};

function SerialCell({ instrument }: { instrument: FleetInstrument }): ReactNode {
  if (instrument.contract_id === null) return <span className="mono">{instrument.serial}</span>;
  return (
    <Link
      className="mono"
      to={`/contracts/${instrument.contract_id}`}
      onClick={(event) => {
        const row = (event.currentTarget as HTMLElement).closest('tr, li');
        if (row !== null) setRowOrigin(instrument.contract_id ?? '', row);
      }}
    >
      {instrument.serial}
    </Link>
  );
}

export function Register(): ReactNode {
  const { user } = useSession();
  const band = useBand();
  const [instruments, setInstruments] = useState<FleetInstrument[]>([]);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [studentOpen, setStudentOpen] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const addInstrumentButton = useRef<HTMLButtonElement>(null);
  const addStudentButton = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    const answer = await api<{ instruments: FleetInstrument[] }>('/instruments');
    setInstruments(answer.instruments);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void (async () => {
      const [familyAnswer, schoolAnswer] = await Promise.all([
        api<{ families: Family[] }>('/families'),
        api<{ schools: School[] }>('/schools'),
      ]);
      setFamilies(familyAnswer.families);
      setSchools(schoolAnswer.schools);
    })();
  }, [user?.role]);

  const announce = (text: string, isError = false): void => {
    setStatus(text);
    setStatusError(isError);
  };

  return (
    <main className="page">
      <h1>Fleet register</h1>
      {user?.role === 'owner' ? (
        <p>
          <button type="button" ref={addInstrumentButton} onClick={() => setInstrumentOpen(true)}>
            Add instrument
          </button>{' '}
          <button type="button" ref={addStudentButton} onClick={() => setStudentOpen(true)}>
            Add student
          </button>
        </p>
      ) : null}

      <p className={statusError ? 'status error' : 'status'} role="status" aria-label="Register status" ref={statusRef}>
        {status}
      </p>

      {band === 'narrow' ? (
        <ul className="register-list" aria-label="Fleet register">
          {instruments.map((instrument) => (
            <li key={instrument.serial}>
              <span className="register-index mono">{instrument.index}</span>
              <span>
                <SerialCell instrument={instrument} />
              </span>
              <span />
              <span>
                {instrument.label} · {STATUS_WORDS[instrument.status] ?? instrument.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <table className="register-table">
          <caption className="visually-hidden">Fleet register</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Serial</th>
              <th scope="col">Instrument</th>
              <th scope="col">Size</th>
              {band === 'wide' ? <th scope="col">Model</th> : null}
              <th scope="col">School</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((instrument) => (
              <tr key={instrument.serial}>
                <td className="figure">{instrument.index}</td>
                <td>
                  <SerialCell instrument={instrument} />
                </td>
                <td>{instrumentName(instrument.instrument_type)}</td>
                <td>{sizeLabel(instrument.instrument_type, instrument.size)}</td>
                {band === 'wide' ? <td>{instrument.model}</td> : null}
                <td>{instrument.school_name ?? '—'}</td>
                <td>{STATUS_WORDS[instrument.status] ?? instrument.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddInstrumentDialog
        open={instrumentOpen}
        onClose={() => {
          setInstrumentOpen(false);
          addInstrumentButton.current?.focus();
        }}
        onSaved={async (serial) => {
          setInstrumentOpen(false);
          announce(`Added ${serial}.`);
          await load();
          statusRef.current?.focus();
        }}
        announce={announce}
      />

      <AddStudentDialog
        open={studentOpen}
        schools={schools}
        families={families}
        onClose={() => {
          setStudentOpen(false);
          addStudentButton.current?.focus();
        }}
        onSaved={async (name, schoolName) => {
          setStudentOpen(false);
          announce(`Added ${name} to ${schoolName}.`);
          await load();
          statusRef.current?.focus();
        }}
        announce={announce}
      />
    </main>
  );
}

function useFieldErrors(order: string[]): {
  errors: Record<string, string>;
  apply: (fields: Record<string, string> | undefined) => void;
  clear: () => void;
  describedBy: (field: string) => string | undefined;
  invalid: (field: string) => 'true' | undefined;
} {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const apply = (fields: Record<string, string> | undefined): void => {
    setErrors(fields ?? {});
    const first = order.find((field) => fields?.[field] !== undefined);
    if (first === undefined) return;
    requestAnimationFrame(() => {
      document.getElementById(`field-${first}`)?.focus();
    });
  };
  return {
    errors,
    apply,
    clear: () => setErrors({}),
    describedBy: (field) => (errors[field] === undefined ? undefined : `field-error-${field}`),
    invalid: (field) => (errors[field] === undefined ? undefined : 'true'),
  };
}

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }): ReactNode {
  if (errors[field] === undefined) return null;
  return (
    <span className="field-error" id={`field-error-${field}`}>
      {errors[field]}
    </span>
  );
}

function AddInstrumentDialog({
  open,
  onClose,
  onSaved,
  announce,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (serial: string) => Promise<void>;
  announce: (text: string, isError?: boolean) => void;
}): ReactNode {
  const [serial, setSerial] = useState('');
  const [type, setType] = useState<InstrumentType>('flute');
  const [size, setSize] = useState('full');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors(['serial', 'instrument_type', 'size', 'model']);
  const stringed = type === 'violin' || type === 'cello';

  useEffect(() => {
    setSize(stringed ? '1/2' : 'full');
  }, [stringed]);

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(PENDING.save);
    fields.clear();
    try {
      await api('/instruments', {
        method: 'POST',
        body: { serial, instrument_type: type, size, model },
      });
      await onSaved(serial);
      setSerial('');
      setModel('');
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        fields.apply(error.fields);
        announce('Check the highlighted fields.', true);
      } else if (error instanceof ApiFailure && error.code === 'serial_taken') {
        announce(`Serial ${serial} is already in the fleet.`, true);
      } else if (error instanceof NetworkFailure) {
        announce(NETWORK_COPY, true);
      } else if (error instanceof ApiFailure) {
        announce(error.message, true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog name="Add instrument" open={open} onCancel={onClose}>
      <h2>Add instrument</h2>
      <div className="field">
        <label htmlFor="field-serial">Serial</label>
        <input
          id="field-serial"
          type="text"
          value={serial}
          aria-invalid={fields.invalid('serial')}
          aria-describedby={fields.describedBy('serial')}
          onChange={(event) => setSerial(event.target.value.toUpperCase())}
        />
        <FieldError field="serial" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-instrument_type">Instrument</label>
        <select
          id="field-instrument_type"
          value={type}
          aria-invalid={fields.invalid('instrument_type')}
          aria-describedby={fields.describedBy('instrument_type')}
          onChange={(event) => setType(event.target.value as InstrumentType)}
        >
          {INSTRUMENT_TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {instrumentName(entry)}
            </option>
          ))}
        </select>
        <FieldError field="instrument_type" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-size">Size</label>
        <select
          id="field-size"
          value={size}
          aria-invalid={fields.invalid('size')}
          aria-describedby={fields.describedBy('size')}
          onChange={(event) => setSize(event.target.value)}
        >
          {(stringed ? STRING_SIZES : (['full'] as const)).map((entry) => (
            <option key={entry} value={entry}>
              {stringed ? entry : 'Full size'}
            </option>
          ))}
        </select>
        <FieldError field="size" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-model">Model</label>
        <input
          id="field-model"
          type="text"
          value={model}
          aria-invalid={fields.invalid('model')}
          aria-describedby={fields.describedBy('model')}
          onChange={(event) => setModel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
        <FieldError field="model" errors={fields.errors} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          Save instrument
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function AddStudentDialog({
  open,
  onClose,
  onSaved,
  announce,
  families,
  schools,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (name: string, schoolName: string) => Promise<void>;
  announce: (text: string, isError?: boolean) => void;
  families: Family[];
  schools: School[];
}): ReactNode {
  const [familyId, setFamilyId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors(['family_id', 'school_id', 'name', 'grade']);

  useEffect(() => {
    if (familyId === '' && families[0] !== undefined) setFamilyId(families[0].id);
    if (schoolId === '' && schools[0] !== undefined) setSchoolId(schools[0].id);
  }, [families, schools, familyId, schoolId]);

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(PENDING.save);
    fields.clear();
    const parsedGrade = grade.trim() === '' || Number.isNaN(Number(grade)) ? null : Number(grade);
    try {
      await api('/students', {
        method: 'POST',
        body: { family_id: familyId, school_id: schoolId, name, grade: parsedGrade },
      });
      const schoolName = schools.find((school) => school.id === schoolId)?.name ?? '';
      await onSaved(name, schoolName);
      setName('');
      setGrade('');
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        fields.apply(error.fields);
        announce('Check the highlighted fields.', true);
      } else if (error instanceof NetworkFailure) {
        announce(NETWORK_COPY, true);
      } else if (error instanceof ApiFailure) {
        announce(error.message, true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog name="Add student" open={open} onCancel={onClose}>
      <h2>Add student</h2>
      <div className="field">
        <label htmlFor="field-family_id">Family</label>
        <select
          id="field-family_id"
          value={familyId}
          aria-invalid={fields.invalid('family_id')}
          aria-describedby={fields.describedBy('family_id')}
          onChange={(event) => setFamilyId(event.target.value)}
        >
          {families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.parent_name}
            </option>
          ))}
        </select>
        <FieldError field="family_id" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-school_id">School</label>
        <select
          id="field-school_id"
          value={schoolId}
          aria-invalid={fields.invalid('school_id')}
          aria-describedby={fields.describedBy('school_id')}
          onChange={(event) => setSchoolId(event.target.value)}
        >
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
        <FieldError field="school_id" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-name">Student name</label>
        <input
          id="field-name"
          type="text"
          value={name}
          aria-invalid={fields.invalid('name')}
          aria-describedby={fields.describedBy('name')}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError field="name" errors={fields.errors} />
      </div>
      <div className="field">
        <label htmlFor="field-grade">Grade</label>
        <input
          id="field-grade"
          type="text"
          inputMode="numeric"
          value={grade}
          aria-invalid={fields.invalid('grade')}
          aria-describedby={fields.describedBy('grade')}
          onChange={(event) => setGrade(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
        <FieldError field="grade" errors={fields.errors} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          Save student
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
