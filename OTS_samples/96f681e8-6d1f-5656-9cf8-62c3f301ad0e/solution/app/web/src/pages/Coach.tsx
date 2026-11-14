import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Share, call, messageOf } from "../api";
import { EmptyState, ErrorBand, FieldBand } from "../components/Feedback";
import { clubDate, clubTime } from "../format";
import { useSession } from "../session";

interface Lesson {
  id: string;
  court: number;
  start: string;
  minutes: number;
  shares: Share[];
}

const courts = [1, 2, 3, 4, 5, 6, 7];
const lengths = [60, 90, 120];

export function Coach() {
  const session = useSession();
  const me = session.state === "signed-in" ? session.me : null;
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [court, setCourt] = useState("1");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [weeks, setWeeks] = useState("1");
  const [students, setStudents] = useState(["", "", "", ""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    if (!me?.coach_id) return;
    try {
      setLessons((await call<{ items: Lesson[] }>(`/api/lessons?coach_id=${encodeURIComponent(me.coach_id)}`)).items);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [me?.coach_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const focusField = (problems: Record<string, string>) => {
    const order = ["court", "start", "minutes", "weeks", "students"];
    const first = order.find((f) => problems[f]);
    const name: Record<string, string> = { court: "Court", start: "Date", minutes: "Date", weeks: "Weeks", students: "Student 1 email" };
    if (first) window.setTimeout(() => form.current?.querySelector<HTMLElement>(`[aria-label="${name[first]}"]`)?.focus(), 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    try {
      await call("/api/lessons", {
        method: "POST",
        body: {
          coach_id: me?.coach_id,
          court: Number(court),
          start: `${date}T${time}`,
          minutes,
          weeks: Number(weeks),
          students: students.map((s) => s.trim()).filter(Boolean),
        },
      });
      setStudents(["", "", "", ""]);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && Object.keys(e.fields).length > 0) {
        setFields(e.fields);
        focusField(e.fields);
      } else setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">Coach</h1>
        <form className="card form-card" aria-label="New lesson block" ref={form} onSubmit={(e) => void submit(e)} noValidate>
          <h2 className="form-card__title">New lesson block</h2>
          <div className="form-grid">
            <div className="field">
              <label className="field__label">
                <span>Court</span>
                <select value={court} aria-label="Court" onChange={(e) => setCourt(e.target.value)}>
                  {courts.map((c) => (
                    <option key={c} value={c}>
                      Court {c}
                    </option>
                  ))}
                </select>
              </label>
              {fields.court && <FieldBand id="coach-court-error">{fields.court}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Date</span>
                <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={date} aria-label="Date" onChange={(e) => setDate(e.target.value)} />
              </label>
              {fields.start && <FieldBand id="coach-start-error">{fields.start}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Start time</span>
                <input type="text" inputMode="numeric" placeholder="HH:MM" value={time} aria-label="Start time" onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="field field--wide">
              <span className="field__label" id="coach-length">
                Length
              </span>
              <div role="radiogroup" aria-labelledby="coach-length" aria-label="Length" className="segmented">
                {lengths.map((value) => (
                  <label key={value} className="segmented__option">
                    <input type="radio" name="coach-minutes" value={value} checked={minutes === value} onChange={() => setMinutes(value)} />
                    <span>{value} minutes</span>
                  </label>
                ))}
              </div>
              {fields.minutes && <FieldBand id="coach-minutes-error">{fields.minutes}</FieldBand>}
            </div>
            <div className="field">
              <label className="field__label">
                <span>Weeks</span>
                <input type="number" min={1} max={8} value={weeks} aria-label="Weeks" onChange={(e) => setWeeks(e.target.value)} />
              </label>
              {fields.weeks && <FieldBand id="coach-weeks-error">{fields.weeks}</FieldBand>}
            </div>
          </div>
          <div className="form-grid">
            {students.map((value, i) => (
              <div className="field" key={i}>
                <label className="field__label">
                  <span>{`Student ${i + 1} email`}</span>
                  <input
                    type="email"
                    autoComplete="off"
                    value={value}
                    aria-label={`Student ${i + 1} email`}
                    onChange={(e) => setStudents(students.map((s, j) => (j === i ? e.target.value : s)))}
                  />
                </label>
                {i === 0 && fields.students && <FieldBand id="coach-students-error">{fields.students}</FieldBand>}
              </div>
            ))}
          </div>
          {error && <ErrorBand>{error}</ErrorBand>}
          <div className="form-actions">
            <button type="submit" className="pill pill--cobalt" disabled={pending}>
              {pending ? "Booking..." : "Book lesson block"}
            </button>
          </div>
        </form>

        <h2 className="section-title">Lesson blocks</h2>
        {lessons && lessons.length === 0 && <EmptyState>No lesson blocks yet.</EmptyState>}
        {lessons && lessons.length > 0 && (
          <div className="table-card" tabIndex={0}>
            <table role="table" aria-label="Lesson blocks" className="data-table data-table--stack">
              <thead>
                <tr role="row">
                  <th role="columnheader">Date</th>
                  <th role="columnheader">Time</th>
                  <th role="columnheader">Court</th>
                  <th role="columnheader">Length</th>
                  <th role="columnheader">Students</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr role="row" key={lesson.id}>
                    <td role="cell" data-label="Date">
                      {clubDate(lesson.start)}
                    </td>
                    <td role="cell" data-label="Time">
                      {clubTime(lesson.start)}
                    </td>
                    <td role="cell" data-label="Court">
                      {lesson.court}
                    </td>
                    <td role="cell" data-label="Length">
                      {lesson.minutes} minutes
                    </td>
                    <td role="cell" data-label="Students">
                      <ul className="plain-list">
                        {lesson.shares.map((share) => (
                          <li key={share.position}>
                            {share.player.name} <span className={`status-word status-word--${share.status}`}>{share.status === "paid" ? "Paid" : "Due"}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
