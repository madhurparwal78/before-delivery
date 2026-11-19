import { useMemo, useState, type FormEvent } from "react";
import type { Value } from "../../../shared/expression.js";
import type { CatalogItem, Variable } from "../../../server/catalog.js";
import { ApiFailure, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useSession } from "../../lib/session.js";
import { Button } from "../../lib/ui.js";
import { PUBLISHED_SERVICES } from "../../../shared/services.js";
import { Combobox, type Choice } from "../record/Combobox.js";
import { useDirectories } from "../record/directory.js";
import { refreshCart } from "./common.js";
import { applyPolicies, type FieldState, type ReadyPolicy } from "./policy.js";

/** A variable as the item response carries it: the default is already resolved for the requester. */
export type ItemVariable = Omit<Variable, "default"> & { default: Value };
export type ShownItem = Omit<CatalogItem, "variables"> & { variables: ItemVariable[] };

function offeredChoices(variable: ItemVariable, values: Record<string, Value>): ItemVariable["choices"] {
  return variable.choices.filter((choice) => choice.when === null || String(values[choice.when.variable] ?? "") === choice.when.equals);
}

export function startingValues(variables: ItemVariable[]): Record<string, Value> {
  const values: Record<string, Value> = {};
  for (const variable of variables) values[variable.name] = variable.default ?? (variable.type === "checkbox" ? false : "");
  return values;
}

/** After a change, a select whose chosen value is no longer offered goes back to empty. */
export function settle(variables: ItemVariable[], values: Record<string, Value>): Record<string, Value> {
  const next = { ...values };
  for (const variable of variables) {
    if (variable.type !== "select" || next[variable.name] === "" || next[variable.name] === undefined) continue;
    if (!offeredChoices(variable, next).some((choice) => choice.value === String(next[variable.name]))) next[variable.name] = "";
  }
  return next;
}

/** The choices a reference variable offers: its own, else the items the person may read, else the published service names, with typing kept. */
function ReferenceControl({ id, variable, value, values, invalid, describedBy, required, onChange }: { id: string; variable: ItemVariable; value: Value; values: Record<string, Value>; invalid: boolean; describedBy: string | undefined; required: boolean; onChange: (value: Value) => void }): JSX.Element {
  const session = useSession();
  const manager = session.user?.roles.includes("manager") ?? false;
  const directories = useDirectories(["ci"], session.isDesk, manager);
  const own: Choice[] = offeredChoices(variable, values);
  const readsItems = session.isDesk || manager;
  const choices = own.length > 0 ? own : (directories.ci ?? (readsItems ? [] : PUBLISHED_SERVICES.map((name) => ({ value: name, label: name }))));
  const keepTyped = own.length === 0 && !readsItems;
  return <Combobox id={id} choices={choices} value={typeof value === "string" && value !== "" ? value : null} shown="" required={required} invalid={invalid} describedBy={describedBy} keepTyped={keepTyped} onPick={(picked) => onChange(picked ?? "")} />;
}

function Control({ prefix, variable, value, state, error, onChange, values }: { prefix: string; variable: ItemVariable; value: Value; state: FieldState; error: string | undefined; onChange: (value: Value) => void; values: Record<string, Value> }): JSX.Element {
  const id = `${prefix}-${variable.name}`;
  const required = state.mandatory || variable.required;
  const common = { id, readOnly: state.read_only, "aria-required": required || undefined, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined };
  let control: JSX.Element;
  if (variable.type === "select") {
    control = (
      <select id={id} value={String(value ?? "")} disabled={state.read_only} aria-required={common["aria-required"]} aria-invalid={common["aria-invalid"]} aria-describedby={common["aria-describedby"]} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose...</option>
        {offeredChoices(variable, values).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    );
  } else if (variable.type === "reference") {
    control = <ReferenceControl id={id} variable={variable} value={value} values={values} invalid={Boolean(error)} describedBy={common["aria-describedby"]} required={Boolean(required)} onChange={onChange} />;
  } else if (variable.type === "multiline") {
    control = <textarea {...common} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  } else if (variable.type === "checkbox") {
    control = <input {...common} type="checkbox" checked={value === true} disabled={state.read_only} onChange={(event) => onChange(event.target.checked)} />;
  } else if (variable.type === "number") {
    control = <input {...common} type="number" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />;
  } else {
    control = <input {...common} type="text" placeholder={variable.type === "date" ? "YYYY-MM-DD" : undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  }
  const flags = state.read_only ? "Fixed" : required ? "Required" : null;
  return (
    <div className={`variable ${variable.type === "checkbox" ? "variable-check" : ""}`} data-variable={variable.name}>
      <div className="variable-head">
        <label htmlFor={id}>{variable.label}</label>
        {flags ? <span className="variable-flag">{flags}</span> : null}
      </div>
      {control}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The id of a variable's control, shared by the form, the problem links and the focus moves. */
export function variableId(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

/** The labelled controls for a list of variables, shown or hidden and locked by the item's form policies. */
export function VariableFields({ prefix, variables, values, states, errors, onChange }: { prefix: string; variables: ItemVariable[]; values: Record<string, Value>; states: Record<string, FieldState>; errors: Record<string, string>; onChange: (name: string, value: Value) => void }): JSX.Element {
  return (
    <>
      {variables.map((variable) => {
        const state = states[variable.name] ?? {};
        if (state.visible === false) return null;
        return <Control key={variable.name} prefix={prefix} variable={variable} value={values[variable.name] ?? ""} state={state} error={errors[variable.name]} values={values} onChange={(value) => onChange(variable.name, value)} />;
      })}
    </>
  );
}

export function submittedValues(variables: ItemVariable[], values: Record<string, Value>, states: Record<string, FieldState>): Record<string, Value> {
  const sent: Record<string, Value> = {};
  for (const variable of variables) {
    const value = values[variable.name];
    if (states[variable.name]?.visible === false || value === undefined || value === "") continue;
    sent[variable.name] = value;
  }
  return sent;
}

/** What the browser can refuse before sending: a visible variable that is required and empty, or a date that is not YYYY-MM-DD. */
export function variableProblems(variables: ItemVariable[], values: Record<string, Value>, states: Record<string, FieldState>): Record<string, string> {
  const found: Record<string, string> = {};
  for (const variable of variables) {
    const state = states[variable.name] ?? {};
    if (state.visible === false) continue;
    const value = values[variable.name];
    if (value === undefined || value === null || value === "") {
      if (variable.required || state.mandatory) found[variable.name] = `${variable.label} is required.`;
    } else if (variable.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) found[variable.name] = `${variable.label} must be a date such as 2027-01-31.`;
  }
  return found;
}

function useVariableValues(variables: ItemVariable[]): { values: Record<string, Value>; change: (name: string, value: Value) => void } {
  const [values, setValues] = useState(() => startingValues(variables));
  const change = (name: string, value: Value): void => setValues((current) => settle(variables, { ...current, [name]: value }));
  return { values, change };
}

/** The catalog item form: one control per variable, policies applied as values change, Add to cart with server field errors. */
export function ItemForm({ item, policies, onAdded }: { item: ShownItem; policies: ReadyPolicy[]; onAdded?: () => void }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const { values, change } = useVariableValues(item.variables);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | "">(1);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const username = session.user?.username ?? "";
  const states = useMemo(() => applyPolicies(policies, values, username, session.user?.roles ?? []), [policies, values, username, session.user?.roles]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setAdded(false);
    post("/api/cart/lines", { item: item.id, quantity, variables: submittedValues(item.variables, values, states) }).then(
      async () => {
        setErrors({});
        setProblem(null);
        setBusy(false);
        await refreshCart(username);
        setAdded(true);
        onAdded?.();
      },
      (error: unknown) => {
        setBusy(false);
        if (!(error instanceof ApiFailure)) {
          setProblem("Switchyard could not load this. Try again.");
          return;
        }
        const fields = error.fields ?? {};
        const count = Object.keys(fields).length;
        const text = count > 0 ? `${count} problems to fix before saving.` : error.message;
        setErrors(fields);
        setProblem(text);
        announce(text);
        const first = item.variables.find((variable) => fields[variable.name] !== undefined);
        if (first) document.getElementById(variableId("variable", first.name))?.focus();
        else if (fields.quantity) document.getElementById("variable-quantity")?.focus();
      },
    );
  };

  return (
    <form className="item-form" onSubmit={submit} noValidate>
      <VariableFields prefix="variable" variables={item.variables} values={values} states={states} errors={errors} onChange={change} />
      <div className="variable" data-variable="quantity">
        <div className="variable-head">
          <label htmlFor="variable-quantity">Quantity</label>
        </div>
        <input id="variable-quantity" type="number" min={1} max={10} value={quantity} aria-invalid={errors.quantity ? true : undefined} aria-describedby={errors.quantity ? "variable-quantity-error" : undefined} onChange={(event) => setQuantity(event.target.value === "" ? "" : Number(event.target.value))} />
        {errors.quantity ? (
          <p className="field-error" id="variable-quantity-error">
            {errors.quantity}
          </p>
        ) : null}
      </div>
      {problem ? <p className="form-error">{problem}</p> : null}
      {added && !problem ? <p className="form-done">{item.name} is in your cart.</p> : null}
      <div className="row">
        <Button type="submit" busy={busy}>
          Add to cart
        </Button>
      </div>
    </form>
  );
}
