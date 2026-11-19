import { useEffect, useRef, useState, type JSX } from 'react';
import { api, get, RequestFailed } from '../api';
import { useLiveResource } from '../live';
import {
  AlertBanner,
  Dialog,
  EmptyCard,
  KennelBeacon,
  motionAttributes,
  Pill,
  useAnnounce,
  type SummaryItem,
} from '../ui';
import { hm } from '../time';
import { ClinicDateText, SplitBand, useApp, useViewport } from '../app';
import { Avatar, messageOf } from './today';

type Treatment = {
  id: string;
  patientId: string;
  patientName: string;
  kennel: string;
  name: string;
  scheduledAt: string;
  status: 'upcoming' | 'due' | 'overdue' | 'given' | 'skipped';
  givenAt: string | null;
  givenBy: string | null;
  skipReason: string | null;
  notes: { id: string; text: string; author: string; createdAt: string }[];
};

type Board = {
  beacons: { waiting: number; overdue: number; dueWithinHour: number };
  treatments: Treatment[];
};

const GROUPS: { name: string; statuses: Treatment['status'][] }[] = [
  { name: 'Overdue', statuses: ['overdue'] },
  { name: 'Due', statuses: ['due'] },
  { name: 'Upcoming', statuses: ['upcoming'] },
  { name: 'Done', statuses: ['given', 'skipped'] },
];

const STATUS_TEXT: Record<Treatment['status'], string> = {
  upcoming: 'Upcoming',
  due: 'Due',
  overdue: 'Overdue',
  given: 'Given',
  skipped: 'Skipped',
};

export function treatmentCellName(treatment: Treatment): string {
  return `${treatment.patientName}, ${treatment.name}, ${hm(treatment.scheduledAt)}, ${
    STATUS_TEXT[treatment.status]
  }`;
}

export function WardScreen(): JSX.Element {
  const viewport = useViewport();
  const announce = useAnnounce();
  const { session } = useApp();
  const board = useLiveResource<Board>('/api/ward/board', ['ward', 'beacons', 'queue']);
  const [alert, setAlert] = useState<string | null>(null);
  const [admitting, setAdmitting] = useState(false);
  const [noteFor, setNoteFor] = useState<Treatment | null>(null);
  const [skipFor, setSkipFor] = useState<Treatment | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const shouldFocus = useRef(false);
  const boardHadFocus = useRef(false);
  const container = useRef<HTMLDivElement | null>(null);

  const treatments = board.data?.treatments ?? [];
  const columns = viewport === 'desktop' ? 3 : viewport === 'tablet' ? 2 : 1;
  const grouped = GROUPS.map((group) => ({
    name: group.name,
    cells: treatments.filter((treatment) => group.statuses.includes(treatment.status)),
  }));

  /** Focus follows the same treatment when a pushed update moves its cell. */
  useEffect(() => {
    const cell = container.current?.querySelector<HTMLElement>('[data-ward-focus="true"]');
    if (!cell) return;
    if (shouldFocus.current) {
      shouldFocus.current = false;
      cell.focus();
      return;
    }
    const active = document.activeElement;
    const lostFocus = active === null || active === document.body;
    if (lostFocus && boardHadFocus.current) cell.focus();
  });

  const canAct = session?.role !== 'front-desk';

  const act = async (treatment: Treatment, action: 'given' | 'reopen'): Promise<void> => {
    try {
      await api('POST', `/api/treatments/${treatment.id}/${action}`);
      board.reload();
      announce(
        action === 'given'
          ? `${treatment.patientName}, ${treatment.name} marked given.`
          : `${treatment.patientName}, ${treatment.name} reopened.`,
      );
      setAlert(null);
    } catch (error) {
      setAlert(messageOf(error));
      board.reload();
    }
  };

  const moveFocus = (direction: 'next' | 'previous' | 'down' | 'up'): void => {
    const flat = grouped.filter((group) => group.cells.length > 0);
    if (flat.length === 0) return;
    let groupIndex = flat.findIndex((group) =>
      group.cells.some((cell) => cell.id === focusId),
    );
    if (groupIndex === -1) {
      groupIndex = 0;
      setFocusId(flat[0].cells[0].id);
      shouldFocus.current = true;
      return;
    }
    const cells = flat[groupIndex].cells;
    const index = cells.findIndex((cell) => cell.id === focusId);
    const column = index % columns;
    const choose = (target: string | undefined): void => {
      if (!target) return;
      setFocusId(target);
      shouldFocus.current = true;
    };
    if (direction === 'next') {
      if (index + 1 < cells.length) {
        choose(cells[index + 1].id);
        return;
      }
      choose(flat[groupIndex + 1]?.cells[0]?.id);
      return;
    }
    if (direction === 'previous') {
      if (index > 0) {
        choose(cells[index - 1].id);
        return;
      }
      const previous = flat[groupIndex - 1];
      choose(previous?.cells[previous.cells.length - 1]?.id);
      return;
    }
    if (direction === 'down') {
      const nextRowStart = (Math.floor(index / columns) + 1) * columns;
      if (nextRowStart < cells.length) {
        choose(cells[Math.min(index + columns, cells.length - 1)].id);
        return;
      }
      const nextGroup = flat[groupIndex + 1];
      if (!nextGroup) return;
      const firstRowLength = Math.min(columns, nextGroup.cells.length);
      choose(nextGroup.cells[Math.min(column, firstRowLength - 1)].id);
      return;
    }
    if (index >= columns) {
      choose(cells[index - columns].id);
      return;
    }
    const previousGroup = flat[groupIndex - 1];
    if (!previousGroup) return;
    const lastRowStart = Math.floor((previousGroup.cells.length - 1) / columns) * columns;
    choose(
      previousGroup.cells[Math.min(lastRowStart + column, previousGroup.cells.length - 1)].id,
    );
  };

  const focused = treatments.find((treatment) => treatment.id === focusId) ?? null;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      moveFocus('next');
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus('previous');
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      moveFocus('down');
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      moveFocus('up');
      return;
    }
    if (!focused || !canAct) return;
    if (key === ' ') {
      event.preventDefault();
      void act(focused, event.shiftKey ? 'reopen' : 'given');
      return;
    }
    if (key === 'n' || key === 'N') {
      event.preventDefault();
      setNoteFor(focused);
      return;
    }
    if (key === 's' || key === 'S') {
      event.preventDefault();
      setSkipFor(focused);
    }
  };

  const tally = <KennelBeacon beacons={board.data?.beacons ?? null} />;

  return (
    <div className="screen">
      <SplitBand
        headline={
          <div className="headline-row">
            <h1>Ward, today</h1>
            <ClinicDateText />
          </div>
        }
        actions={canAct ? <Pill onClick={() => setAdmitting(true)}>Admit patient</Pill> : null}
        right={tally}
      />
      <div className="screen-body">
        <AlertBanner message={alert} />
        {treatments.length === 0 ? (
          <EmptyCard
            title="No patients are in the ward."
            action={
              canAct ? { label: 'Admit a patient', onClick: () => setAdmitting(true) } : undefined
            }
          />
        ) : (
          <div
            className="ward-board"
            role="grid"
            aria-label="Ward board"
            ref={container}
            onKeyDown={onKeyDown}
          >
            {grouped.map((group) => (
              <div role="rowgroup" aria-label={group.name} key={group.name} className="ward-group">
                <p className="ward-group-title" aria-hidden="true">
                  {group.name}
                </p>
                {chunk(group.cells, columns).map((row, rowIndex) => (
                  <div role="row" className="ward-row" key={rowIndex}>
                    {row.map((treatment) => {
                      const isFocused = treatment.id === focusId;
                      return (
                        <div
                          role="gridcell"
                          key={treatment.id}
                          className={`ward-cell status-${treatment.status}`}
                          aria-label={treatmentCellName(treatment)}
                          data-testid={`dose-${treatment.id}`}
                          data-ward-focus={isFocused ? 'true' : undefined}
                          tabIndex={isFocused ? 0 : -1}
                          onFocus={() => {
                            boardHadFocus.current = true;
                            setFocusId(treatment.id);
                          }}
                          onClick={() => setFocusId(treatment.id)}
                          {...motionAttributes('board-status')}
                        >
                          <div className="ward-cell-head">
                            <Avatar name={treatment.patientName} />
                            <div>
                              <p className="card-title">{treatment.patientName}</p>
                              <p className="ward-cell-meta">
                                {treatment.kennel} · {treatment.name}
                              </p>
                            </div>
                          </div>
                          <p className="ward-cell-time">{hm(treatment.scheduledAt)}</p>
                          <p className="ward-cell-status">{STATUS_TEXT[treatment.status]}</p>
                          {treatment.skipReason ? (
                            <p className="ward-cell-note">{treatment.skipReason}</p>
                          ) : null}
                          {treatment.notes.map((note) => (
                            <p className="ward-cell-note" key={note.id}>
                              {note.text}
                            </p>
                          ))}
                          {canAct ? (
                            <div className="ward-cell-actions">
                              {treatment.status === 'given' || treatment.status === 'skipped' ? (
                                <Pill
                                  variant="secondary"
                                  name={`Reopen, ${treatment.patientName}, ${treatment.name}`}
                                  onClick={() => void act(treatment, 'reopen')}
                                >
                                  Reopen
                                </Pill>
                              ) : (
                                <Pill
                                  name={`Mark given, ${treatment.patientName}, ${treatment.name}`}
                                  onClick={() => void act(treatment, 'given')}
                                >
                                  Mark given
                                </Pill>
                              )}
                              <Pill
                                variant="secondary"
                                name={`Add note, ${treatment.patientName}, ${treatment.name}`}
                                onClick={() => setNoteFor(treatment)}
                              >
                                Add note
                              </Pill>
                              <Pill
                                variant="secondary"
                                name={`Skip, ${treatment.patientName}, ${treatment.name}`}
                                onClick={() => setSkipFor(treatment)}
                              >
                                Skip
                              </Pill>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {admitting ? (
        <AdmitPatientDialog
          onClose={() => setAdmitting(false)}
          onAdmitted={(patientName, kennel) => {
            setAdmitting(false);
            board.reload();
            announce(`${patientName} admitted to ${kennel}.`);
          }}
        />
      ) : null}
      {noteFor ? (
        <AddNoteDialog
          treatment={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={() => {
            const treatment = noteFor;
            setNoteFor(null);
            board.reload();
            announce(`Note saved for ${treatment.patientName}, ${treatment.name}.`);
          }}
        />
      ) : null}
      {skipFor ? (
        <SkipTreatmentDialog
          treatment={skipFor}
          onClose={() => setSkipFor(null)}
          onSkipped={() => {
            const treatment = skipFor;
            setSkipFor(null);
            board.reload();
            announce(`${treatment.patientName}, ${treatment.name} skipped.`);
          }}
        />
      ) : null}
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function AddNoteDialog({
  treatment,
  onClose,
  onSaved,
}: {
  treatment: Treatment;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (text.trim().length === 0) {
      setSummary([{ field: 'Note', message: 'Note is required.' }]);
      return;
    }
    setBusy(true);
    try {
      await api('POST', `/api/treatments/${treatment.id}/notes`, { text });
      onSaved();
    } catch (error) {
      setSummary([{ field: 'Note', message: messageOf(error) }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      name="Add note"
      onClose={onClose}
      summary={summary}
      onSummaryLink={() => document.getElementById('ward-note')?.focus()}
    >
      <div className="field">
        <label htmlFor="ward-note">Note</label>
        <textarea
          id="ward-note"
          value={text}
          aria-describedby={summary.length > 0 ? 'ward-note-error' : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        {summary.length > 0 ? (
          <p className="field-error" id="ward-note-error">
            {summary[0].message}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Save note
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}

function SkipTreatmentDialog({
  treatment,
  onClose,
  onSkipped,
}: {
  treatment: Treatment;
  onClose: () => void;
  onSkipped: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (reason.trim().length === 0) {
      setSummary([{ field: 'Reason', message: 'Reason is required.' }]);
      return;
    }
    setBusy(true);
    try {
      await api('POST', `/api/treatments/${treatment.id}/skip`, { reason });
      onSkipped();
    } catch (error) {
      setSummary([{ field: 'Reason', message: messageOf(error) }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      name="Skip treatment"
      onClose={onClose}
      summary={summary}
      onSummaryLink={() => document.getElementById('ward-skip-reason')?.focus()}
    >
      <div className="field">
        <label htmlFor="ward-skip-reason">Reason</label>
        <textarea
          id="ward-skip-reason"
          value={reason}
          aria-describedby={summary.length > 0 ? 'ward-skip-error' : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {summary.length > 0 ? (
          <p className="field-error" id="ward-skip-error">
            {summary[0].message}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Skip treatment
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}

const KENNELS = Array.from({ length: 12 }, (_, index) => `K${index + 1}`);

function AdmitPatientDialog({
  onClose,
  onAdmitted,
}: {
  onClose: () => void;
  onAdmitted: (patientName: string, kennel: string) => void;
}): JSX.Element {
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [patientId, setPatientId] = useState('');
  const [kennel, setKennel] = useState('K1');
  const [treatment, setTreatment] = useState('');
  const [firstDose, setFirstDose] = useState('');
  const [intervalHours, setIntervalHours] = useState('8');
  const [doses, setDoses] = useState('4');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<{ patients: { id: string; name: string }[] }>('/api/patients').then((data) =>
      setPatients(data.patients),
    );
  }, []);

  const submit = async (): Promise<void> => {
    const problems: SummaryItem[] = [];
    if (!patientId) problems.push({ field: 'Patient', message: 'Patient is required.' });
    if (!treatment.trim()) problems.push({ field: 'Treatment', message: 'Treatment is required.' });
    if (!firstDose.trim()) problems.push({ field: 'First dose', message: 'First dose is required.' });
    if (problems.length > 0) {
      setSummary(problems);
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/api/ward/admissions', {
        patientId,
        kennel,
        treatments: [
          {
            name: treatment.trim(),
            firstAt: firstDose.trim(),
            intervalHours: Number(intervalHours),
            count: Number(doses),
          },
        ],
      });
      onAdmitted(patients.find((patient) => patient.id === patientId)?.name ?? '', kennel);
    } catch (error) {
      const field =
        error instanceof RequestFailed && error.field?.includes('firstAt') ? 'First dose' : 'Patient';
      setSummary([{ field, message: messageOf(error) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      name="Admit patient"
      onClose={onClose}
      summary={summary}
      onSummaryLink={(field) => {
        const ids: Record<string, string> = {
          Patient: 'admit-patient',
          Treatment: 'admit-treatment',
          'First dose': 'admit-first-dose',
        };
        document.getElementById(ids[field] ?? 'admit-patient')?.focus();
      }}
    >
      <div className="field">
        <label htmlFor="admit-patient">Patient</label>
        <select
          id="admit-patient"
          value={patientId}
          onChange={(event) => setPatientId(event.target.value)}
        >
          <option value="">Choose a patient</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="admit-kennel">Kennel</label>
        <select id="admit-kennel" value={kennel} onChange={(event) => setKennel(event.target.value)}>
          {KENNELS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="admit-treatment">Treatment</label>
        <input
          id="admit-treatment"
          type="text"
          value={treatment}
          onChange={(event) => setTreatment(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="admit-first-dose">First dose</label>
        <input
          id="admit-first-dose"
          type="text"
          value={firstDose}
          placeholder="2026-11-17 08:00"
          onChange={(event) => setFirstDose(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="admit-interval">Every (hours)</label>
        <input
          id="admit-interval"
          type="number"
          min={1}
          max={24}
          value={intervalHours}
          onChange={(event) => setIntervalHours(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="admit-doses">Doses</label>
        <input
          id="admit-doses"
          type="number"
          min={1}
          max={28}
          value={doses}
          onChange={(event) => setDoses(event.target.value)}
        />
      </div>
      <div className="dialog-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Admit
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}
