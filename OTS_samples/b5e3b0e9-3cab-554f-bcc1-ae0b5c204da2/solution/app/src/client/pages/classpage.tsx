import { useLayoutEffect, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import { Dialog } from "../components/dialog.tsx";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { useMe } from "../me.ts";
import { Link, navigate } from "../router.tsx";
import { Loading, NotFound } from "./shared.tsx";

interface ClassBody {
  id: string;
  name: string;
  students: { id: string; name: string; email?: string }[];
  assignments: { id: string; scenarioId: string; scenario: string; dueOn: string; sessionId: string | null }[];
  invitations?: { email: string; status: string }[];
}

function InviteForm({ classId, onSent }: { classId: string; onSent: () => Promise<void> }) {
  const form = useForm();
  const [emails, setEmails] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Sending...");
    try {
      const list = emails.split(/[,\n]/).map((e) => e.trim()).filter((e) => e !== "");
      const answer = await api<{ sent: string[] }>("POST", `/api/classes/${classId}/invitations`, { emails: list });
      form.succeed(`Invitations sent: ${answer.sent.length}`);
      setEmails("");
      await onSent();
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <form class="cell form" onSubmit={(event) => void submit(event)}>
      <h2>Invite students</h2>
      <div class="field">
        <label for="field-emails">Student emails</label>
        <textarea
          id="field-emails"
          rows={3}
          value={emails}
          aria-invalid={form.state.errors.emails ? "true" : undefined}
          onInput={(event) => setEmails(event.currentTarget.value)}
        />
        {form.state.errors.emails && <p class="field-error">{form.state.errors.emails}</p>}
      </div>
      <button type="submit">Send invitations</button>
      <FormFeedback form={form} fields={{ emails: "Student emails" }} />
    </form>
  );
}

function AssignDialog({ classId, onClose, onSaved }: { classId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const form = useForm();
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([]);
  const [scenario, setScenario] = useState("");
  const [dueOn, setDueOn] = useState("");
  useLayoutEffect(() => {
    api<{ id: string; name: string }[]>("GET", "/api/scenarios").then((list) => {
      setScenarios(list);
      setScenario((current) => current || (list[0]?.id ?? ""));
    });
  }, []);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    try {
      await api("POST", `/api/classes/${classId}/assignments`, { scenario, dueOn });
      await onSaved();
      onClose();
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <Dialog label="Assign exercise" onClose={onClose}>
      <form class="form" onSubmit={(event) => void submit(event)}>
        <div class="field">
          <label for="field-scenario">Scenario</label>
          <select id="field-scenario" value={scenario} onChange={(event) => setScenario(event.currentTarget.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <TextField name="dueOn" label="Due on" value={dueOn} onInput={setDueOn} error={form.state.errors.dueOn} placeholder="YYYY-MM-DD" />
        <div class="actions">
          <button type="submit">Save assignment</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        <FormFeedback form={form} fields={{ scenario: "Scenario", dueOn: "Due on" }} />
      </form>
    </Dialog>
  );
}

export function ClassPage({ id }: { id: string }) {
  const { me } = useMe();
  const [body, setBody] = useState<ClassBody | "loading" | "missing">("loading");
  const [assigning, setAssigning] = useState(false);
  const [saved, setSaved] = useState("");
  const startForm = useForm();
  const load = async (): Promise<void> => {
    try {
      setBody(await api<ClassBody>("GET", `/api/classes/${id}`));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setBody("missing");
    }
  };
  useLayoutEffect(() => {
    void load();
  }, [id]);
  if (body === "loading") return <Loading />;
  if (body === "missing" || !me) return <NotFound />;
  const instructor = me.role === "instructor";
  const start = async (assignment: ClassBody["assignments"][number]): Promise<void> => {
    startForm.begin("Starting...");
    try {
      const made = await api<{ id: string }>("POST", "/api/sessions", { scenario: assignment.scenarioId, assignment: assignment.id });
      navigate(`/sessions/${made.id}`);
    } catch (error) {
      startForm.fail(error);
    }
  };
  return (
    <div class="page">
      <h1>{body.name}</h1>
      <section class="cell">
        <h2>Students</h2>
        <ul aria-label="Students" class="link-list">
          {body.students.map((student) => (
            <li key={student.id}>{instructor ? <Link href={`/records/${student.id}`}>{student.name}</Link> : student.name}</li>
          ))}
        </ul>
        {body.students.length === 0 && <p class="empty">No students yet. Invite them by email.</p>}
        {!instructor && <Link href={`/records/${me.id}`}>My record</Link>}
      </section>
      {instructor && <InviteForm classId={id} onSent={load} />}
      {instructor && body.invitations && body.invitations.length > 0 && (
        <section class="cell">
          <h2>Invitations</h2>
          <ul aria-label="Invitations" class="link-list">
            {body.invitations.map((invite, index) => (
              <li key={`${invite.email}-${index}`}>
                {invite.email} <span class="muted">{invite.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section class="cell">
        <h2>Exercises</h2>
        <table aria-label="Assignments" role="table" class="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Scenario</th>
              <th role="columnheader">Due on</th>
              <th role="columnheader">Exercise</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {body.assignments.map((assignment) => (
              <tr role="row" key={assignment.id}>
                <td role="cell">{assignment.scenario}</td>
                <td role="cell">{assignment.dueOn}</td>
                <td role="cell">
                  {instructor && (
                    <button type="button" onClick={() => void start(assignment)}>
                      Start exercise
                    </button>
                  )}
                  {!instructor && assignment.sessionId && <Link href={`/sessions/${assignment.sessionId}`}>Open exercise</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {body.assignments.length === 0 && <p class="empty">No exercises assigned yet.</p>}
        {instructor && (
          <button type="button" onClick={() => setAssigning(true)}>
            Assign exercise
          </button>
        )}
        <p role="status" aria-label="Form status" class="form-status">
          {saved}
        </p>
        <FormFeedback form={startForm} />
      </section>
      {assigning && (
        <AssignDialog
          classId={id}
          onClose={() => setAssigning(false)}
          onSaved={async () => {
            setSaved("Assignment saved.");
            await load();
          }}
        />
      )}
    </div>
  );
}
