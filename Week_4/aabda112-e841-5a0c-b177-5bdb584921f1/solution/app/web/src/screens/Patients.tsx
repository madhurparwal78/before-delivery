import { useEffect, useRef, useState, type FormEvent } from 'react';
import { can, FILE_KIND_LABEL, FILE_KINDS, SPECIES_LABEL, type FileKind } from '../../../shared/domain';
import { announce } from '../lib/announce';
import { ApiError, errorText, get, mutate, post } from '../lib/api';
import { useMe } from '../lib/env';
import { dueLabel, grams, instantDay, longDayLabel } from '../lib/format';
import { useLive } from '../lib/live';
import { useResource } from '../lib/resource';
import { Link, useRouter } from '../lib/router';
import type { PatientFile, PatientSummary } from '../lib/types';
import { SplitBand } from '../components/Shell';
import { ArrowChip, Avatar, Banner, Chip, EmptyCard, Field, Pill, Skeleton } from '../components/ui';
import { NotFound } from './Pages';

export function Patients() {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<PatientSummary[]>();
  const sequence = useRef(0);
  const queryRef = useRef('');
  queryRef.current = query;

  const load = (q: string, say = false) => {
    const mine = ++sequence.current;
    get<{ patients: PatientSummary[] }>(`/api/patients?q=${encodeURIComponent(q)}`).then((r) => {
      if (mine !== sequence.current) return;
      setList(r.patients);
      if (say) announce(`${r.patients.length} patients found.`);
    }, () => undefined);
  };
  useEffect(() => load(''), []);
  useLive(['patients'], () => load(queryRef.current));

  return (
    <>
      <SplitBand title="Patients">
        <p className="band-count">
          <span className="band-number">{list?.length ?? 0}</span> matching patients
        </p>
      </SplitBand>
      <div className="search-row">
        <label htmlFor="patient-search" className="sr-only">
          Search patients
        </label>
        <input
          id="patient-search"
          type="search"
          placeholder="Search patients or owners"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            load(e.target.value, true);
          }}
        />
      </div>
      {!list ? (
        <Skeleton rows={4} />
      ) : list.length === 0 ? (
        <EmptyCard title="No patients match your search." tone="sky">
          <Pill
            variant="blue"
            onClick={() => {
              setQuery('');
              load('');
            }}
          >
            Clear search
          </Pill>
        </EmptyCard>
      ) : (
        <ul aria-label="Patient list" className="patient-grid">
          {list.map((p) => (
            <li key={p.id} aria-label={`${p.name}, ${SPECIES_LABEL[p.species]}`} className="patient-card tint-plain">
              <Avatar name={p.name} photoId={p.photoFileId} size={56} />
              <div className="patient-main">
                <p className="patient-name">{p.name}</p>
                <div className="chip-row">
                  <Chip>{SPECIES_LABEL[p.species]}</Chip>
                  {p.status && <Chip tone="mint">{p.status}</Chip>}
                </div>
                <p className="muted">{p.clientName}</p>
              </div>
              <ArrowChip to={`/patients/${p.id}`} label={`Open ${p.name}`} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface PatientDetail extends PatientSummary {
  weights: { recordedOn: string; grams: number }[];
  vaccinations: { id: string; vaccine: string; dueDate: string; reminder: 'Scheduled' | 'Sent' | 'Missed' }[];
  history: { appointmentId: string; start: string; reason: string; vetName: string; notePreview: string }[];
}

const TABS = ['overview', 'history', 'files', 'vaccinations'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', history: 'History', files: 'Files', vaccinations: 'Vaccinations' };

function Sparkline({ points }: { points: number[] }) {
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const coords = points.map((p, i) => `${points.length === 1 ? 32 : 8 + (i * 48) / (points.length - 1)},${hi === lo ? 32 : 52 - ((p - lo) / (hi - lo)) * 40}`);
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" className="sparkline">
      <polyline points={coords.join(' ')} fill="none" stroke="#0F4DAE" strokeWidth="2.500" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c} cx={c.split(',')[0]} cy={c.split(',')[1]} r="2.500" fill="#0F4DAE" />
      ))}
    </svg>
  );
}

function History({ patient }: { patient: PatientDetail }) {
  const me = useMe();
  const [feature, ...rest] = patient.history;
  const upTo = (start: string) => patient.weights.filter((w) => w.recordedOn <= start.slice(0, 10)).map((w) => w.grams);
  return (
    <div>
      {can(me.role, 'consult.run') && (
        <p>
          <a className="text-link" href={`/api/patients/${patient.id}/history.pdf`}>
            Export history PDF
          </a>
        </p>
      )}
      {!feature ? (
        <EmptyCard title="No completed consults yet." tone="sky" />
      ) : (
        <div className="history">
          <article className="history-feature tint-mint">
            <p className="muted">{`${instantDay(feature.start)} ${feature.start.slice(0, 4)}`}</p>
            <h3 className="card-title">{feature.reason}</h3>
            <p>{`with ${feature.vetName}`}</p>
            <p className="note-preview">{feature.notePreview || 'No note written.'}</p>
            <div className="chip-row">
              <Chip>{feature.reason}</Chip>
              <Chip>Latest</Chip>
            </div>
            <Link to={`/consult/${feature.appointmentId}`} className="text-link">
              Open consult
            </Link>
          </article>
          <ul className="history-rows">
            {rest.map((h) => (
              <li key={h.appointmentId} className="history-row">
                <Sparkline points={upTo(h.start)} />
                <div>
                  <p className="row-date">{`${instantDay(h.start)} ${h.start.slice(0, 4)}`}</p>
                  <p>{`${h.reason} with ${h.vetName}`}</p>
                  <Link to={`/consult/${h.appointmentId}`} className="text-link">
                    Open consult
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Files of one patient: pick a type, add a file, see it listed (with a preview) once the server has stored it. */
export function FilesPanel({ patientId, appointmentId }: { patientId: string; appointmentId?: string }) {
  const me = useMe();
  const files = useResource<{ files: PatientFile[] }>(`/api/patients/${patientId}/files`, ['patients']);
  const [kind, setKind] = useState<FileKind>('xray');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setError(null);
    setPending(file.name);
    const form = new FormData();
    form.set('kind', kind);
    if (appointmentId) form.set('appointmentId', appointmentId);
    form.set('file', file, file.name);
    try {
      await mutate(
        async () => {
          const response = await fetch(`/api/patients/${patientId}/files`, { method: 'POST', body: form, credentials: 'same-origin' });
          const body = (await response.json()) as { message?: string; name?: string };
          if (!response.ok) throw new ApiError(response.status, 'validation_failed', body.message ?? 'Something went wrong.');
          return body;
        },
        (saved) => announce(`${saved.name ?? file.name} saved to Files.`),
      );
      files.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      {can(me.role, 'files.write') && (
        <div className="upload-row">
          <Field id="file-kind" label="File type">
            <select id="file-kind" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
              {FILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FILE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="file-input" label="Add file">
            <input id="file-input" ref={input} type="file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </Field>
        </div>
      )}
      {pending && (
        <p className="uploading" aria-busy="true">
          {`Uploading ${pending}`}
        </p>
      )}
      <Banner message={error} />
      <ul aria-label="Patient files" className="file-list">
        {files.data?.files.map((f) => (
          <li key={f.id} aria-label={`${f.name}, ${FILE_KIND_LABEL[f.kind]}`} className="file-row">
            {f.contentType.startsWith('image/') ? (
              <img src={f.url} alt="" width={64} height={64} className="file-thumb" />
            ) : (
              <span className="file-tile" aria-hidden="true">
                PDF
              </span>
            )}
            <div>
              <p className="file-name">{f.name}</p>
              <p className="muted">{`${FILE_KIND_LABEL[f.kind]} · ${(f.sizeBytes / 1024).toFixed(1)} KB`}</p>
              <p className="checksum">{f.sha256}</p>
              <a className="text-link" href={f.url} aria-label={`Open ${f.name}`}>
                Open
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Vaccinations({ patient, reload }: { patient: PatientDetail; reload: () => void }) {
  const me = useMe();
  const [vaccine, setVaccine] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(
        () => post(`/api/patients/${patient.id}/vaccinations`, { vaccine, dueDate: due }),
        () => announce('Vaccination added.'),
      );
      setVaccine('');
      setDue('');
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <ul aria-label="Vaccinations" className="vaccination-list">
        {patient.vaccinations.map((v) => (
          <li key={v.id} aria-label={`${v.vaccine}, due ${dueLabel(v.dueDate)}`} className="vaccination tint-sky">
            <span className="vaccine-name">{v.vaccine}</span>
            <span>{`Due ${dueLabel(v.dueDate)}`}</span>
            <Chip tone={v.reminder === 'Sent' ? 'mint' : v.reminder === 'Missed' ? 'rose' : 'plain'}>{`Reminder: ${v.reminder}`}</Chip>
          </li>
        ))}
      </ul>
      {patient.vaccinations.length === 0 && <p className="muted">No vaccinations recorded.</p>}
      {can(me.role, 'consult.run') && (
        <form onSubmit={(e) => void submit(e)} noValidate className="inline-form">
          <Field id="vaccine" label="Vaccine">
            <input id="vaccine" type="text" value={vaccine} onChange={(e) => setVaccine(e.target.value)} />
          </Field>
          <Field id="due-date" label="Due date">
            <input id="due-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Pill type="submit" busy={busy}>
            Add vaccination
          </Pill>
          <Banner message={error} />
        </form>
      )}
    </div>
  );
}

function Overview({ patient, reload }: { patient: PatientDetail; reload: () => void }) {
  const me = useMe();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(
        () => post(`/api/patients/${patient.id}/weights`, { grams: value === '' ? undefined : Number(value) }),
        () => announce('Weight saved.'),
      );
      setValue('');
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overview">
      <p>{`Owner: ${patient.clientName}`}</p>
      <p>{`Species: ${SPECIES_LABEL[patient.species]}`}</p>
      {patient.weights.length > 0 && (
        <p className="muted">{`Last recorded ${longDayLabel(patient.weights[patient.weights.length - 1]!.recordedOn)}`}</p>
      )}
      {can(me.role, 'files.write') && (
        <form onSubmit={(e) => void submit(e)} noValidate className="inline-form">
          <Field id="weight" label="Weight in grams">
            <input id="weight" type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Pill type="submit" busy={busy}>
            Save weight
          </Pill>
          <Banner message={error} />
        </form>
      )}
    </div>
  );
}

export function PatientRecord({ id }: { id: string }) {
  const { search, navigate, path } = useRouter();
  const patient = useResource<PatientDetail>(`/api/patients/${id}`, ['patients']);
  const requested = new URLSearchParams(search).get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview';
  if (patient.error) return <NotFound />;
  if (!patient.data) return <Skeleton rows={4} />;
  const p = patient.data;
  const select = (next: Tab) => navigate(`${path}?tab=${next}`, { replace: true });
  const onKey = (event: React.KeyboardEvent, index: number) => {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!move) return;
    event.preventDefault();
    const next = TABS[(index + move + TABS.length) % TABS.length]!;
    select(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <>
      <SplitBand title={p.name} aside={<Avatar name={p.name} photoId={p.photoFileId} size={56} />}>
        <div className="record-summary">
          <div className="chip-row">
            <Chip>{SPECIES_LABEL[p.species]}</Chip>
            {p.status && <Chip tone="mint">{p.status}</Chip>}
          </div>
          <p className="record-weight">{`Weight ${grams(p.weightGrams)}`}</p>
        </div>
      </SplitBand>
      <div role="tablist" aria-label="Patient record" className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`tab ${tab === t ? 'selected' : ''}`}
            onClick={() => select(t)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-label={TAB_LABEL[tab]} className="tab-panel">
        {tab === 'overview' && <Overview patient={p} reload={patient.reload} />}
        {tab === 'history' && <History patient={p} />}
        {tab === 'files' && <FilesPanel patientId={p.id} />}
        {tab === 'vaccinations' && <Vaccinations patient={p} reload={patient.reload} />}
      </div>
    </>
  );
}

