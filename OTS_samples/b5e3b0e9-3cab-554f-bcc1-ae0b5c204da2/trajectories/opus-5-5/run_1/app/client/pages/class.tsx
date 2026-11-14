import { useCallback, useLayoutEffect, useState } from 'preact/hooks';
import { api, ApiFailure, failureText, fieldErrorsOf } from '../api.js';
import { useApp } from '../app-context.js';
import { Dialog } from '../components/dialog.js';
import { ErrorCell, Field, FormErrors, FormStatus } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';

interface ClassView {
  id: string;
  name: string;
  instructor: boolean;
  students: { id: string; name: string; email?: string }[];
  invitations: { email: string; status: string }[];
  assignments: { id: string; scenario: string; scenarioName: string; dueOn: string; sessionId: string | null }[];
}

function AssignDialog(props: { classId: string; onClose(): void; onSaved(): void; setStatus(text: string): void }) {
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([]);
  const [scenario, setScenario] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  useLayoutEffect(() => {
    void api<{ id: string; name: string }[]>('GET', '/api/scenarios').then((list) => {
      setScenarios(list);
      setScenario((current) => current || list[0]?.id || '');
    });
  }, []);
  return (
    <Dialog label="Assign exercise" onClose={props.onClose}>
      <form
        aria-label="Assign exercise"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          props.setStatus('Saving...');
          setErrors({});
          setFailure('');
          try {
            await api('POST', `/api/classes/${props.classId}/assignments`, { scenario, dueOn });
            props.setStatus('Assignment saved.');
            props.onSaved();
          } catch (error) {
            props.setStatus('');
            const fields = fieldErrorsOf(error);
            if (fields) setErrors(fields);
            else setFailure(failureText(error));
          }
        }}
      >
        <FormErrors
          errors={errors}
          fields={{ scenario: { id: 'assign-scenario', label: 'Scenario' }, dueOn: { id: 'assign-due', label: 'Due on' } }}
        />
        <div class="field">
          <label for="assign-scenario">Scenario</label>
          <select id="assign-scenario" value={scenario} onChange={(e) => setScenario(e.currentTarget.value)}>
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {errors.scenario ? <p class="field-error">{errors.scenario}</p> : null}
        </div>
        <Field id="assign-due" label="Due on" placeholder="YYYY-MM-DD" error={errors.dueOn} value={dueOn} onInput={(e) => setDueOn(e.currentTarget.value)} />
        <div class="row-buttons">
          <button type="submit" class="primary">
            Save assignment
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
        <ErrorCell label="Assignment error" text={failure} />
      </form>
    </Dialog>
  );
}

export function ClassPage({ id }: { id: string }) {
  const { me, navigate } = useApp();
  const [view, setView] = useState<ClassView | null>(null);
  const [missing, setMissing] = useState(false);
  const [emails, setEmails] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [startError, setStartError] = useState('');

  const load = useCallback(async () => {
    try {
      setView(await api<ClassView>('GET', `/api/classes/${encodeURIComponent(id)}`));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    }
  }, [id]);
  useLayoutEffect(() => {
    void load();
  }, [load]);

  if (missing) return <NotFound />;
  if (!view || !me) return <Loading />;

  return (
    <div class="grid-page">
      <section class="cell span-all">
        <h1>{view.name}</h1>
        {!view.instructor ? (
          <p>
            <a href={`/records/${me.id}`}>My record</a>
          </p>
        ) : null}
        <FormStatus text={status} />
      </section>
      <section class="cell" aria-labelledby="students-heading">
        <h2 id="students-heading">Students</h2>
        <ul aria-label="Students" class="link-list">
          {view.students.map((student) => (
            <li key={student.id}>
              {view.instructor ? <a href={`/records/${student.id}`}>{student.name}</a> : student.name}
              {student.email ? <span class="muted"> {student.email}</span> : null}
            </li>
          ))}
        </ul>
        {view.students.length === 0 ? <p class="empty">No students yet. Invite them by email.</p> : null}
      </section>
      {view.instructor ? (
        <section class="cell" aria-labelledby="invite-heading">
          <h2 id="invite-heading">Invitations</h2>
          <form
            aria-label="Send invitations"
            class="stack"
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              setStatus('Sending...');
              setErrors({});
              setFailure('');
              try {
                const list = emails.split(/[\n,]/).map((email) => email.trim()).filter(Boolean);
                const result = await api<{ sent: string[] }>('POST', `/api/classes/${view.id}/invitations`, { emails: list });
                setStatus(`Invitations sent: ${result.sent.length}`);
                setEmails('');
                await load();
              } catch (error) {
                setStatus('');
                const fields = fieldErrorsOf(error);
                if (fields) setErrors(fields);
                else setFailure(failureText(error));
              }
            }}
          >
            <FormErrors errors={errors} fields={{ emails: { id: 'student-emails', label: 'Student emails' } }} />
            <div class="field">
              <label for="student-emails">Student emails</label>
              <textarea
                id="student-emails"
                rows={3}
                aria-invalid={errors.emails ? 'true' : undefined}
                value={emails}
                onInput={(e) => setEmails(e.currentTarget.value)}
              />
              {errors.emails ? <p class="field-error">{errors.emails}</p> : null}
            </div>
            <button type="submit" class="primary">
              Send invitations
            </button>
            <ErrorCell label="Invitation error" text={failure} />
          </form>
          <ul aria-label="Invited addresses" class="link-list">
            {view.invitations.map((invitation, index) => (
              <li key={index}>
                {invitation.email} <span class="muted">{invitation.status === 'used' ? 'joined' : 'invited'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section class="cell span-all" aria-labelledby="assignments-heading">
        <h2 id="assignments-heading">Assignments</h2>
        <table aria-label="Assignments" class="data-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Due on</th>
              <th scope="col">Exercise</th>
            </tr>
          </thead>
          <tbody>
            {view.assignments.map((assignment) => (
              <tr key={assignment.id}>
                <td data-label="Scenario">{assignment.scenarioName}</td>
                <td data-label="Due on">{assignment.dueOn}</td>
                <td data-label="Exercise">
                  {view.instructor ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setStartError('');
                        try {
                          const created = await api<{ id: string }>('POST', '/api/sessions', {
                            scenario: assignment.scenario,
                            assignment: assignment.id,
                          });
                          navigate(`/sessions/${created.id}`);
                        } catch (error) {
                          setStartError(failureText(error));
                        }
                      }}
                    >
                      Start exercise
                    </button>
                  ) : assignment.sessionId ? (
                    <a href={`/sessions/${assignment.sessionId}`}>Open exercise</a>
                  ) : (
                    <span class="muted">Not open</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.assignments.length === 0 ? <p class="empty">No assignments yet.</p> : null}
        {view.instructor ? (
          <button type="button" class="primary" onClick={() => setAssigning(true)}>
            Assign exercise
          </button>
        ) : null}
        <ErrorCell label="Exercise error" text={startError} />
      </section>
      {assigning ? (
        <AssignDialog
          classId={view.id}
          setStatus={setStatus}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
