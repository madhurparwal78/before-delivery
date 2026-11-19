import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Value } from "../../../shared/expression.js";
import { SCALE_LABELS, TABLE_FIELDS, fieldSpec, labelOf } from "../../../shared/fields.js";
import type { Table } from "../../../shared/types.js";
import type { FormPolicy } from "../../../server/rules.js";
import { ApiFailure, del, failureText, get, patch, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { usePresence } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, StatusBlock } from "../../lib/ui.js";
import { SlaPanel } from "../../components/Sla.js";
import { useSlaFeed } from "../../lib/sla.js";
import { Activity } from "./Activity.js";
import { Attachments } from "./Attachments.js";
import { ChangePanels } from "./ChangePanels.js";
import { ConflictDialog, OverrideDialog, type Verdict } from "./Dialogs.js";
import { FieldControl } from "./FieldControl.js";
import { ProblemsGroup } from "./ProblemsGroup.js";
import { Suggestions, useSuggestions } from "./Suggestions.js";
import { useDirectories } from "./directory.js";
import { isBlank, sameAsStored, type Conflict, type Detail, type Draft, type Problem } from "./model.js";
import { applyPolicies } from "./policies.js";
import { localTextToIso } from "../../../shared/tz.js";

type Action = { kind: "save" } | { kind: "move"; to: string };

interface Props {
  detail: Detail;
  onRecord(record: Detail): void;
  reload(): void;
  onBack: (() => void) | undefined;
  focusHeading: boolean;
  /** Called once the heading holds focus, so the caller can stop asking for it. */
  onHeadingFocused: (() => void) | undefined;
}

function shownValue(table: Table, name: string, value: Value, detail: Detail): string {
  if (value === null || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const spec = fieldSpec(table, name);
  if ((name === "impact" || name === "urgency") && typeof value === "number") return `${value} ${SCALE_LABELS[value] ?? ""}`.trim();
  if (spec?.kind === "reference" && detail.fields[name]?.value === value) return detail.fields[name]!.display;
  return String(value);
}

/** The form of one loaded record: edits stay in a draft until they are saved or a transition sends them. */
export function RecordView({ detail, onRecord, reload, onBack, focusHeading, onHeadingFocused }: Props): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const number = detail.number;
  const table = detail.table;
  const uid = useId();
  const zone = session.user?.time_zone ?? "UTC";
  const username = session.user?.username ?? "";
  const roles = session.user?.roles ?? [];
  const approver = roles.includes("approver");
  const manager = roles.includes("manager");

  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsNonce, setProblemsNonce] = useState(0);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ list: Conflict[]; action: Action } | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [viewers, setViewers] = useState<Array<{ username: string; display_name: string }>>([]);
  const [policies, setPolicies] = useState<FormPolicy[]>([]);
  const [typed, setTyped] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const problemsGroup = useRef<HTMLDivElement>(null);

  const suggested = useSuggestions(typed);
  const slas = useSlaFeed(number, detail.slas, true);
  usePresence(number, setViewers);

  useEffect(() => {
    if (!focusHeading) return;
    heading.current?.focus();
    onHeadingFocused?.();
  }, [focusHeading, number]);

  useEffect(() => {
    let current = true;
    get<{ form_policies: FormPolicy[] }>("/api/form-policies").then(
      (loaded) => current && setPolicies(loaded.form_policies),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (problems.length > 0) problemsGroup.current?.focus();
  }, [problemsNonce, problems.length]);

  const names = TABLE_FIELDS[table].map((spec) => spec.name).filter((name) => name in detail.fields);
  const directories = useDirectories(
    [...new Set(names.map((name) => fieldSpec(table, name)).flatMap((spec) => (spec?.kind === "reference" && spec.reference ? [spec.reference] : [])))],
    session.isDesk,
    manager,
  );

  const valueOf = (name: string): Value => (draft[name] ? draft[name].value : (detail.fields[name]?.value ?? null));
  const editing = Object.keys(draft).length > 0;
  const serverNow = detail.slas[0] ? Date.parse(detail.slas[0].server_time) : 0;
  const states = useMemo(
    () => (editing ? applyPolicies(policies, table, { number, username, roles, valueOf, serverNow }) : null),
    [editing, policies, draft, detail],
  );
  const flags = (name: string): { visible: boolean; mandatory: boolean; readOnly: boolean } => {
    const field = detail.fields[name]!;
    if (!states) return { visible: field.visible, mandatory: field.mandatory, readOnly: field.read_only };
    const state = states[name] ?? {};
    return { visible: state.visible !== false, mandatory: state.mandatory === true, readOnly: fieldSpec(table, name)?.readOnly === true || state.read_only === true };
  };

  const edit = (name: string, value: Value): void => {
    const spec = fieldSpec(table, name)!;
    const stored = detail.fields[name]!;
    setDraft((previous) => {
      const next = { ...previous };
      if (sameAsStored(spec, value, stored.value, stored.display)) delete next[name];
      else next[name] = { value, version: previous[name]?.version ?? stored.version };
      return next;
    });
    setErrors(({ [name]: _removed, ...rest }) => rest);
    setFlagged((previous) => previous.filter((f) => f !== name));
    if (name === "short_description") setTyped(String(value ?? ""));
  };

  const fieldId = (name: string): string => `${uid}-${name}`;
  const focusField = (name: string): void => document.getElementById(fieldId(name))?.focus();

  const requestFields = (source: Draft): Record<string, { value: Value; version: number }> => {
    const body: Record<string, { value: Value; version: number }> = {};
    for (const [name, entry] of Object.entries(source)) {
      const state = flags(name);
      if (!state.visible || state.readOnly) continue;
      const instant = fieldSpec(table, name)?.kind === "instant" && !isBlank(entry.value);
      body[name] = { value: instant ? (localTextToIso(String(entry.value), zone) ?? String(entry.value)) : entry.value, version: entry.version };
    }
    return body;
  };

  const labelFor = (name: string): string => detail.fields[name]?.label ?? labelOf(table, name);

  const run = async (action: Action, source: Draft, then?: () => void): Promise<void> => {
    setPending(action.kind === "save" ? "save" : action.to);
    setMessage("");
    setErrors({});
    setFlagged([]);
    setProblems([]);
    try {
      const fields = requestFields(source);
      const response =
        action.kind === "save"
          ? await patch<{ record: Detail }>(`/api/records/${number}`, { fields })
          : await post<{ record: Detail }>(`/api/records/${number}/transition`, { to: action.to, fields });
      setDraft({});
      setConflict(null);
      onRecord(response.record);
      if (action.kind === "move") {
        heading.current?.focus();
        announce(`${number} moved to ${response.record.state_label}.`);
      } else {
        then?.();
        announce(`Saved ${number}.`);
      }
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "field_conflict") {
        const list = failure.extra.conflicts as Conflict[];
        setConflict({ list, action });
        announce(`Conflict on ${list[0]!.label}: ${list[0]!.theirs_by} saved a newer value.`);
      } else if (failure instanceof ApiFailure && failure.fields && action.kind === "save") {
        setConflict(null);
        const found = Object.entries(failure.fields);
        setErrors(failure.fields);
        setProblems(found.map(([field, text]) => ({ field, label: labelFor(field), message: text })));
        setProblemsNonce((n) => n + 1);
        announce(`${found.length} problems to fix before saving.`);
      } else {
        setConflict(null);
        if (failure instanceof ApiFailure && failure.fields) setFlagged(Object.keys(failure.fields));
        setMessage(failureText(failure));
      }
    } finally {
      setPending(null);
    }
  };

  const apply = (choices: Record<string, Verdict>): void => {
    if (!conflict) return;
    const next: Draft = { ...draft };
    for (const c of conflict.list) {
      if (choices[c.field] === "theirs") delete next[c.field];
      else next[c.field] = { value: next[c.field]?.value ?? c.yours, version: c.version };
    }
    const first = conflict.list[0]!.field;
    const action = conflict.action;
    setDraft(next);
    if (Object.keys(next).length === 0 && action.kind === "save") {
      setConflict(null);
      reload();
      focusField(first);
      return;
    }
    void run(action, next, () => focusField(first));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (pending === null) void run({ kind: "save" }, draft);
    }
  };

  const removeOverride = (): void => {
    del<{ record: Detail }>(`/api/records/${number}/priority-override`).then(
      (response) => {
        onRecord(response.record);
        announce(`Saved ${number}.`);
      },
      (failure: unknown) => setMessage(failureText(failure)),
    );
  };

  const editable = names.filter((name) => {
    const state = flags(name);
    return state.visible && !state.readOnly && fieldSpec(table, name)?.kind !== "object";
  });
  const facts = names.filter((name) => {
    const state = flags(name);
    return state.visible && (state.readOnly || fieldSpec(table, name)?.kind === "object") && name !== "number" && name !== "state";
  });
  const lead = detail.fields.title?.display ?? detail.fields.short_description?.display ?? "";
  const others = viewers.filter((v) => v.username !== username);
  const links = detail.links;
  const hasLinks = links.parent || links.children.length > 0 || links.problem || links.incidents.length > 0 || links.fix_change;
  const priority = detail.fields.priority;

  return (
    <>
      {onBack ? (
        <div className="rf-back">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      ) : null}
      <form className="record" aria-label={number} noValidate onSubmit={(event) => event.preventDefault()} onKeyDown={onKeyDown}>
        <header className="rf-head">
          <h2 ref={heading} tabIndex={-1} className="rf-number">
            {number}
          </h2>
          <StatusBlock>{detail.state_label}</StatusBlock>
        </header>
        {lead ? <p className="rf-lead">{lead}</p> : null}

        {detail.workaround ? (
          <section className="rf-section" aria-label={`Workaround from ${detail.workaround.problem}`}>
            <h3>Workaround from {detail.workaround.problem}</h3>
            <p className="rf-workaround">{detail.workaround.text}</p>
          </section>
        ) : null}

        <div className="rf-section">
          <h3>Details</h3>
          {facts.length > 0 ? (
            <dl className="rf-facts">
              {facts.map((name) => (
                <div key={name} className="rf-fact">
                  <dt>{labelFor(name)}</dt>
                  <dd>
                    {detail.fields[name]!.display === "" ? "None" : detail.fields[name]!.display}
                    {name === "priority" && detail.priority_overridden ? <StatusBlock>Priority overridden</StatusBlock> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {session.isOperator && priority ? (
            <div className="row">
              <Button variant="outline" onClick={() => setOverriding(true)}>
                Override priority
              </Button>
              {detail.priority_overridden ? (
                <Button variant="outline" onClick={removeOverride}>
                  Remove override
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="rf-fields">
            {editable.map((name) => {
              const spec = fieldSpec(table, name)!;
              const field = detail.fields[name]!;
              const edited = draft[name];
              const value = edited ? edited.value : spec.kind === "instant" ? field.display : field.value;
              return (
                <Fragment key={name}>
                  <FieldControl
                    spec={spec}
                    id={fieldId(name)}
                    label={labelFor(name)}
                    mandatory={flags(name).mandatory}
                    value={value}
                    display={field.display}
                    choices={spec.reference ? directories[spec.reference] : undefined}
                    error={errors[name]}
                    flagged={flagged.includes(name)}
                    onChange={(next) => edit(name, next)}
                  />
                {name === "short_description" ? <Suggestions articles={suggested} /> : null}
              </Fragment>
              );
            })}
          </div>
          {problems.length > 0 ? <ProblemsGroup problems={problems} groupRef={problemsGroup} onPick={focusField} /> : null}
          <div className="row">
            <Button busy={pending === "save"} onClick={() => pending === null && void run({ kind: "save" }, draft)}>
              {pending === "save" ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="rf-section">
          <h3>SLA</h3>
          <SlaPanel slas={slas} />
        </div>

        {detail.transitions.length > 0 || message ? (
          <div className="rf-section">
            <h3>Next step</h3>
            <div className="row">
              {detail.transitions.map((move) => (
                <Button key={move.to} variant="outline" busy={pending === move.to} onClick={() => pending === null && void run({ kind: "move", to: move.to }, draft)}>
                  {pending === move.to ? "Moving..." : `Move to ${move.label}`}
                </Button>
              ))}
            </div>
            {message ? <p className="form-error">{message}</p> : null}
          </div>
        ) : null}

        <div className="rf-section">
          <h3>Also viewing</h3>
          {others.length > 0 ? (
            <ul aria-label="Also viewing" className="rf-viewers">
              {others.map((v) => (
                <li key={v.username} aria-label={`${v.display_name} is viewing`}>
                  {v.display_name} is viewing
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No one else is viewing this record.</p>
          )}
        </div>

        {table === "change" && (session.isDesk || approver) ? <ChangePanels number={number} version={detail} scored={!!detail.fields.configuration_item?.value && !!detail.fields.planned_start?.value && !!detail.fields.planned_end?.value} username={username} operator={session.isOperator} zone={zone} /> : null}

        <Activity number={number} desk={session.isDesk} zone={zone} version={detail} />
        <Attachments number={number} files={detail.attachments} onChanged={reload} />

        {hasLinks ? (
          <section className="rf-section" aria-label="Links">
            <h3>Links</h3>
            <dl className="rf-links">
              <LinkRow label="Parent" numbers={links.parent ? [links.parent] : []} />
              <LinkRow label="Children" numbers={links.children} />
              <LinkRow label="Problem" numbers={links.problem ? [links.problem] : []} />
              <LinkRow label="Linked incidents" numbers={links.incidents} />
              <LinkRow label="Fix change" numbers={links.fix_change ? [links.fix_change] : []} />
            </dl>
          </section>
        ) : null}
      </form>
      {conflict ? <ConflictDialog conflicts={conflict.list} describe={(field, value) => shownValue(table, field, value, detail)} onApply={apply} onCancel={() => setConflict(null)} /> : null}
      {overriding && priority ? (
        <OverrideDialog
          number={number}
          priority={Number(priority.value)}
          onClose={() => setOverriding(false)}
          onDone={(record) => {
            setOverriding(false);
            onRecord(record);
            announce(`Saved ${number}.`);
          }}
        />
      ) : null}
    </>
  );
}

function LinkRow({ label, numbers }: { label: string; numbers: string[] }): JSX.Element | null {
  if (numbers.length === 0) return null;
  return (
    <div className="rf-link-row">
      <dt>{label}</dt>
      <dd>
        {numbers.map((n) => (
          <Link key={n} to={`/desk/records/${n}`}>
            {n}
          </Link>
        ))}
      </dd>
    </div>
  );
}
