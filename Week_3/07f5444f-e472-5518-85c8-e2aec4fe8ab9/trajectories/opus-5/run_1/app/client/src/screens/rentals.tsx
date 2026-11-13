import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, PackagePlus } from 'lucide-react';
import type { RentalSet, RentalStatus, WorkDetail } from '../../../shared/api.js';
import { MIDDLE_DOT } from '../../../shared/format.js';
import { displayBusinessDate } from '../../../shared/london.js';
import { ApiFailure, api } from '../api.js';
import { useApp } from '../app.js';
import { Modal, useInterval, useVisibilityReturn } from '../ui.js';

const STATUS_LABELS: Record<RentalStatus, string> = {
  requested: 'Requested',
  received: 'Received',
  in_use: 'In use',
  returned: 'Returned',
  checked_in: 'Checked in',
};

interface LineState {
  typed: string;
  expected: number;
  changed: boolean;
}

export function Rentals(): JSX.Element {
  const { user, statusTick, visibilityTick } = useApp();
  const [sets, setSets] = useState<RentalSet[] | null>(null);
  const [rentalStatus, setRentalStatus] = useState<string[]>([]);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const principal = user.role === 'principal_librarian';

  const load = useCallback(async () => {
    try {
      const answer = await api.rentalSets();
      setSets(answer.rental_sets);
    } catch {
      /* a failed read leaves the screen as it is */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useInterval(() => void load(), 60_000);
  useVisibilityReturn(() => void load());
  useEffect(() => {
    if (statusTick > 0) void load();
  }, [statusTick, load]);
  useEffect(() => {
    if (visibilityTick > 0) void load();
  }, [visibilityTick, load]);

  async function changeStatus(set: RentalSet, to: RentalStatus): Promise<void> {
    setRentalStatus([to === 'returned' ? 'Marking returned' : 'Updating rental set']);
    try {
      const updated = await api.transitionRentalSet(set.id, to);
      setSets((current) =>
        current === null ? current : current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setRentalStatus([`${updated.work_title} set is now ${STATUS_LABELS[updated.status]}.`]);
      if (to === 'returned') setCheckingIn(null);
    } catch (failure) {
      setRentalStatus([
        failure instanceof ApiFailure ? failure.body.message : `${set.work_title} set was not updated.`,
      ]);
    }
  }

  const openSet = sets?.find((entry) => entry.id === checkingIn) ?? null;

  return (
    <main className="rentals">
      <div className="rentals-heading">
        <h1>Rentals</h1>
        {principal ? (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            <PackagePlus className="icon" aria-hidden="true" focusable="false" />
            New rental set
          </button>
        ) : null}
      </div>

      <table role="table" aria-label="Rental sets" className="rental-table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Work
            </th>
            <th role="columnheader" scope="col">
              Publisher
            </th>
            <th role="columnheader" scope="col">
              Programme
            </th>
            <th role="columnheader" scope="col">
              Due
            </th>
            <th role="columnheader" scope="col">
              Status
            </th>
            <th role="columnheader" scope="col">
              Copies
            </th>
            <th role="columnheader" scope="col">
              Reminder
            </th>
            <th role="columnheader" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(sets ?? []).map((set) => (
            <tr role="row" key={set.id}>
              <td role="cell" data-label="Work">
                {set.work_title}
              </td>
              <td role="cell" data-label="Publisher">
                {set.publisher}
              </td>
              <td role="cell" data-label="Programme" className="mono">
                {set.programme_number}
              </td>
              <td role="cell" data-label="Due" className="mono">
                {displayBusinessDate(set.due_date)}
              </td>
              <td role="cell" data-label="Status">
                {set.overdue ? (
                  <span>
                    <span className="overdue-mark" aria-hidden="true">
                      ▲
                    </span>{' '}
                    <span className="overdue-word">{set.display_status}</span>
                  </span>
                ) : (
                  <span>{set.display_status}</span>
                )}
              </td>
              <td role="cell" data-label="Copies" className="mono">
                {set.copies_checked_in} of {set.copies_on_slip}
              </td>
              <td role="cell" data-label="Reminder">
                {set.reminder.status === 'sent' && set.reminder.sent_at !== null
                  ? `Reminder sent ${displayBusinessDate(set.reminder.sent_at.slice(0, 10))}`
                  : set.reminder.status === 'queued'
                    ? 'Reminder queued'
                    : 'No reminder yet'}
              </td>
              <td role="cell" data-label="Actions" className="row-actions">
                {principal && set.status === 'requested' ? (
                  <button type="button" onClick={() => void changeStatus(set, 'received')}>
                    Mark received {set.work_title}
                  </button>
                ) : null}
                {principal && set.status === 'received' ? (
                  <button type="button" onClick={() => void changeStatus(set, 'in_use')}>
                    Mark in use {set.work_title}
                  </button>
                ) : null}
                {set.status === 'in_use' ? (
                  <button type="button" onClick={() => setCheckingIn(set.id)}>
                    <ClipboardCheck className="icon" aria-hidden="true" focusable="false" />
                    Check in {set.work_title}
                  </button>
                ) : null}
                {principal && set.status === 'returned' ? (
                  <button type="button" onClick={() => void changeStatus(set, 'checked_in')}>
                    Confirm publisher receipt {set.work_title}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="rental-status" role="status" aria-label="Rental status">
        {rentalStatus.map((line, index) => (
          <span key={`${index}-${line}`} className="status-line">
            {line}
          </span>
        ))}
      </p>

      {openSet ? (
        <CheckInDialog
          set={openSet}
          onClose={() => setCheckingIn(null)}
          onStatus={(lines) => setRentalStatus(lines)}
          onSaved={(updated) =>
            setSets((current) =>
              current === null ? current : current.map((entry) => (entry.id === updated.id ? updated : entry)),
            )
          }
          onMarkReturned={() => void changeStatus(openSet, 'returned')}
        />
      ) : null}

      {creating ? (
        <NewRentalSetDialog
          onClose={() => setCreating(false)}
          onStatus={(lines) => setRentalStatus(lines)}
          onCreated={(created) => {
            setCreating(false);
            setRentalStatus([`Rental set created for ${created.work_title}.`]);
            void load();
          }}
        />
      ) : null}
    </main>
  );
}

function CheckInDialog({
  set,
  onClose,
  onStatus,
  onSaved,
  onMarkReturned,
}: {
  set: RentalSet;
  onClose: () => void;
  onStatus: (lines: string[]) => void;
  onSaved: (set: RentalSet) => void;
  onMarkReturned: () => void;
}): JSX.Element {
  const [lines, setLines] = useState<Record<string, LineState>>(() => {
    const initial: Record<string, LineState> = {};
    for (const line of set.slip) {
      initial[line.part_id] = { typed: String(line.checked_in), expected: line.checked_in, changed: false };
    }
    return initial;
  });

  useEffect(() => {
    setLines((current) => {
      const next = { ...current };
      for (const line of set.slip) {
        const entry = next[line.part_id];
        if (!entry || !entry.changed) {
          next[line.part_id] = { typed: String(line.checked_in), expected: line.checked_in, changed: false };
        }
      }
      return next;
    });
  }, [set]);

  async function save(): Promise<void> {
    const changed = set.slip.flatMap((line) => {
      const entry = lines[line.part_id];
      if (!entry || !entry.changed) return [];
      return [{ part_id: line.part_id, copies: Number(entry.typed), expected: entry.expected }];
    });
    if (changed.length === 0) {
      onStatus([`Check-in counts saved for ${set.work_title}.`]);
      return;
    }
    onStatus(['Saving counts']);
    try {
      const updated = await api.checkIn(set.id, changed);
      onSaved(updated);
      setLines(() => {
        const next: Record<string, LineState> = {};
        for (const line of updated.slip) {
          next[line.part_id] = { typed: String(line.checked_in), expected: line.checked_in, changed: false };
        }
        return next;
      });
      onStatus([`Check-in counts saved for ${set.work_title}.`]);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.body.error === 'count_changed') {
        const stale = failure.body.lines ?? [];
        setLines((current) => {
          const next = { ...current };
          for (const line of stale) {
            next[line.part_id] = {
              typed: String(line.checked_in),
              expected: line.checked_in,
              changed: false,
            };
          }
          return next;
        });
        const detail = stale.map((line) => `${line.part_name} is now ${line.checked_in}`).join('; ');
        onStatus([`Counts changed while you were typing: ${detail}.`]);
        return;
      }
      if (failure instanceof ApiFailure) {
        onStatus([failure.fieldError('counts') ?? failure.body.message]);
        return;
      }
      onStatus([`Check-in counts were not saved for ${set.work_title}.`]);
    }
  }

  return (
    <Modal name={`Check in ${set.work_title}`} onClose={onClose}>
      <h2>Check in {set.work_title}</h2>
      <p className="mono">
        {set.copies_checked_in} of {set.copies_on_slip} copies checked in
      </p>
      <div className="slip">
        {set.slip.map((line) => (
          <label className="field" key={line.part_id}>
            <span>
              {line.part_name} ({line.copies} on slip)
            </span>
            <input
              type="number"
              className="mono"
              min={0}
              max={line.copies}
              step={1}
              aria-label={`Returned ${line.part_name}`}
              value={lines[line.part_id]?.typed ?? String(line.checked_in)}
              onChange={(event) => {
                const value = event.target.value;
                setLines((current) => {
                  const entry = current[line.part_id];
                  return {
                    ...current,
                    [line.part_id]: {
                      typed: value,
                      expected: entry?.changed ? entry.expected : (entry?.expected ?? line.checked_in),
                      changed: true,
                    },
                  };
                });
              }}
            />
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void save()}>
          Save counts
        </button>
        <button type="button" onClick={onMarkReturned}>
          Mark returned
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function NewRentalSetDialog({
  onClose,
  onStatus,
  onCreated,
}: {
  onClose: () => void;
  onStatus: (lines: string[]) => void;
  onCreated: (set: RentalSet) => void;
}): JSX.Element {
  const [works, setWorks] = useState<{ id: string; label: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [publisher, setPublisher] = useState('');
  const [publisherError, setPublisherError] = useState<string | undefined>(undefined);
  const [copies, setCopies] = useState<Record<string, string>>({});
  const publisherField = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api
      .programmes()
      .then(async (answer) => {
        const details = await Promise.all(answer.programmes.map((entry) => api.programme(entry.id)));
        const options = details.flatMap((detail) =>
          detail.works.map((entry) => ({
            id: entry.id,
            label: `Programme ${detail.number} ${MIDDLE_DOT} ${entry.title}`,
          })),
        );
        setWorks(options);
        setChosen(options[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (chosen === '') return;
    api
      .work(chosen)
      .then((answer) => {
        setWork(answer);
        setCopies(Object.fromEntries(answer.parts.map((part) => [part.id, '1'])));
      })
      .catch(() => undefined);
  }, [chosen]);

  async function create(): Promise<void> {
    if (!work) return;
    onStatus(['Creating rental set']);
    setPublisherError(undefined);
    try {
      const created = await api.createRentalSet({
        work_id: work.id,
        publisher,
        slip: work.parts.flatMap((part) => {
          const value = Number(copies[part.id] ?? '0');
          return value > 0 ? [{ part_id: part.id, copies: value }] : [];
        }),
      });
      onCreated(created);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 422) {
        setPublisherError(failure.fieldError('publisher'));
        onStatus(['Check the highlighted fields.']);
        publisherField.current?.focus();
        return;
      }
      onStatus([failure instanceof ApiFailure ? failure.body.message : 'The rental set was not created.']);
    }
  }

  return (
    <Modal name="New rental set" onClose={onClose}>
      <h2>New rental set</h2>
      <label className="field">
        <span>Work</span>
        <select aria-label="Work" value={chosen} onChange={(event) => setChosen(event.target.value)}>
          {works.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Publisher</span>
        <textarea
          rows={1}
          aria-label="Publisher"
          aria-describedby={publisherError ? 'new-rental-publisher-help' : undefined}
          value={publisher}
          ref={publisherField}
          onChange={(event) => setPublisher(event.target.value)}
        />
        {publisherError ? (
          <span className="field-error" id="new-rental-publisher-help">
            {publisherError}
          </span>
        ) : null}
      </label>
      <div className="slip">
        {(work?.parts ?? []).map((part) => (
          <label className="field" key={part.id}>
            <span>{part.name}</span>
            <input
              type="number"
              className="mono"
              min={0}
              max={99}
              step={1}
              aria-label={`Slip copies ${part.name}`}
              value={copies[part.id] ?? '1'}
              onChange={(event) =>
                setCopies((current) => ({ ...current, [part.id]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void create()}>
          Create rental set
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
