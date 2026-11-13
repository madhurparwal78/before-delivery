// The desk's dialogs: new programme, add work, publish folders and player notices.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  SECTION_KEYS,
  SECTION_NAMES,
  type CatalogueWork,
  type Notice,
  type ProgrammeDetail,
  type SectionKey,
} from "../../shared/api";
import { dateTimeLabel, readWallClock } from "../../shared/london";
import { call, get, type Answer } from "../api";
import { Modal } from "../ui/Modal";

const MALFORMED_TIME = "Enter a date and time like 2026-12-01 10:00.";

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  multiline?: boolean;
  inputRef?: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

/** A labelled textbox whose description carries its hint and its field message. */
export function TextField({ label, value, onChange, error, hint, multiline = false, inputRef }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          ref={inputRef}
          rows={1}
          className="field__control field__control--line"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="field__control"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

export function CountInputs({
  values,
  onChange,
  errors,
}: {
  values: Record<SectionKey, string>;
  onChange: (section: SectionKey, value: string) => void;
  errors: Partial<Record<SectionKey, string>>;
}) {
  const id = useId();
  return (
    <div className="count-inputs">
      {SECTION_KEYS.map((section) => (
        <label key={section} className={`count-input${errors[section] ? " count-input--error" : ""}`}>
          <span className="count-input__label">{SECTION_NAMES[section]}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            aria-label={SECTION_NAMES[section]}
            aria-invalid={errors[section] ? true : undefined}
            aria-describedby={errors[section] ? `${id}-${section}` : undefined}
            className="count-input__control mono"
            value={values[section]}
            onChange={(event) => onChange(section, event.target.value)}
          />
          {errors[section] && (
            <span id={`${id}-${section}`} className="field__error">
              {errors[section]}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

const numberOrText = (value: string): number | string => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : value);

interface NewProgrammeProps {
  open: boolean;
  onClose: () => void;
  onCreated: (programme: ProgrammeDetail) => void;
  setDeskStatus: (text: string) => void;
}

export function NewProgrammeDialog({ open, onClose, onCreated, setDeskStatus }: NewProgrammeProps) {
  const [title, setTitle] = useState("");
  const [rehearsal, setRehearsal] = useState("");
  const [performances, setPerformances] = useState<string[]>([""]);
  const [count, setCount] = useState<Record<SectionKey, string>>({ violin_1: "8", violin_2: "7", viola: "6", cello: "5", bass: "4" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const fields = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setRehearsal("");
    setPerformances([""]);
    setCount({ violin_1: "8", violin_2: "7", viola: "6", cello: "5", bass: "4" });
    setErrors({});
  }, [open]);

  const register = (key: string) => (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (element) fields.current.set(key, element);
    else fields.current.delete(key);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const timeOf = (key: string, text: string): string | null => {
      const read = readWallClock(text);
      if (read.kind === "timestamp") return read.timestamp;
      found[key] = read.kind === "malformed" ? MALFORMED_TIME : `There is no ${read.time} on ${read.date} in London time.`;
      return null;
    };
    const firstRehearsal = timeOf("first_rehearsal", rehearsal);
    const sent = performances.map((text, i) => timeOf(`performance_${i}`, text));
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const order = ["first_rehearsal", ...performances.map((_, i) => `performance_${i}`)];
      fields.current.get(order.find((key) => key in found) ?? "")?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    setDeskStatus("Creating programme");
    const stringCount = Object.fromEntries(SECTION_KEYS.map((section) => [section, numberOrText(count[section])]));
    const answer: Answer<ProgrammeDetail> = await call("POST", "/api/programmes", {
      title,
      first_rehearsal: firstRehearsal,
      performances: sent,
      string_count: stringCount,
    });
    setPending(false);
    if (answer.ok) {
      setDeskStatus(`Programme ${answer.data.number} created.`);
      onCreated(answer.data);
      return;
    }
    const fieldErrors = answer.error?.errors ?? {};
    const mapped: Record<string, string> = {};
    for (const [key, message] of Object.entries(fieldErrors)) {
      mapped[key.startsWith("string_count.") ? key.slice("string_count.".length) : key] = message;
    }
    setErrors(mapped);
    setDeskStatus(answer.status === 422 ? "Check the highlighted fields." : (answer.error?.message ?? "Programme not created."));
  };

  return (
    <Modal open={open} title="New programme" onDismiss={onClose}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <TextField label="Title" value={title} onChange={setTitle} error={errors.title} multiline inputRef={register("title")} />
        <TextField
          label="First rehearsal (London time)"
          value={rehearsal}
          onChange={setRehearsal}
          hint="YYYY-MM-DD HH:MM"
          error={errors.first_rehearsal}
          inputRef={register("first_rehearsal")}
        />
        {performances.map((value, i) => (
          <TextField
            key={i}
            label={`Performance ${i + 1} (London time)`}
            value={value}
            onChange={(next) => setPerformances((list) => list.map((item, j) => (j === i ? next : item)))}
            hint="YYYY-MM-DD HH:MM"
            error={errors[`performance_${i}`] ?? (i === 0 ? errors.performances : undefined)}
            inputRef={register(`performance_${i}`)}
          />
        ))}
        <button
          type="button"
          className="button button--quiet"
          disabled={performances.length >= 10}
          onClick={() => setPerformances((list) => [...list, ""])}
        >
          Add performance
        </button>
        <fieldset className="dialog-form__count">
          <legend>String count</legend>
          <CountInputs
            values={count}
            onChange={(section, value) => setCount((current) => ({ ...current, [section]: value }))}
            errors={errors}
          />
        </fieldset>
        <div className="dialog-actions">
          <button type="submit" className="button button--primary" disabled={pending}>
            Create programme
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface AddWorkProps {
  open: boolean;
  programme: ProgrammeDetail;
  onClose: () => void;
  onAdded: (workId: string) => void;
  setDeskStatus: (text: string) => void;
}

export function AddWorkDialog({ open, programme, onClose, onAdded, setDeskStatus }: AddWorkProps) {
  const [works, setWorks] = useState<CatalogueWork[]>([]);
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    void get<{ works: CatalogueWork[] }>("/api/catalogue").then((answer) => {
      if (!answer.ok) return;
      setWorks(answer.data.works);
      setChoice((current) => current || (answer.data.works[0]?.id ?? ""));
    });
  }, [open]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const work = works.find((w) => w.id === choice);
    if (!work) return;
    setPending(true);
    setDeskStatus("Adding work");
    const answer = await call<{ id: string }>("POST", `/api/programmes/${programme.id}/works`, { catalogue_work_id: work.id });
    setPending(false);
    if (answer.ok) {
      setDeskStatus(`${work.title} added to Programme ${programme.number}.`);
      onAdded(answer.data.id);
    } else if (answer.error?.error === "work_already_in_programme") {
      setDeskStatus(`${work.title} is already in this programme.`);
    } else {
      setDeskStatus(answer.error?.message ?? "The work was not added.");
    }
  };

  return (
    <Modal open={open} title="Add work" onDismiss={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Catalogue work</span>
          <select className="field__control" value={choice} onChange={(event) => setChoice(event.target.value)}>
            {works.map((work) => (
              <option key={work.id} value={work.id}>
                {work.title} — {work.composer}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="submit" className="button button--primary" disabled={pending || !choice}>
            Add
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface PublishProps {
  open: boolean;
  programme: ProgrammeDetail;
  onClose: () => void;
  onPublish: () => void;
  pending: boolean;
}

export function PublishDialog({ open, programme, onClose, onPublish, pending }: PublishProps) {
  const blockers = programme.publish_blockers;
  return (
    <Modal open={open} title="Publish folders" onDismiss={onClose}>
      <dl className="facts">
        <div>
          <dt>Programme</dt>
          <dd>
            {programme.number} · {programme.title}
          </dd>
        </div>
        <div>
          <dd>
            Seated players: <span className="mono">{programme.seated_players}</span>
          </dd>
        </div>
        <div>
          <dd>
            First rehearsal <span className="mono">{dateTimeLabel(programme.first_rehearsal)}</span>
          </dd>
        </div>
      </dl>
      <ul className="blockers" aria-label="Publish blockers">
        {blockers.map((blocker) => (
          <li key={blocker.error}>{blocker.message}</li>
        ))}
      </ul>
      {blockers.length === 0 && <p className="blockers__none">Nothing blocks publishing.</p>}
      <div className="dialog-actions">
        <button type="button" className="button button--primary" disabled={blockers.length > 0 || pending} onClick={onPublish}>
          Publish
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function NoticesDialog({ open, programmeId, onClose }: { open: boolean; programmeId: string; onClose: () => void }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setNotices(null);
    void get<{ notices: Notice[] }>(`/api/programmes/${programmeId}/notices`).then((answer) => {
      if (answer.ok) setNotices(answer.data.notices);
    });
  }, [open, programmeId]);
  return (
    <Modal open={open} title="Player notices" onDismiss={onClose}>
      <div className="dialog-scroll">
        <table className="table" aria-label="Player notices">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Chair</th>
              <th scope="col">Status</th>
              <th scope="col">Sent at</th>
            </tr>
          </thead>
          <tbody>
            {(notices ?? []).map((notice) => (
              <tr key={notice.player_id}>
                <th scope="row">{notice.name}</th>
                <td>{notice.chair_label}</td>
                <td>{notice.status === "sent" ? "Sent" : "Queued"}</td>
                <td className="mono">{notice.sent_at ? dateTimeLabel(notice.sent_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {notices?.length === 0 && <p className="empty-line">No notices yet. Notices are sent when folders are published.</p>}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
