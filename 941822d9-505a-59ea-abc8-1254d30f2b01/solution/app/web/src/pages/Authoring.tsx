import { useState } from "react";
import { api, type Course, type User } from "../api";
import { instantDate, STATE_LABELS } from "../format";
import { Alert, FieldError, useFeedback } from "../ui/feedback";
import { Empty, Icon } from "../ui/icons";
import { PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { courseFailure } from "./Planner";

interface ModuleDraft {
  title: string;
  minutes: string;
  kind: "lesson" | "evaluation";
  body: string;
  prompt: string;
  options: string[];
  answer: string;
}

interface Draft {
  id: string | null;
  version: number;
  state: Course["state"];
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  listPrice: string;
  modules: ModuleDraft[];
}

interface HistoryEntry {
  from: string;
  to: string;
  by: { id: string; display_name: string };
  note: string | null;
  at: string;
}

const blankLesson = (): ModuleDraft => ({ title: "", minutes: "20", kind: "lesson", body: "", prompt: "", options: ["", "", "", "", ""], answer: "0" });
const blankEvaluation = (): ModuleDraft => ({ title: "Post-evaluation", minutes: "10", kind: "evaluation", body: "", prompt: "", options: ["", "", "", "", ""], answer: "0" });

function fromCourse(course: Course): Draft {
  return {
    id: course.id,
    version: course.version,
    state: course.state,
    title: course.title,
    summary: course.summary,
    format: course.format,
    listPrice: course.list_price,
    modules: (course.modules ?? []).map((m) => {
      const options = [...(m.question?.options ?? [])];
      while (options.length < 5) options.push("");
      return {
        title: m.title,
        minutes: String(m.minutes),
        kind: m.kind,
        body: m.body ?? "",
        prompt: m.question?.prompt ?? "",
        options,
        answer: String(m.question?.answer_index ?? 0),
      };
    }),
  };
}

function payload(draft: Draft): Record<string, unknown> {
  return {
    title: draft.title,
    summary: draft.summary,
    format: draft.format,
    list_price: draft.listPrice,
    modules: draft.modules.map((m) => {
      const minutes = /^\d+$/.test(m.minutes) ? parseInt(m.minutes, 10) : m.minutes;
      if (m.kind === "evaluation") return { title: m.title, minutes, kind: m.kind };
      const options = m.options.map((o) => o.trim()).filter(Boolean);
      return { title: m.title, minutes, kind: m.kind, body: m.body, question: { prompt: m.prompt, options, answer_index: parseInt(m.answer, 10) } };
    }),
  };
}

function Editor({ draft, user, onSaved }: { draft: Draft; user: User; onSaved: (course: Course) => void }) {
  const { announce } = useFeedback();
  const [form, setForm] = useState(draft);
  const [pending, setPending] = useState<"save" | "submit" | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const history = useLoad(() => (form.id ? api<{ history: HistoryEntry[] }>("GET", `/api/courses/${form.id}/history`) : Promise.resolve({ history: [] as HistoryEntry[] })));
  const editable = form.state === "draft" || (user.role === "planner" && form.state === "in_review");

  const update = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));
  const updateModule = (index: number, patch: Partial<ModuleDraft>) =>
    setForm((f) => ({ ...f, modules: f.modules.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));

  const save = async (): Promise<Course | null> => {
    const body = payload(form);
    const response = form.id
      ? await api<{ course: Course }>("PATCH", `/api/courses/${form.id}`, body, { "If-Match": `"${form.version}"` })
      : await api<{ course: Course }>("POST", "/api/courses", body);
    setForm(fromCourse(response.course));
    setFields({});
    return response.course;
  };

  const run = async (action: "save" | "submit") => {
    if (pending) return;
    setPending(action);
    setAlert(null);
    try {
      let course = await save();
      if (action === "submit" && course) {
        course = (await api<{ course: Course }>("POST", `/api/courses/${course.id}/transitions`, { to: "in_review" }, { "If-Match": `"${course.version}"` })).course;
        setForm(fromCourse(course));
        announce(`Course moved to ${STATE_LABELS.in_review}.`);
      } else {
        announce("Draft saved.");
      }
      if (course) onSaved(course);
      await history.reload();
    } catch (error) {
      const failure = courseFailure(error);
      setFields(failure.fields);
      setAlert(failure.alert);
    } finally {
      setPending(null);
    }
  };

  const err = (key: string) => ({
    "aria-invalid": fields[key] ? true : undefined,
    "aria-describedby": fields[key] ? `${key}-error` : undefined,
  });

  return (
    <form className="editor" onSubmit={(e) => e.preventDefault()} noValidate>
      <div className="section-head">
        <h2>{form.id ? form.title || "Untitled course" : "New course"}</h2>
        <span className="badge">{STATE_LABELS[form.state]} · v{form.version}</span>
      </div>
      {alert && <Alert>{alert}</Alert>}
      <div className="form-row">
        <div className="field">
          <label htmlFor="course-title">Course title</label>
          <input id="course-title" type="text" value={form.title} onChange={(e) => update({ title: e.target.value })} {...err("title")} />
          <FieldError id="title-error" message={fields.title} />
        </div>
        <div className="field">
          <label htmlFor="course-format">Format</label>
          <select id="course-format" value={form.format} onChange={(e) => update({ format: e.target.value === "cohort" ? "cohort" : "self_paced" })} {...err("format")}>
            <option value="self_paced">Self-paced</option>
            <option value="cohort">Live cohort</option>
          </select>
          <FieldError id="format-error" message={fields.format} />
        </div>
        <div className="field">
          <label htmlFor="course-price">List price (USD)</label>
          <input id="course-price" type="text" inputMode="decimal" value={form.listPrice} onChange={(e) => update({ listPrice: e.target.value })} {...err("list_price")} />
          <FieldError id="list_price-error" message={fields.list_price} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="course-summary">Summary</label>
        <textarea id="course-summary" value={form.summary} onChange={(e) => update({ summary: e.target.value })} {...err("summary")} />
        <FieldError id="summary-error" message={fields.summary} />
      </div>
      <div className="stack">
        <h3 style={{ fontSize: "var(--h4)" }}>Modules</h3>
        {["modules", "module_title", "minutes", "body", "question"].map((key) => (
          <FieldError key={key} id={`${key}-error`} message={fields[key]} />
        ))}
        {form.modules.map((m, index) => (
          <fieldset key={index} className="module-block">
            <legend>Module {index + 1}</legend>
            <div className="form-row">
              <div className="field">
                <label htmlFor={`m${index}-title`}>Module title</label>
                <input id={`m${index}-title`} type="text" value={m.title} onChange={(e) => updateModule(index, { title: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`m${index}-minutes`}>Minutes</label>
                <input id={`m${index}-minutes`} type="number" min={5} max={240} value={m.minutes} onChange={(e) => updateModule(index, { minutes: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`m${index}-kind`}>Module kind</label>
                <select id={`m${index}-kind`} value={m.kind} onChange={(e) => updateModule(index, { kind: e.target.value === "evaluation" ? "evaluation" : "lesson" })}>
                  <option value="lesson">Lesson</option>
                  <option value="evaluation">Post-evaluation</option>
                </select>
              </div>
            </div>
            {m.kind === "lesson" && (
              <>
                <div className="field">
                  <label htmlFor={`m${index}-body`}>Lesson text</label>
                  <textarea id={`m${index}-body`} value={m.body} onChange={(e) => updateModule(index, { body: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`m${index}-prompt`}>Question</label>
                  <input id={`m${index}-prompt`} type="text" value={m.prompt} onChange={(e) => updateModule(index, { prompt: e.target.value })} />
                </div>
                <div className="form-row">
                  {m.options.map((option, o) => (
                    <div className="field" key={o}>
                      <label htmlFor={`m${index}-option${o}`}>{`Option ${o + 1}`}</label>
                      <input
                        id={`m${index}-option${o}`}
                        type="text"
                        value={option}
                        onChange={(e) => updateModule(index, { options: m.options.map((x, i) => (i === o ? e.target.value : x)) })}
                      />
                    </div>
                  ))}
                </div>
                <div className="field" style={{ maxWidth: "240px" }}>
                  <label htmlFor={`m${index}-answer`}>Correct option</label>
                  <select id={`m${index}-answer`} value={m.answer} onChange={(e) => updateModule(index, { answer: e.target.value })}>
                    {m.options.map((_, o) => (
                      <option key={o} value={String(o)}>{`Option ${o + 1}`}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </fieldset>
        ))}
        <div>
          <button type="button" className="btn secondary" onClick={() => setForm((f) => ({ ...f, modules: [...f.modules.slice(0, -1), blankLesson(), ...f.modules.slice(-1)] }))}>
            <Icon name="plus" />
            Add module
          </button>
        </div>
      </div>
      <div className="row-actions">
        <button type="button" className="btn" disabled={pending !== null || !editable} onClick={() => void run("save")}>
          {pending === "save" ? "Saving…" : "Save draft"}
        </button>
        {user.role === "author" && (
          <button type="button" className="btn secondary" disabled={pending !== null || form.state !== "draft"} onClick={() => void run("submit")}>
            {pending === "submit" ? "Saving…" : "Submit for review"}
          </button>
        )}
      </div>
      {!editable && <p className="muted">This course is {STATE_LABELS[form.state].toLowerCase()} and can't be edited by you now.</p>}
      <section className="stack" aria-labelledby="history-heading">
        <h3 id="history-heading" style={{ fontSize: "var(--h4)" }}>
          Review history
        </h3>
        <ul className="history" aria-label="Review history">
          {history.data?.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <strong>{`${STATE_LABELS[h.from as Course["state"]] ?? h.from} → ${STATE_LABELS[h.to as Course["state"]] ?? h.to}`}</strong> by {h.by.display_name} on {instantDate(h.at)}
              {h.note && <p className="muted">“{h.note}”</p>}
            </li>
          ))}
        </ul>
        {history.data?.history.length === 0 && <p className="muted">No review steps yet.</p>}
      </section>
    </form>
  );
}

export function Authoring({ user }: { user: User }) {
  const courses = useLoad(() => api<{ courses: Course[] }>("GET", "/api/courses"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const mine = (courses.data?.courses ?? []).filter((c) => (user.role === "planner" ? c.state === "draft" || c.state === "in_review" : c.author.id === user.id));

  const open = async (course: Course) => {
    const full = await api<{ course: Course }>("GET", `/api/courses/${course.id}`);
    setDraft(fromCourse(full.course));
    setEditorKey((k) => k + 1);
  };

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Faculty</p>
        <PageHeading>Authoring</PageHeading>
        <p className="lede">Draft modules and post-evaluations, then submit each course to the nurse planner for review.</p>
      </div>
      {courses.failure && <Alert>{courses.failure}</Alert>}
      <div className="section-head">
        <h2>{user.role === "planner" ? "Courses in draft or review" : "Your courses"}</h2>
        {user.role === "author" && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft({ id: null, version: 1, state: "draft", title: "", summary: "", format: "self_paced", listPrice: "", modules: [blankLesson(), blankEvaluation()] });
              setEditorKey((k) => k + 1);
            }}
          >
            <Icon name="plus" />
            New course
          </button>
        )}
      </div>
      <table className="data stacks" aria-label="Authored courses">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">State</th>
            <th scope="col" className="fig">
              Version
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {mine.map((c) => (
            <tr key={c.id}>
              <td className="course" data-label="Course">
                {c.title}
              </td>
              <td data-label="State">{STATE_LABELS[c.state]}</td>
              <td className="fig" data-label="Version">
                {c.version}
              </td>
              <td className="actions">
                <button type="button" className="btn secondary" onClick={() => void open(c)}>
                  Open<span className="sr-only"> {c.title}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {courses.data && mine.length === 0 && <Empty>No courses here yet.</Empty>}
      {draft && (
        <div className="section">
          <Editor key={editorKey} draft={draft} user={user} onSaved={() => void courses.reload()} />
        </div>
      )}
    </>
  );
}
