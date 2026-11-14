import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useSession } from "./main";
import { api, clubDate, clubTime, errorText, get, goSignIn } from "./lib";
import { Alert, Empty, FieldError, PendingButton } from "./ui";

type Lesson = {
  id: string;
  court: number;
  start: string;
  minutes: number;
  shares: { position: number; player: { name: string }; status: string }[];
};

const fieldOrder = ["court", "start", "minutes", "weeks", "students"];

export function CoachPage() {
  const { me } = useSession();
  const coachId = me?.coach_id ?? "";
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [court, setCourt] = useState("1");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [weeks, setWeeks] = useState("1");
  const [students, setStudents] = useState(["", "", "", ""]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const a = await get<{ items: Lesson[] }>(`/api/lessons?coach_id=${encodeURIComponent(coachId)}`);
    if (a.status === 200) setLessons(a.data.items);
    else setAlert(errorText(a));
  }, [coachId]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (pending) return;
    setErrors({});
    setAlert("");
    const body = {
      coach_id: coachId,
      court: Number(court),
      start: `${date.trim()}T${time.trim()}`,
      minutes,
      weeks: weeks.trim() === "" ? undefined : Number(weeks),
      students: students.map((s) => s.trim()).filter(Boolean),
    };
    setPending(true);
    const a = await api("POST", "/api/lessons", body);
    setPending(false);
    if (a.status === 401) return goSignIn();
    if (a.status === 201) {
      load();
      return;
    }
    if (a.status === 422 && a.error?.errors) {
      setErrors(a.error.errors);
      const first = fieldOrder.find((f) => a.error!.errors![f]);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus());
      return;
    }
    setAlert(errorText(a));
  };

  return (
    <div class="column page">
      <h1>Coach</h1>
      <form
        ref={form}
        aria-label="New lesson block"
        class="card form-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>New lesson block</h2>
        <div class="form-grid">
          <div class="field">
            <label for="l-court">Court</label>
            <select id="l-court" data-field="court" value={court} onChange={(e) => setCourt((e.target as HTMLSelectElement).value)}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option value={String(n)}>Court {n}</option>
              ))}
            </select>
            {errors.court && <FieldError text={errors.court} />}
          </div>
          <div class="field">
            <label for="l-date">Date</label>
            <input id="l-date" type="text" placeholder="2027-03-22" data-field="start" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="l-time">Start time</label>
            <input id="l-time" type="text" placeholder="10:00" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
            {errors.start && <FieldError text={errors.start} />}
          </div>
          <div class="field">
            <span class="label">Length</span>
            <div role="radiogroup" aria-label="Length" class="lengths">
              {[60, 90, 120].map((m) => (
                <label class={"length" + (minutes === m ? " checked" : "")}>
                  <input type="radio" name="lesson-length" data-field={m === minutes ? "minutes" : undefined} checked={minutes === m} onChange={() => setMinutes(m)} />
                  {m} minutes
                </label>
              ))}
            </div>
            {errors.minutes && <FieldError text={errors.minutes} />}
          </div>
          <div class="field">
            <label for="l-weeks">Weeks</label>
            <input id="l-weeks" type="number" min={1} max={8} data-field="weeks" value={weeks} onInput={(e) => setWeeks((e.target as HTMLInputElement).value)} />
            {errors.weeks && <FieldError text={errors.weeks} />}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div class="field">
              <label for={`l-st-${i}`}>Student {i + 1} email</label>
              <input
                id={`l-st-${i}`}
                type="email"
                data-field={i === 0 ? "students" : undefined}
                value={students[i]}
                onInput={(e) => {
                  const n = [...students];
                  n[i] = (e.target as HTMLInputElement).value;
                  setStudents(n);
                }}
              />
            </div>
          ))}
        </div>
        {errors.students && <FieldError text={errors.students} />}
        <Alert text={alert} />
        <PendingButton label="Book lesson block" pendingLabel="Booking..." pending={pending} onClick={submit} />
      </form>
      {lessons === null ? null : lessons.length === 0 ? (
        <Empty>No lesson blocks yet.</Empty>
      ) : (
        <table class="data-table stacked" aria-label="Lesson blocks">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Court</th>
              <th scope="col">Students</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => (
              <tr>
                <td data-label="Date">{clubDate(l.start)}</td>
                <td data-label="Time">
                  {clubTime(l.start)} · {l.minutes} min
                </td>
                <td data-label="Court">Court {l.court}</td>
                <td data-label="Students">
                  <ul class="students">
                    {l.shares.map((s) => (
                      <li>
                        {s.player.name} <span class={"share-status share-" + s.status}>{s.status === "paid" ? "Paid" : "Due"}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
