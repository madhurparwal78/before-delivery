// Triage: the requests pulled from the intake, decided by keyboard with Accept, Decline and Merge.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CREW, DEPARTMENTS, PRIORITY_NAMES, departmentByKey, type IntakeRequest, type Task } from "../../../shared/catalog";
import { get, newKey } from "../api";
import { copy } from "../copy";
import { decide, useApp, type Decision } from "../store";
import { ErrorSummary, FieldError, PromptBookMark, Tape } from "./bits";
import { Modal, type ModalHandle } from "./Modal";

type Kind = "accept" | "decline" | "merge";

const TITLES: Record<Kind, string> = { accept: "Accept request", decline: "Decline request", merge: "Merge request" };
const BUTTONS: Record<Kind, string> = { accept: "Accept", decline: "Decline", merge: "Merge" };

const DecisionDialog = ({
  kind,
  task,
  request,
  opener,
  onClosed,
}: {
  kind: Kind;
  task: Task;
  request: IntakeRequest | undefined;
  opener: Element | null;
  onClosed: () => void;
}) => {
  const app = useApp();
  const modal = useRef<ModalHandle>(null);
  const key = useRef(newKey());
  const suggested = departmentByKey(request?.department)?.key ?? departmentByKey(task.department)?.key ?? "";
  const [department, setDepartment] = useState(suggested);
  const [priority, setPriority] = useState(0);
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | null>(null);
  const [sending, setSending] = useState(false);
  const mergeable = [...app.tasks.values()]
    .filter((t) => t.status === "backlog" || t.status === "todo" || t.status === "in_progress" || t.status === "done")
    .sort((a, b) => a.number - b.number);
  const ids = { department: "decide-department", priority: "decide-priority", owner: "decide-owner", label: "decide-label", reason: "decide-reason", duplicate_of: "decide-target" };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (sending) return;
    const body: Decision =
      kind === "accept"
        ? { decision: "accept", department, priority, owner: owner || null, label: label || null }
        : kind === "decline"
          ? { decision: "decline", reason }
          : { decision: "merge", duplicate_of: target };
    setSending(true);
    const outcome = await decide(task.id, body, key.current);
    setSending(false);
    if (outcome.fields) {
      setErrors(outcome.fields);
      key.current = newKey();
    }
    if (outcome.done) modal.current?.close();
  };

  return (
    <Modal ref={modal} label={TITLES[kind]} variant="dialog" opener={opener} onClosed={onClosed}>
      <form className="dialog-form" onSubmit={(e) => void submit(e)} noValidate>
        <h2>{TITLES[kind]}</h2>
        <p className="dialog-lede">
          <span className="num">{task.id}</span> {task.title}
        </p>
        {errors ? <ErrorSummary errors={errors} fieldIds={ids} /> : null}
        {kind === "accept" ? (
          <>
            <div className="prop">
              <label htmlFor={ids.department}>Department</label>
              <select
                id={ids.department}
                value={department}
                data-autofocus
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setLabel("");
                }}
              >
                {suggested ? null : <option value="">Choose a department</option>}
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
              <select id={ids.priority} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                {PRIORITY_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="prop">
              <label htmlFor={ids.owner}>Owner</label>
              <select id={ids.owner} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">No owner</option>
                {CREW.map((m) => (
                  <option key={m.handle} value={m.handle}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="prop">
              <label htmlFor={ids.label}>Label</label>
              <select id={ids.label} value={label} onChange={(e) => setLabel(e.target.value)}>
                <option value="">No label</option>
                {(departmentByKey(department)?.labels ?? []).map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
              </select>
              <FieldError id={`${ids.label}-error`} message={errors?.label} />
            </div>
          </>
        ) : null}
        {kind === "decline" ? (
          <div className="prop">
            <label htmlFor={ids.reason}>Reason</label>
            <input id={ids.reason} type="text" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus aria-invalid={Boolean(errors?.reason)} />
            <FieldError id={`${ids.reason}-error`} message={errors?.reason} />
          </div>
        ) : null}
        {kind === "merge" ? (
          <div className="prop">
            <label htmlFor={ids.duplicate_of}>Duplicate of</label>
            <select id={ids.duplicate_of} value={target} onChange={(e) => setTarget(e.target.value)} data-autofocus>
              <option value="">Choose a task</option>
              {mergeable.map((t) => (
                <option key={t.id} value={t.id}>
                  {`${t.id} ${t.title}`}
                </option>
              ))}
            </select>
            <FieldError id={`${ids.duplicate_of}-error`} message={errors?.duplicate_of} />
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={sending}>
            {sending ? "Sending to intake" : BUTTONS[kind]}
          </button>
          <button type="button" className="button" onClick={() => modal.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const TriageScreen = () => {
  const app = useApp();
  const rows = [...app.tasks.values()].filter((t) => t.status === "triage").sort((a, b) => a.number - b.number);
  const order = rows.map((r) => r.id);
  const [requests, setRequests] = useState<Map<string, IntakeRequest>>(new Map());
  const [picked, setPicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: Kind; id: string; opener: Element | null } | null>(null);
  const previous = useRef<string[]>([]);
  const focusRow = useRef(false);
  const emptyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    get<{ requests: IntakeRequest[] }>("/api/requests")
      .then((r) => live && setRequests(new Map(r.requests.map((q) => [q.id, q]))))
      .catch(() => live && setRequests(new Map()));
    return () => {
      live = false;
    };
  }, [app.requestsSerial, app.status.intake]);

  let current = picked && order.includes(picked) ? picked : null;
  if (!current && picked) {
    const at = previous.current.indexOf(picked);
    current = previous.current.slice(at + 1).find((id) => order.includes(id)) ?? [...previous.current.slice(0, Math.max(0, at))].reverse().find((id) => order.includes(id)) ?? null;
  }
  current = current ?? order[0] ?? null;

  useLayoutEffect(() => {
    previous.current = order;
    if (current !== picked) setPicked(current);
    if (focusRow.current && current) {
      focusRow.current = false;
      document.querySelector<HTMLElement>(`[role="grid"][aria-label="Triage"] [data-task-id="${current}"]`)?.focus();
    }
  });

  const onKeys = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || !current) return;
    const at = order.indexOf(current);
    const move = (index: number): void => {
      setPicked(order[Math.max(0, Math.min(order.length - 1, index))]);
      focusRow.current = true;
    };
    if (e.key === "j" || e.key === "ArrowDown") move(at + 1);
    else if (e.key === "k" || e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(order.length - 1);
    else if (e.key === "a" || e.key === "d" || e.key === "m") {
      setDialog({ kind: e.key === "a" ? "accept" : e.key === "d" ? "decline" : "merge", id: current, opener: document.activeElement });
    } else return;
    e.preventDefault();
  };

  const decided = dialog ? app.tasks.get(dialog.id) : undefined;
  return (
    <section className="triage" aria-labelledby="triage-heading">
      <div className="screen-head">
        <h2 id="triage-heading" className="screen-title">
          Triage
        </h2>
        <p className="screen-hint">
          Move with <kbd>j</kbd> and <kbd>k</kbd>. Decide with <kbd>a</kbd> accept, <kbd>d</kbd> decline, <kbd>m</kbd> merge.
        </p>
      </div>
      {rows.length ? (
        <div role="grid" aria-label="Triage" className="grid list triage-grid" onKeyDown={onKeys}>
          <div className="row triage-columns" aria-hidden="true">
            <span />
            <span>Request</span>
            <span>Requester</span>
            <span>Department</span>
          </div>
          <div role="rowgroup" aria-label={`Waiting for a decision ${rows.length}`} className="group">
            {rows.map((t) => {
              const request = t.request ? requests.get(t.request) : undefined;
              const isCurrent = t.id === current;
              return (
                <div
                  key={t.id}
                  role="row"
                  className={`row triage-row${isCurrent ? " is-current" : ""}`}
                  aria-label={`${t.id} ${t.title}`}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-selected="false"
                  data-task-id={t.id}
                  tabIndex={isCurrent ? 0 : -1}
                  onClick={() => setPicked(t.id)}
                >
                  <span role="gridcell" className="cell-id num">
                    {t.id}
                  </span>
                  <span role="gridcell" className="cell-title">
                    {t.title}
                  </span>
                  <span role="gridcell" className="cell-requester">
                    {request?.requester ?? ""}
                  </span>
                  <span role="gridcell" className="cell-dept">
                    <Tape dept={request?.department ?? null} />
                  </span>
                  <span role="gridcell" className="cell-decide">
                    {isCurrent
                      ? (["accept", "decline", "merge"] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="button small"
                            tabIndex={-1}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDialog({ kind, id: t.id, opener: e.currentTarget.closest('[role="row"]') });
                            }}
                          >
                            {BUTTONS[kind]}
                          </button>
                        ))
                      : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty">
          <PromptBookMark />
          <h2 ref={emptyHeading} tabIndex={-1}>
            {copy.triageClearHeading}
          </h2>
          <p>{copy.triageClearLine}</p>
        </div>
      )}
      {dialog && decided ? (
        <DecisionDialog
          kind={dialog.kind}
          task={decided}
          request={decided.request ? requests.get(decided.request) : undefined}
          opener={dialog.opener}
          onClosed={() => {
            setDialog(null);
            if (emptyHeading.current) emptyHeading.current.focus();
            else focusRow.current = true;
          }}
        />
      ) : null}
    </section>
  );
};
