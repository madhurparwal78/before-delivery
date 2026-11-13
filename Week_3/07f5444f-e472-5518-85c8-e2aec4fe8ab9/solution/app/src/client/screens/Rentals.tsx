// Rentals: the rental sets table, new sets, lifecycle moves and check-in against the slip.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import {
  RENTAL_STATUS_LABELS,
  type ProgrammeDetail,
  type ProgrammeSummary,
  type RentalSet,
  type RentalStatus,
  type User,
  type WorkDetail,
} from "../../shared/api";
import { dateLabel } from "../../shared/london";
import { call, get } from "../api";
import { TextField } from "../desk/Dialogs";
import { Modal } from "../ui/Modal";

const RELOAD_MS = 60_000;

interface Move {
  to: RentalStatus;
  label: string;
  principalOnly: boolean;
}

const MOVES: Partial<Record<RentalStatus, Move>> = {
  requested: { to: "received", label: "Mark received", principalOnly: true },
  received: { to: "in_use", label: "Mark in use", principalOnly: true },
  returned: { to: "checked_in", label: "Confirm publisher receipt", principalOnly: true },
};

function reminderText(set: RentalSet): string {
  if (set.reminder.status === "queued") return "Reminder queued";
  if (set.reminder.status === "sent" && set.reminder.sent_at) return `Reminder sent ${dateLabel(set.reminder.sent_at.slice(0, 10))}`;
  return "No reminder yet";
}

interface LineState {
  value: string;
  expected: number;
  changed: boolean;
}

function CheckInDialog({
  set,
  open,
  onClose,
  setRentalStatus,
  onSaved,
  returnFocus,
}: {
  set: RentalSet;
  open: boolean;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  setRentalStatus: (text: string) => void;
  onSaved: (next: RentalSet) => void;
}) {
  const [lines, setLines] = useState<Record<string, LineState>>({});

  useEffect(() => {
    if (!open) return;
    setLines(Object.fromEntries(set.slip.map((line) => [line.part_id, { value: String(line.checked_in), expected: line.checked_in, changed: false }])));
  }, [open]);

  useEffect(() => {
    setLines((current) => {
      const next = { ...current };
      for (const line of set.slip) {
        const state = next[line.part_id];
        if (state && !state.changed) next[line.part_id] = { value: String(line.checked_in), expected: line.checked_in, changed: false };
      }
      return next;
    });
  }, [set]);

  const settle = (saved: RentalSet): void => {
    setLines(Object.fromEntries(saved.slip.map((line) => [line.part_id, { value: String(line.checked_in), expected: line.checked_in, changed: false }])));
    onSaved(saved);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setRentalStatus("Saving counts");
    const counts = set.slip
      .filter((line) => lines[line.part_id]?.changed)
      .map((line) => {
        const state = lines[line.part_id];
        const text = state?.value.trim() ?? "";
        return { part_id: line.part_id, copies: /^\d+$/.test(text) ? Number(text) : text, expected: state?.expected ?? 0 };
      });
    const answer = await call<RentalSet>("PUT", `/api/rental-sets/${set.id}/check-in`, { counts });
    if (answer.ok) {
      settle(answer.data);
      setRentalStatus(`Check-in counts saved for ${set.work_title}.`);
      return;
    }
    const stale = answer.error?.lines;
    if (answer.error?.error === "count_changed" && stale) {
      setLines((current) => {
        const next = { ...current };
        for (const line of stale) next[line.part_id] = { value: String(line.checked_in), expected: line.checked_in, changed: false };
        return next;
      });
      setRentalStatus(`Counts changed while you were typing: ${stale.map((line) => `${line.part_name} is now ${line.checked_in}`).join("; ")}.`);
    } else if (answer.status === 422) {
      setRentalStatus("Returned copies must be from 0 to the slip count.");
    } else {
      setRentalStatus(answer.error?.message ?? "Counts were not saved.");
    }
  };

  const markReturned = async (): Promise<void> => {
    setRentalStatus("Marking returned");
    const answer = await call<RentalSet>("POST", `/api/rental-sets/${set.id}/transition`, { to: "returned" });
    if (answer.ok) {
      onSaved(answer.data);
      setRentalStatus(`${set.work_title} set is now Returned.`);
      onClose();
    } else {
      setRentalStatus(answer.error?.message ?? "The set was not marked returned.");
    }
  };

  return (
    <Modal open={open} title={`Check in ${set.work_title}`} onDismiss={onClose} returnFocus={returnFocus}>
      <form className="dialog-form" onSubmit={save}>
        <p className="dialog-form__lede">
          {set.publisher} · Programme <span className="mono">{set.programme_number}</span> · due{" "}
          <span className="mono">{dateLabel(set.due_date)}</span>
        </p>
        <div className="slip">
          {set.slip.map((line) => (
            <label key={line.part_id} className="slip__line">
              <span className="slip__part">{line.part_name}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={line.copies}
                className="copies-input mono"
                aria-label={`Returned ${line.part_name}`}
                value={lines[line.part_id]?.value ?? String(line.checked_in)}
                onChange={(event) => {
                  const value = event.target.value;
                  setLines((current) => {
                    const state = current[line.part_id] ?? { value, expected: line.checked_in, changed: false };
                    return { ...current, [line.part_id]: { ...state, value, changed: true } };
                  });
                }}
              />
              <span className="slip__of">
                of <span className="mono">{line.copies}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button button--primary">
            Save counts
          </button>
          <button type="button" className="button" onClick={() => void markReturned()}>
            Mark returned
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface WorkChoice {
  id: string;
  label: string;
}

function NewRentalDialog({ open, onClose, onCreated, setRentalStatus }: { open: boolean; onClose: () => void; onCreated: () => void; setRentalStatus: (text: string) => void }) {
  const [choices, setChoices] = useState<WorkChoice[]>([]);
  const [workId, setWorkId] = useState("");
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [publisher, setPublisher] = useState("");
  const [slip, setSlip] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPublisher("");
    setErrors({});
    void (async () => {
      const list = await get<{ programmes: ProgrammeSummary[] }>("/api/programmes");
      if (!list.ok) return;
      const details = await Promise.all(list.data.programmes.map((p) => get<ProgrammeDetail>(`/api/programmes/${p.id}`)));
      const found = details.flatMap((answer) =>
        answer.ok ? answer.data.works.map((w) => ({ id: w.id, label: `${w.title} — Programme ${answer.data.number} · ${answer.data.title}` })) : [],
      );
      setChoices(found);
      setWorkId((current) => current || (found[0]?.id ?? ""));
    })();
  }, [open]);

  useEffect(() => {
    if (!workId) return;
    void get<WorkDetail>(`/api/works/${workId}`).then((answer) => {
      if (!answer.ok) return;
      setWork(answer.data);
      setSlip(Object.fromEntries(answer.data.parts.map((part) => [part.id, String(part.copies.needed)])));
    });
  }, [workId]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!work) return;
    setRentalStatus("Creating rental set");
    const lines = work.parts
      .map((part) => ({ part_id: part.id, text: (slip[part.id] ?? "").trim() }))
      .filter((line) => line.text !== "" && line.text !== "0")
      .map((line) => ({ part_id: line.part_id, copies: /^\d+$/.test(line.text) ? Number(line.text) : line.text }));
    const answer = await call<RentalSet>("POST", "/api/rental-sets", { work_id: work.id, publisher, slip: lines });
    if (answer.ok) {
      setRentalStatus(`Rental set created for ${work.title}.`);
      onCreated();
      return;
    }
    if (answer.error?.error === "rental_set_open") {
      setRentalStatus(`${work.title} already has an open rental set.`);
      return;
    }
    setErrors(answer.error?.errors ?? {});
    setRentalStatus(answer.status === 422 ? "Check the highlighted fields." : (answer.error?.message ?? "The rental set was not created."));
  };

  return (
    <Modal open={open} title="New rental set" onDismiss={onClose}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field__label">Work</span>
          <select className="field__control" value={workId} onChange={(event) => setWorkId(event.target.value)}>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Publisher" value={publisher} onChange={setPublisher} error={errors.publisher} hint="The hire library, one line" multiline />
        {work && (
          <fieldset className="slip">
            <legend>Slip copies</legend>
            {work.parts.map((part) => (
              <label key={part.id} className="slip__line">
                <span className="slip__part">{part.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  className="copies-input mono"
                  aria-label={`Slip copies ${part.name}`}
                  value={slip[part.id] ?? ""}
                  onChange={(event) => setSlip((current) => ({ ...current, [part.id]: event.target.value }))}
                />
              </label>
            ))}
            {errors.slip && <p className="field__error">{errors.slip}</p>}
          </fieldset>
        )}
        <div className="dialog-actions">
          <button type="submit" className="button button--primary" disabled={!work}>
            Create rental set
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Rentals({ user }: { user: User }) {
  const [sets, setSets] = useState<RentalSet[] | null>(null);
  const [rentalStatus, setRentalStatus] = useState("");
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const principal = user.role === "principal_librarian";

  const reload = useCallback(async (): Promise<void> => {
    const answer = await get<{ rental_sets: RentalSet[] }>("/api/rental-sets");
    if (answer.ok) setSets(answer.data.rental_sets);
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), RELOAD_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  const move = async (set: RentalSet, to: RentalStatus): Promise<void> => {
    setRentalStatus("Updating rental set");
    const answer = await call<RentalSet>("POST", `/api/rental-sets/${set.id}/transition`, { to });
    if (answer.ok) {
      setSets((list) => list?.map((s) => (s.id === set.id ? answer.data : s)) ?? null);
      setRentalStatus(`${set.work_title} set is now ${RENTAL_STATUS_LABELS[answer.data.status]}.`);
    } else {
      setRentalStatus(answer.error?.message ?? "The rental set was not updated.");
    }
  };

  const open = sets?.find((s) => s.id === checkIn) ?? null;

  return (
    <main className="page rentals">
      <div className="page__head">
        <h1 className="page__title" ref={heading} tabIndex={-1}>
          Rentals
        </h1>
        {principal && (
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New rental set
          </button>
        )}
      </div>
      <p className="page__status" role="status" aria-label="Rental status">
        {rentalStatus}
      </p>
      <table className="table rental-table" role="table" aria-label="Rental sets">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Work</th>
            <th role="columnheader" scope="col">Publisher</th>
            <th role="columnheader" scope="col">Programme</th>
            <th role="columnheader" scope="col">Due</th>
            <th role="columnheader" scope="col">Status</th>
            <th role="columnheader" scope="col" className="num">
              Copies
            </th>
            <th role="columnheader" scope="col">Reminder</th>
            <th role="columnheader" scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(sets ?? []).map((set) => {
            const next = MOVES[set.status];
            return (
              <tr role="row" key={set.id}>
                <th role="rowheader" scope="row">{set.work_title}</th>
                <td role="cell" data-label="Publisher">{set.publisher}</td>
                <td role="cell" data-label="Programme" className="mono">
                  {set.programme_number}
                </td>
                <td role="cell" data-label="Due" className="mono">
                  {dateLabel(set.due_date)}
                </td>
                <td role="cell" data-label="Status">
                  {set.overdue ? (
                    <span className="short">
                      <span className="caution-mark" aria-hidden="true" />
                      <span className="short__word">{set.display_status}</span>
                    </span>
                  ) : (
                    set.display_status
                  )}
                </td>
                <td role="cell" data-label="Copies" className="num">
                  <span className="nowrap">
                    <span className="mono">{set.copies_checked_in}</span> of <span className="mono">{set.copies_on_slip}</span>
                  </span>
                </td>
                <td role="cell" data-label="Reminder">{reminderText(set)}</td>
                <td role="cell" className="rental-table__actions">
                  <div className="row-actions">
                  {next && (!next.principalOnly || principal) && (
                    <button type="button" className="button button--small" onClick={() => void move(set, next.to)}>
                      {next.label} <span className="visually-hidden">{set.work_title}</span>
                    </button>
                  )}
                  {set.status === "in_use" && (
                    <button
                      type="button"
                      className="button button--small"
                      onClick={() => {
                        setCheckIn(set.id);
                        setCheckInOpen(true);
                      }}
                    >
                      Check in <span className="visually-hidden">{set.work_title}</span>
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sets?.length === 0 && <p className="empty-line">No rental sets yet.</p>}
      {open && (
        <CheckInDialog
          set={open}
          open={checkInOpen}
          onClose={() => setCheckInOpen(false)}
          returnFocus={() => (open.status === "in_use" ? null : heading.current)}
          setRentalStatus={setRentalStatus}
          onSaved={(saved) => setSets((list) => list?.map((s) => (s.id === saved.id ? saved : s)) ?? null)}
        />
      )}
      <NewRentalDialog
        open={creating}
        onClose={() => setCreating(false)}
        setRentalStatus={setRentalStatus}
        onCreated={() => {
          setCreating(false);
          void reload();
        }}
      />
    </main>
  );
}
