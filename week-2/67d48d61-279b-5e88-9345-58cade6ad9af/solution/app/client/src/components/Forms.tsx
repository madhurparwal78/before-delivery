// The New task (and sub-task) dialog and the File a request dialog.

import { useRef, useState, type FormEvent } from "react";
import { CREW, DEPARTMENTS, PRIORITY_NAMES, crewByHandle, type IntakeRequest } from "../../../shared/catalog";
import { Unreachable, call, newKey } from "../api";
import { copy } from "../copy";
import { announce, closeDialog, createTask, emit, shown, state, useApp } from "../store";
import { ErrorSummary, FieldError } from "./bits";
import { Modal, type ModalHandle } from "./Modal";

export const NewTaskDialog = () => {
  const app = useApp();
  const dialog = app.dialog?.kind === "new-task" ? app.dialog : null;
  const parent = dialog?.parent ? shown(dialog.parent) : undefined;
  const modal = useRef<ModalHandle>(null);
  const key = useRef(newKey());
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState(
    parent?.department ?? app.view.dept ?? crewByHandle(app.actor)?.department ?? DEPARTMENTS[0].key,
  );
  const [priority, setPriority] = useState(0);
  const [owner, setOwner] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSending(true);
    const outcome = await createTask(
      { title, department, priority, owner: owner || null, ...(parent ? { parent: parent.id } : {}) },
      key.current,
    );
    setSending(false);
    if (outcome.fields) {
      setErrors(outcome.fields);
      key.current = newKey();
    }
    if (outcome.done) modal.current?.close();
  };
  const ids = { title: "new-title", department: "new-department", priority: "new-priority", owner: "new-owner" };
  const described = (field: keyof typeof ids) => (errors?.[field] ? `${ids[field]}-error` : undefined);

  return (
    <Modal ref={modal} label="New task" variant="dialog" opener={dialog?.opener} onClosed={closeDialog}>
      <form className="dialog-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2>{parent ? `New sub-task of ${parent.id}` : "New task"}</h2>
        {errors ? <ErrorSummary errors={errors} fieldIds={ids} /> : null}
        <div className="prop">
          <label htmlFor={ids.title}>Title</label>
          <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={described("title")} aria-invalid={Boolean(errors?.title)} data-autofocus />
          <FieldError id={`${ids.title}-error`} message={errors?.title} />
        </div>
        <div className="prop">
          <label htmlFor={ids.department}>Department</label>
          <select id={ids.department} value={department} onChange={(e) => setDepartment(e.target.value)} aria-describedby={described("department")}>
            {DEPARTMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.department}-error`} message={errors?.department} />
        </div>
        <div className="prop">
          <label htmlFor={ids.priority}>Priority</label>
          <select id={ids.priority} value={priority} onChange={(e) => setPriority(Number(e.target.value))} aria-describedby={described("priority")}>
            {PRIORITY_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.priority}-error`} message={errors?.priority} />
        </div>
        <div className="prop">
          <label htmlFor={ids.owner}>Owner</label>
          <select id={ids.owner} value={owner} onChange={(e) => setOwner(e.target.value)} aria-describedby={described("owner")}>
            <option value="">No owner</option>
            {CREW.map((m) => (
              <option key={m.handle} value={m.handle}>
                {m.name}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.owner}-error`} message={errors?.owner} />
        </div>
        {errors?.parent ? <p className="field-error">{errors.parent}</p> : null}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={sending}>
            Create task
          </button>
          <button type="button" className="button" onClick={() => modal.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const FileRequestDialog = () => {
  const app = useApp();
  const dialog = app.dialog?.kind === "file-request" ? app.dialog : null;
  const modal = useRef<ModalHandle>(null);
  const key = useRef(newKey());
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requester, setRequester] = useState(crewByHandle(app.actor)?.name ?? "");
  const [department, setDepartment] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFiling(true);
    setProblem(null);
    try {
      const reply = await call<{ request: IntakeRequest }>(
        "POST",
        "/api/requests",
        { title, details, requester, department },
        { "Idempotency-Key": key.current },
      );
      if (reply.ok) {
        announce(copy.filed);
        state.requestsSerial += 1;
        emit();
        modal.current?.close();
      } else if (reply.status === 422 && reply.error?.fields) {
        setErrors(reply.error.fields);
        key.current = newKey();
      } else {
        setProblem(copy.filingRefused);
        announce(copy.filingRefused);
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      setProblem(copy.offline);
      announce(copy.offline);
    } finally {
      setFiling(false);
    }
  };
  const ids = { title: "request-title", details: "request-details", requester: "request-requester", department: "request-department" };

  return (
    <Modal ref={modal} label="File a request" variant="dialog" opener={dialog?.opener} onClosed={closeDialog}>
      <form className="dialog-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2>File a request</h2>
        <p className="dialog-lede">The stage manager sees it in triage within a few seconds.</p>
        {errors ? <ErrorSummary errors={errors} fieldIds={ids} /> : null}
        {problem ? (
          <p className="inline-alert" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="prop">
          <label htmlFor={ids.title}>Request</label>
          <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus aria-invalid={Boolean(errors?.title)} />
          <FieldError id={`${ids.title}-error`} message={errors?.title} />
        </div>
        <div className="prop">
          <label htmlFor={ids.details}>Details</label>
          <textarea id={ids.details} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
          <FieldError id={`${ids.details}-error`} message={errors?.details} />
        </div>
        <div className="prop">
          <label htmlFor={ids.requester}>Your name</label>
          <input id={ids.requester} type="text" value={requester} onChange={(e) => setRequester(e.target.value)} autoComplete="name" aria-invalid={Boolean(errors?.requester)} />
          <FieldError id={`${ids.requester}-error`} message={errors?.requester} />
        </div>
        <div className="prop">
          <label htmlFor={ids.department}>Department</label>
          <select id={ids.department} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Not sure</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={filing}>
            {filing ? "Filing" : "File request"}
          </button>
          <button type="button" className="button" onClick={() => modal.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};
