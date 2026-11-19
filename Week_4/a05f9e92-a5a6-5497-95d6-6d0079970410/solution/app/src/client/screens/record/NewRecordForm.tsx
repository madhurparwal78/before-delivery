import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Value } from "../../../shared/expression.js";
import { fieldSpec, PRIORITY_LABELS, TABLE_FIELDS } from "../../../shared/fields.js";
import { derivePriority, PUBLISHED_DEFAULTS } from "../../../shared/record-rules.js";
import { TABLE_LABELS, type Table } from "../../../shared/types.js";
import { localTextToIso } from "../../../shared/tz.js";
import type { FormPolicy } from "../../../server/rules.js";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useSession } from "../../lib/session.js";
import { Button } from "../../lib/ui.js";
import { FieldControl } from "./FieldControl.js";
import { useCriticalItems, useDirectories } from "./directory.js";
import { isBlank, type Detail, type Problem } from "./model.js";
import { applyPolicies } from "./policies.js";
import { ProblemsGroup } from "./ProblemsGroup.js";
import { Suggestions, useSuggestions } from "./Suggestions.js";

/** Fields that only a move, a promotion or a closing action sets, so a new record never offers them. */
const LIFECYCLE_FIELDS = new Set(["hold_reason", "resolution_code", "resolution_note", "reopen_reason", "cancel_reason", "close_note", "outcome", "freeze_override_reason", "is_major"]);

type Values = Record<string, Value>;

function startingValues(table: Table): Values {
  const values: Values = {};
  for (const spec of TABLE_FIELDS[table]) if (!spec.readOnly && spec.kind !== "object") values[spec.name] = PUBLISHED_DEFAULTS[table]?.[spec.name] ?? null;
  return values;
}

/** The form of a record that has no number yet: it creates the record on its first save and then hands over its number. */
export function NewRecordForm({ table, onBack, onCreated }: { table: Table; onBack: (() => void) | undefined; onCreated: (number: string) => void }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const uid = useId();
  const type = TABLE_LABELS[table];
  const zone = session.user?.time_zone ?? "UTC";
  const username = session.user?.username ?? "";
  const roles = session.user?.roles ?? [];
  const lead = table === "change" ? "title" : "short_description";

  const [values, setValues] = useState<Values>(() => startingValues(table));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsNonce, setProblemsNonce] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState<FormPolicy[]>([]);
  const [typed, setTyped] = useState<string | null>(null);
  const problemsGroup = useRef<HTMLDivElement>(null);
  const suggested = useSuggestions(typed);
  const critical = useCriticalItems(session.isDesk);

  const names = TABLE_FIELDS[table].filter((spec) => !spec.readOnly && spec.kind !== "object" && !LIFECYCLE_FIELDS.has(spec.name)).map((spec) => spec.name);
  const directories = useDirectories(
    [...new Set(names.map((name) => fieldSpec(table, name)).flatMap((spec) => (spec?.kind === "reference" && spec.reference ? [spec.reference] : [])))],
    session.isDesk,
    false,
  );

  const fieldId = (name: string): string => `${uid}-${name}`;
  const focusField = (name: string): void => document.getElementById(fieldId(name))?.focus();

  useEffect(() => {
    focusField(lead);
  }, []);

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

  const states = useMemo(() => applyPolicies(policies, table, { number: "", username, roles, valueOf: (name) => values[name] ?? null, serverNow: 0 }), [policies, values]);
  const shown = names.filter((name) => states[name]?.visible !== false);
  const hasScale = names.includes("impact") && names.includes("urgency");
  const impact = values.impact;
  const urgency = values.urgency;
  const priority = hasScale && typeof impact === "number" && typeof urgency === "number" ? derivePriority(impact, urgency, critical.has(String(values.configuration_item ?? ""))) : null;

  const edit = (name: string, value: Value): void => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors(({ [name]: _removed, ...rest }) => rest);
    if (name === "short_description") setTyped(String(value ?? ""));
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setMessage("");
    setErrors({});
    setProblems([]);
    const fields: Values = {};
    for (const name of shown) {
      const spec = fieldSpec(table, name)!;
      const value = values[name]!;
      if (isBlank(value) || states[name]?.read_only === true) continue;
      fields[name] = spec.kind === "instant" ? (localTextToIso(String(value), zone) ?? String(value)) : value;
    }
    try {
      const { record } = await post<{ record: Detail }>(`/api/tables/${table}/records`, { fields });
      announce(`Saved ${record.number}.`);
      onCreated(record.number);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.fields) {
        const found = Object.entries(failure.fields);
        setErrors(failure.fields);
        setProblems(found.map(([field, text]) => ({ field, label: fieldSpec(table, field)?.label ?? field, message: text })));
        setProblemsNonce((n) => n + 1);
        announce(`${found.length} problems to fix before saving.`);
      } else setMessage(failureText(failure));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  };

  return (
    <>
      {onBack ? (
        <div className="rf-back">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      ) : null}
      <form className="record" aria-label={`New ${type}`} noValidate onSubmit={(event) => event.preventDefault()} onKeyDown={onKeyDown}>
        <header className="rf-head">
          <h2 className="rf-number">{`New ${type}`}</h2>
        </header>
        <div className="rf-section">
          <h3>Details</h3>
          {priority !== null ? (
            <dl className="rf-facts">
              <div className="rf-fact">
                <dt>Priority</dt>
                <dd>{`${priority} ${PRIORITY_LABELS[priority] ?? ""}`.trim()}</dd>
              </div>
            </dl>
          ) : null}
          <div className="rf-fields">
            {shown.map((name) => {
              const spec = fieldSpec(table, name)!;
              return (
                <Fragment key={name}>
                  <FieldControl
                    spec={spec}
                    id={fieldId(name)}
                    label={spec.label}
                    mandatory={states[name]?.mandatory === true}
                    value={values[name]!}
                    display=""
                    choices={spec.reference ? directories[spec.reference] : undefined}
                    error={errors[name]}
                    flagged={false}
                    onChange={(next) => edit(name, next)}
                  />
                  {name === "short_description" ? <Suggestions articles={suggested} /> : null}
                </Fragment>
              );
            })}
          </div>
          {problems.length > 0 ? <ProblemsGroup problems={problems} groupRef={problemsGroup} onPick={focusField} /> : null}
          {message ? <p className="form-error">{message}</p> : null}
          <div className="row">
            <Button busy={saving} onClick={() => void save()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
