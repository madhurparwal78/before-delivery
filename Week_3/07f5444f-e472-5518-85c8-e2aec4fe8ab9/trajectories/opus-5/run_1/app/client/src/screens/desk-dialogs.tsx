import { useEffect, useRef, useState } from 'react';
import type { CatalogueWork, Notice, ProgrammeDetail, StringCount } from '../../../shared/api.js';
import { displayInstant } from '../../../shared/london.js';
import { ApiFailure, api } from '../api.js';
import { readLondonWallClock } from '../london-input.js';
import { Modal } from '../ui.js';

const SECTION_FIELDS: { key: keyof StringCount; label: string }[] = [
  { key: 'violin_1', label: 'Violin I' },
  { key: 'violin_2', label: 'Violin II' },
  { key: 'viola', label: 'Viola' },
  { key: 'cello', label: 'Cello' },
  { key: 'bass', label: 'Bass' },
];

export function StringCountFields({
  values,
  descriptions,
  onChange,
  idPrefix,
}: {
  values: Record<keyof StringCount, string>;
  descriptions: Partial<Record<keyof StringCount, string>>;
  onChange: (key: keyof StringCount, value: string) => void;
  idPrefix: string;
}): JSX.Element {
  return (
    <div className="string-count">
      {SECTION_FIELDS.map((section) => (
        <label key={section.key}>
          <span>{section.label}</span>
          <input
            type="number"
            className="mono"
            min={0}
            step={1}
            aria-label={section.label}
            aria-describedby={descriptions[section.key] ? `${idPrefix}-${section.key}-help` : undefined}
            value={values[section.key]}
            onChange={(event) => onChange(section.key, event.target.value)}
          />
          {descriptions[section.key] ? (
            <span className="field-error" id={`${idPrefix}-${section.key}-help`}>
              {descriptions[section.key]}
            </span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

export function NewProgrammeDialog({
  onClose,
  onCreated,
  onPending,
  onFailed,
}: {
  onClose: () => void;
  onCreated: (programme: ProgrammeDetail) => void;
  onPending: () => void;
  onFailed: (message: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [firstRehearsal, setFirstRehearsal] = useState('');
  const [performances, setPerformances] = useState<string[]>(['']);
  const [counts, setCounts] = useState<Record<keyof StringCount, string>>({
    violin_1: '8',
    violin_2: '7',
    viola: '6',
    cello: '5',
    bass: '4',
  });
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [rehearsalError, setRehearsalError] = useState<string | undefined>(undefined);
  const [performanceErrors, setPerformanceErrors] = useState<Record<number, string>>({});
  const [countErrors, setCountErrors] = useState<Partial<Record<keyof StringCount, string>>>({});
  const [pending, setPending] = useState(false);
  const fields = useRef<Record<string, HTMLElement | null>>({});

  async function submit(): Promise<void> {
    if (pending) return;
    setTitleError(undefined);
    setCountErrors({});
    const rehearsal = readLondonWallClock(firstRehearsal);
    const performanceReadings = performances.map((value) => readLondonWallClock(value));
    const nextPerformanceErrors: Record<number, string> = {};
    performanceReadings.forEach((reading, index) => {
      if (reading.kind === 'invalid') nextPerformanceErrors[index] = reading.message;
    });
    setRehearsalError(rehearsal.kind === 'invalid' ? rehearsal.message : undefined);
    setPerformanceErrors(nextPerformanceErrors);
    if (rehearsal.kind === 'invalid') {
      fields.current.first_rehearsal?.focus();
      return;
    }
    const firstBadPerformance = performanceReadings.findIndex((reading) => reading.kind === 'invalid');
    if (firstBadPerformance >= 0) {
      fields.current[`performance-${firstBadPerformance}`]?.focus();
      return;
    }

    setPending(true);
    onPending();
    try {
      const programme = await api.createProgramme({
        title,
        first_rehearsal: rehearsal.timestamp,
        performances: performanceReadings.flatMap((reading) =>
          reading.kind === 'ok' ? [reading.timestamp] : [],
        ),
        string_count: {
          violin_1: Number(counts.violin_1),
          violin_2: Number(counts.violin_2),
          viola: Number(counts.viola),
          cello: Number(counts.cello),
          bass: Number(counts.bass),
        },
      });
      onCreated(programme);
    } catch (failure) {
      setPending(false);
      onFailed(failure instanceof ApiFailure ? failure.message : 'The programme was not created.');
      if (failure instanceof ApiFailure && failure.status === 422) {
        setTitleError(failure.fieldError('title'));
        setRehearsalError(failure.fieldError('first_rehearsal'));
        const nextCountErrors: Partial<Record<keyof StringCount, string>> = {};
        for (const section of SECTION_FIELDS) {
          const message = failure.fieldError(`string_count.${section.key}`);
          if (message !== undefined) nextCountErrors[section.key] = message;
        }
        setCountErrors(nextCountErrors);
        const performanceMessage = failure.fieldError('performances');
        if (performanceMessage !== undefined) setPerformanceErrors({ 0: performanceMessage });
      }
    }
  }

  return (
    <Modal name="New programme" onClose={onClose}>
      <h2>New programme</h2>
      <label className="field">
        <span>Title</span>
        <textarea
          rows={1}
          aria-label="Title"
          aria-describedby={titleError ? 'new-programme-title-help' : undefined}
          value={title}
          ref={(element) => {
            fields.current.title = element;
          }}
          onChange={(event) => setTitle(event.target.value)}
        />
        {titleError ? (
          <span className="field-error" id="new-programme-title-help">
            {titleError}
          </span>
        ) : null}
      </label>

      <label className="field">
        <span>First rehearsal (London time)</span>
        <input
          type="text"
          className="mono"
          inputMode="numeric"
          placeholder="2026-12-01 10:00"
          aria-label="First rehearsal (London time)"
          aria-describedby={rehearsalError ? 'new-programme-rehearsal-help' : undefined}
          value={firstRehearsal}
          ref={(element) => {
            fields.current.first_rehearsal = element;
          }}
          onChange={(event) => setFirstRehearsal(event.target.value)}
        />
        {rehearsalError ? (
          <span className="field-error" id="new-programme-rehearsal-help">
            {rehearsalError}
          </span>
        ) : null}
      </label>

      {performances.map((value, index) => (
        <label className="field" key={`performance-${index}`}>
          <span>{`Performance ${index + 1} (London time)`}</span>
          <input
            type="text"
            className="mono"
            placeholder="2026-12-05 19:30"
            aria-label={`Performance ${index + 1} (London time)`}
            aria-describedby={performanceErrors[index] ? `new-programme-performance-${index}-help` : undefined}
            value={value}
            ref={(element) => {
              fields.current[`performance-${index}`] = element;
            }}
            onChange={(event) =>
              setPerformances((current) => current.map((entry, at) => (at === index ? event.target.value : entry)))
            }
          />
          {performanceErrors[index] ? (
            <span className="field-error" id={`new-programme-performance-${index}-help`}>
              {performanceErrors[index]}
            </span>
          ) : null}
        </label>
      ))}
      <button
        type="button"
        onClick={() => setPerformances((current) => (current.length < 10 ? [...current, ''] : current))}
      >
        Add performance
      </button>

      <StringCountFields
        values={counts}
        descriptions={countErrors}
        idPrefix="new-programme"
        onChange={(key, value) => setCounts((current) => ({ ...current, [key]: value }))}
      />

      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void submit()}>
          Create programme
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function AddWorkDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (catalogueWorkId: string, title: string) => void;
}): JSX.Element {
  const [works, setWorks] = useState<CatalogueWork[]>([]);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    api
      .catalogue()
      .then((answer) => {
        setWorks(answer.works);
        setChosen(answer.works[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, []);

  return (
    <Modal name="Add work" onClose={onClose}>
      <h2>Add work</h2>
      <label className="field">
        <span>Catalogue work</span>
        <select aria-label="Catalogue work" value={chosen} onChange={(event) => setChosen(event.target.value)}>
          {works.map((work) => (
            <option key={work.id} value={work.id}>
              {work.title} — {work.composer}
            </option>
          ))}
        </select>
      </label>
      <div className="dialog-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const work = works.find((candidate) => candidate.id === chosen);
            if (work) onAdd(work.id, work.title);
          }}
        >
          Add
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function PublishDialog({
  programme,
  onClose,
  onPublish,
}: {
  programme: ProgrammeDetail;
  onClose: () => void;
  onPublish: () => void;
}): JSX.Element {
  const blockers = programme.publish_blockers;
  return (
    <Modal name="Publish folders" onClose={onClose}>
      <h2>Publish folders</h2>
      <p className="mono">Seated players: {programme.seated_players}</p>
      <p className="mono">First rehearsal {displayInstant(programme.first_rehearsal)}</p>
      {blockers.length === 0 ? <p>Nothing blocks publishing.</p> : null}
      <ul aria-label="Publish blockers">
        {blockers.map((blocker) => (
          <li key={blocker.error}>{blocker.message}</li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={blockers.length > 0} onClick={onPublish}>
          Publish
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function NoticesDialog({
  programmeId,
  onClose,
}: {
  programmeId: string;
  onClose: () => void;
}): JSX.Element {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    api
      .notices(programmeId)
      .then((answer) => setNotices(answer.notices))
      .catch(() => undefined);
  }, [programmeId]);

  return (
    <Modal name="Player notices" onClose={onClose}>
      <h2>Player notices</h2>
      <table role="table" aria-label="Player notices" className="notices">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Player
            </th>
            <th role="columnheader" scope="col">
              Chair
            </th>
            <th role="columnheader" scope="col">
              Status
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {notices.map((notice) => (
            <tr role="row" key={notice.player_id}>
              <td role="cell" data-label="Player">
                {notice.name}
              </td>
              <td role="cell" data-label="Chair">
                {notice.chair_label}
              </td>
              <td role="cell" data-label="Status">
                {notice.status === 'sent' ? 'Sent' : 'Queued'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
