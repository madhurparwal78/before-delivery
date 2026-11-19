import { useEffect, useRef, useState, type JSX } from 'react';
import { api, get, upload } from '../api';
import { useLiveResource } from '../live';
import {
  AlertBanner,
  ArrowChip,
  EmptyCard,
  InlineAlert,
  Pill,
  useAnnounce,
} from '../ui';
import { dateDdMonYyyy, instantDdMonYyyy } from '../time';
import { NotFoundCard, SplitBand, useApp } from '../app';
import { Avatar, messageOf, SPECIES_LABELS } from './today';

type PatientSummary = {
  id: string;
  name: string;
  species: string;
  clientName: string;
  weightGrams: number | null;
  photoFileId: string | null;
  status: string | null;
};

type PatientDetail = {
  id: string;
  name: string;
  species: string;
  clientName: string;
  weightGrams: number | null;
  photoFileId: string | null;
  status: string | null;
  weights: { recordedOn: string; grams: number }[];
  vaccinations: { id: string; vaccine: string; dueDate: string; reminder: string }[];
  history: {
    appointmentId: string;
    start: string;
    reason: string;
    vetName: string;
    notePreview: string;
  }[];
};

type PatientFile = {
  id: string;
  name: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

const FILE_TYPES: { label: string; value: string }[] = [
  { label: 'X-ray', value: 'xray' },
  { label: 'Wound photo', value: 'wound' },
  { label: 'Lab report', value: 'lab' },
  { label: 'Consent form', value: 'consent' },
  { label: 'Profile photo', value: 'profile' },
];

export function PatientsScreen(): JSX.Element {
  const { navigate } = useApp();
  const announce = useAnnounce();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const ticket = useRef(0);

  const load = async (term: string): Promise<void> => {
    const current = ticket.current + 1;
    ticket.current = current;
    const data = await get<{ patients: PatientSummary[] }>(
      `/api/patients?q=${encodeURIComponent(term)}`,
    );
    if (ticket.current !== current) return;
    setPatients(data.patients);
    announce(`${data.patients.length} patients found.`);
  };

  useEffect(() => {
    void get<{ patients: PatientSummary[] }>('/api/patients').then((data) =>
      setPatients(data.patients),
    );
  }, []);

  return (
    <div className="screen">
      <SplitBand
        headline={<h1>Patients</h1>}
        right={<p className="band-count">{patients.length} patients</p>}
      />
      <div className="screen-body">
        <div className="field">
          <label htmlFor="patient-search">Search patients</label>
          <input
            id="patient-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              void load(event.target.value);
            }}
          />
        </div>
        {patients.length === 0 ? (
          <EmptyCard
            title="No patients match your search."
            action={{
              label: 'Clear search',
              onClick: () => {
                setSearch('');
                void load('');
              },
            }}
          />
        ) : (
          <ul className="patient-grid" aria-label="Patient list">
            {patients.map((patient) => (
              <li
                key={patient.id}
                className="patient-card"
                aria-label={`${patient.name}, ${SPECIES_LABELS[patient.species] ?? 'Other'}`}
              >
                <Avatar name={patient.name} photoFileId={patient.photoFileId} />
                <div className="patient-card-body">
                  <p className="patient-card-name">{patient.name}</p>
                  <p className="chip-row">
                    <span className="chip">{SPECIES_LABELS[patient.species] ?? 'Other'}</span>
                    {patient.status ? <span className="chip">{patient.status}</span> : null}
                  </p>
                  <p className="patient-card-vet">{patient.clientName}</p>
                </div>
                <ArrowChip
                  href={`/patients/${patient.id}`}
                  label={`Open ${patient.name}`}
                  onNavigate={navigate}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type TabName = 'Overview' | 'History' | 'Files' | 'Vaccinations';

const TABS: TabName[] = ['Overview', 'History', 'Files', 'Vaccinations'];

export function PatientRecordScreen({ patientId }: { patientId: string }): JSX.Element {
  const { search, navigate, session } = useApp();
  const announce = useAnnounce();
  const role = session?.role ?? 'front-desk';
  const canWriteRecords = role === 'vet' || role === 'nurse' || role === 'manager';
  const canExport = role === 'vet' || role === 'manager';
  const requested = new URLSearchParams(search).get('tab');
  const [tab, setTab] = useState<TabName>(tabFromQuery(requested));
  const openTab = (name: TabName): void => {
    setTab(name);
    navigate(`/patients/${patientId}?tab=${name.toLowerCase()}`);
  };
  const patient = useLiveResource<PatientDetail>(`/api/patients/${patientId}`, ['patients']);
  const files = useLiveResource<{ files: PatientFile[] }>(`/api/patients/${patientId}/files`, [
    'patients',
  ]);
  const [alert, setAlert] = useState<string | null>(null);

  if (patient.error) return <NotFoundCard onNavigate={navigate} />;
  const record = patient.data;

  return (
    <div className="screen">
      <SplitBand
        headline={<h1>{record?.name ?? 'Patient'}</h1>}
        right={<p className="band-count">{record?.clientName ?? ''}</p>}
      />
      <div className="screen-body">
        <p className="chip-row">
          <span className="chip">{SPECIES_LABELS[record?.species ?? 'other'] ?? 'Other'}</span>
          {record?.status ? <span className="chip">{record.status}</span> : null}
        </p>
        <p className="weight-line">
          {record?.weightGrams ? `${record.weightGrams.toLocaleString('en-GB')} g` : 'No weight yet'}
        </p>
        <AlertBanner message={alert} />
        <div role="tablist" aria-label="Patient record" className="tablist">
          {TABS.map((name, index) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              className="tab"
              onClick={() => openTab(name)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const step = event.key === 'ArrowRight' ? 1 : TABS.length - 1;
                const next = TABS[(index + step) % TABS.length];
                openTab(next);
                window.setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        {tab === 'Overview' ? (
          <div role="tabpanel" id="panel-Overview" aria-labelledby="tab-Overview" className="panel">
            {canWriteRecords ? (
              <WeightForm
                patientId={patientId}
                onSaved={() => {
                  patient.reload();
                  announce('Weight saved.');
                }}
                onFailure={setAlert}
              />
            ) : null}
            <p className="record-client">{record?.clientName ?? ''}</p>
          </div>
        ) : null}
        {tab === 'History' ? (
          <div role="tabpanel" id="panel-History" aria-labelledby="tab-History" className="panel">
            <HistoryPanel record={record} patientId={patientId} canExport={canExport} />
          </div>
        ) : null}
        {tab === 'Files' ? (
          <div
            role="tabpanel"
            id="panel-Files"
            aria-labelledby="tab-Files"
            aria-label="Files"
            className="panel"
          >
            <FilesPanel
              patientId={patientId}
              canUpload={canWriteRecords}
              files={files.data?.files ?? []}
              onUploaded={(name) => {
                files.reload();
                patient.reload();
                announce(`${name} saved to Files.`);
              }}
            />
          </div>
        ) : null}
        {tab === 'Vaccinations' ? (
          <div
            role="tabpanel"
            id="panel-Vaccinations"
            aria-labelledby="tab-Vaccinations"
            className="panel"
          >
            <VaccinationsPanel
              patientId={patientId}
              vaccinations={record?.vaccinations ?? []}
              canAdd={session?.role === 'vet' || session?.role === 'manager'}
              onAdded={() => {
                patient.reload();
                announce('Vaccination added.');
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function tabFromQuery(value: string | null): TabName {
  if (value === 'history') return 'History';
  if (value === 'files') return 'Files';
  if (value === 'vaccinations') return 'Vaccinations';
  return 'Overview';
}

function WeightForm({
  patientId,
  onSaved,
  onFailure,
}: {
  patientId: string;
  onSaved: () => void;
  onFailure: (message: string) => void;
}): JSX.Element {
  const [grams, setGrams] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="form-row">
      <div className="field">
        <label htmlFor="weight-grams">Weight in grams</label>
        <input
          id="weight-grams"
          type="number"
          min={1}
          max={200000}
          value={grams}
          onChange={(event) => setGrams(event.target.value)}
        />
      </div>
      <Pill
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api('POST', `/api/patients/${patientId}/weights`, { grams: Number(grams) });
            setGrams('');
            onSaved();
          } catch (error) {
            onFailure(messageOf(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save weight
      </Pill>
    </div>
  );
}

function Sparkline({ weights }: { weights: { grams: number }[] }): JSX.Element {
  const values = weights.map((weight) => weight.grams);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 40 - ((value - min) / Math.max(1, max - min)) * 36;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 44" aria-hidden="true">
      <polyline points={points || '0,40 100,40'} fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function HistoryPanel({
  record,
  patientId,
  canExport,
}: {
  record: PatientDetail | null;
  patientId: string;
  canExport: boolean;
}): JSX.Element {
  const history = record?.history ?? [];
  const feature = history[0];
  const rest = history.slice(1);
  return (
    <div className="history-layout">
      {feature ? (
        <article className="history-feature tint-mint">
          <p className="card-title">{instantDdMonYyyy(feature.start)}</p>
          <p>{feature.reason}</p>
          <p>{feature.vetName}</p>
          <p className="history-preview">{feature.notePreview}</p>
          <p className="chip-row">
            <span className="chip">{feature.reason}</span>
          </p>
        </article>
      ) : (
        <p>No completed consults yet.</p>
      )}
      <div className="history-rows">
        {rest.map((entry) => (
          <article className="history-row" key={entry.appointmentId}>
            <span className="sparkline-tile">
              <Sparkline weights={record?.weights ?? []} />
            </span>
            <span>
              {instantDdMonYyyy(entry.start)} · {entry.reason}
            </span>
          </article>
        ))}
      </div>
      {canExport ? (
        <a className="link" href={`/api/patients/${patientId}/history.pdf`}>
          Export history PDF
        </a>
      ) : null}
    </div>
  );
}

function FilesPanel({
  patientId,
  files,
  canUpload,
  onUploaded,
}: {
  patientId: string;
  files: PatientFile[];
  canUpload: boolean;
  onUploaded: (name: string) => void;
}): JSX.Element {
  const [kind, setKind] = useState('xray');
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const send = async (file: File): Promise<void> => {
    setPendingName(file.name);
    setFailure(null);
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    try {
      const stored = await upload<PatientFile>(`/api/patients/${patientId}/files`, form);
      onUploaded(stored.name);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setPendingName(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="files-panel">
      {canUpload ? (
        <div className="form-row">
          <div className="field">
            <label htmlFor="file-type">File type</label>
            <select id="file-type" value={kind} onChange={(event) => setKind(event.target.value)}>
              {FILE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="file-input">Add file</label>
            <input
              id="file-input"
              type="file"
              ref={input}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void send(file);
              }}
            />
          </div>
        </div>
      ) : null}
      {pendingName ? <p className="pending-line">Uploading {pendingName}</p> : null}
      <AlertBanner message={failure} />
      <ul className="file-list" aria-label="Patient files">
        {files.map((file) => {
          const label = FILE_TYPES.find((type) => type.value === file.kind)?.label ?? file.kind;
          return (
            <li key={file.id} aria-label={`${file.name}, ${label}`} className="file-row">
              {file.contentType.startsWith('image/') ? (
                <img className="file-thumb" src={file.url} alt="" />
              ) : (
                <span className="file-thumb document" aria-hidden="true">
                  PDF
                </span>
              )}
              <span className="file-name">{file.name}</span>
              <span className="file-checksum">{file.sha256}</span>
              <a className="link" href={file.url}>
                {`Open ${file.name}`}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VaccinationsPanel({
  patientId,
  vaccinations,
  canAdd,
  onAdded,
}: {
  patientId: string;
  vaccinations: { id: string; vaccine: string; dueDate: string; reminder: string }[];
  canAdd: boolean;
  onAdded: () => void;
}): JSX.Element {
  const [vaccine, setVaccine] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="vaccinations-panel">
      <ul className="vaccination-list" aria-label="Vaccinations">
        {vaccinations.map((vaccination) => (
          <li
            key={vaccination.id}
            aria-label={`${vaccination.vaccine}, due ${dateDdMonYyyy(vaccination.dueDate)}`}
          >
            <span>
              {vaccination.vaccine}, due {dateDdMonYyyy(vaccination.dueDate)}
            </span>
            <span className="chip">{`Reminder: ${vaccination.reminder}`}</span>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <div className="form-row">
          <div className="field">
            <label htmlFor="vaccine">Vaccine</label>
            <input
              id="vaccine"
              type="text"
              value={vaccine}
              onChange={(event) => setVaccine(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="due-date">Due date</label>
            <input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <Pill
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('POST', `/api/patients/${patientId}/vaccinations`, { vaccine, dueDate });
                setVaccine('');
                setDueDate('');
                setFailure(null);
                onAdded();
              } catch (error) {
                setFailure(messageOf(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Add vaccination
          </Pill>
          <InlineAlert message={failure} />
        </div>
      ) : null}
    </div>
  );
}
