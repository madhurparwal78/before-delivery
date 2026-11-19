import { useState, type FormEvent } from "react";
import { TABLE_LABELS, TABLES } from "../../../shared/types.js";
import { Modal } from "../../lib/dialog.js";
import { Button } from "../../lib/ui.js";
import { CheckField, Labelled } from "./controls.js";
import { ADDABLE_TYPES, TYPE_LABELS, type Step, type StepType } from "./tree.js";

export function AddStepDialog({ onAdd, onClose }: { onAdd: (type: StepType, name: string) => void; onClose: () => void }): JSX.Element {
  const [type, setType] = useState<StepType>(ADDABLE_TYPES[0]!);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Step name is required.");
      return;
    }
    onAdd(type, name.trim());
  };

  return (
    <Modal label="Add step" onClose={onClose}>
      <h2>Add step</h2>
      <form className="stack" onSubmit={submit}>
        <Labelled label="Step type">
          {(described) => (
            <select {...described} value={type} onChange={(event) => setType(event.target.value as StepType)}>
              {ADDABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Labelled>
        <Labelled label="Step name" error={error ?? undefined}>
          {(described) => <input {...described} type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
        </Labelled>
        <div className="row">
          <Button type="submit">Add step</Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteStepDialog({ step, onDelete, onClose }: { step: Step; onDelete: () => void; onClose: () => void }): JSX.Element {
  const nestedCount = (["then", "else", "body", "on_error"] as const).reduce((sum, lane) => sum + (step[lane]?.length ?? 0), 0);
  return (
    <Modal label="Delete step" onClose={onClose} initialFocus="[data-keep]">
      <h2>Delete step</h2>
      <p>
        Delete {step.name}, {TYPE_LABELS[step.type]}?{nestedCount > 0 ? " The steps inside its lanes go with it." : ""}
      </p>
      <div className="row">
        <Button onClick={onDelete}>Delete</Button>
        <Button variant="outline" onClick={onClose} data-keep="">
          Keep
        </Button>
      </div>
    </Modal>
  );
}

type Values = Record<string, string | boolean>;

interface EditField {
  key: string;
  label: string;
  kind: "text" | "area" | "select" | "check";
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  when?: (values: Values) => boolean;
}

interface Editor {
  fields: EditField[];
  initial: Values;
  build(values: Values): { step: Step } | { errors: Record<string, string> };
}

const NOT_JSON = "Enter valid JSON.";

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function stringMap(text: string): Record<string, string> | string {
  const parsed = parseJson(text);
  if (!parsed.ok) return NOT_JSON;
  const value = parsed.value;
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.values(value).some((v) => typeof v !== "string")) return "Enter a JSON object of names and expressions.";
  return value as Record<string, string>;
}

function stringList(text: string): string[] | string {
  const parsed = parseJson(text);
  if (!parsed.ok) return NOT_JSON;
  return Array.isArray(parsed.value) && parsed.value.every((v) => typeof v === "string") ? (parsed.value as string[]) : "Enter a JSON list of text values.";
}

const orNull = (text: unknown): string | null => (typeof text === "string" && text.trim() !== "" ? text : null);

function editorFor(step: Step): Editor {
  const name: EditField = { key: "name", label: "Step name", kind: "text" };
  const named = (values: Values): Record<string, string> => (typeof values.name === "string" && values.name.trim() !== "" ? {} : { name: "Step name is required." });
  const text = (values: Values, key: string): string => String(values[key] ?? "");
  const finish = (errors: Record<string, string>, make: () => Step): { step: Step } | { errors: Record<string, string> } => (Object.keys(errors).length > 0 ? { errors } : { step: make() });
  const base = (values: Values): Step => ({ ...step, name: text(values, "name").trim() });

  switch (step.type) {
    case "trigger":
      return {
        fields: [
          name,
          {
            key: "on",
            label: "Runs when",
            kind: "select",
            options: [
              { value: "record_created", label: "A record is created" },
              { value: "record_updated", label: "A record is updated" },
              { value: "item_ordered", label: "A catalog item is ordered" },
            ],
          },
          { key: "table", label: "Table", kind: "select", options: TABLES.map((t) => ({ value: t, label: TABLE_LABELS[t] })), when: (v) => v.on !== "item_ordered" },
          { key: "items", label: "Catalog items", kind: "area", hint: "A JSON list of catalog item ids.", when: (v) => v.on === "item_ordered" },
          { key: "condition", label: "Condition", kind: "area" },
        ],
        initial: { name: step.name, on: step.on ?? "record_created", table: step.table ?? "incident", items: JSON.stringify(step.items ?? []), condition: step.condition ?? "true" },
        build: (values) => {
          const errors = named(values);
          const items = stringList(text(values, "items"));
          if (typeof items === "string" && values.on === "item_ordered") errors.items = items;
          return finish(errors, () => {
            const on = text(values, "on") as NonNullable<Step["on"]>;
            return {
              ...base(values),
              on,
              table: on === "item_ordered" ? "request_item" : (text(values, "table") as NonNullable<Step["table"]>),
              items: on === "item_ordered" && Array.isArray(items) ? items : [],
              condition: text(values, "condition"),
            };
          });
        },
      };
    case "if":
      return {
        fields: [name, { key: "condition", label: "Condition", kind: "area" }],
        initial: { name: step.name, condition: step.condition ?? "" },
        build: (values) => finish(named(values), () => ({ ...base(values), condition: text(values, "condition") })),
      };
    case "loop":
      return {
        fields: [
          name,
          { key: "over", label: "Loop over", kind: "area", hint: "A list expression. Leave empty to repeat until the condition below holds." },
          { key: "until", label: "Loop until", kind: "area", hint: "A condition that ends the loop. Leave empty to stop at the end of the list." },
        ],
        initial: { name: step.name, over: step.over ?? "", until: step.until ?? "" },
        build: (values) => finish(named(values), () => ({ ...base(values), over: orNull(values.over), until: orNull(values.until) })),
      };
    case "approval":
      return {
        fields: [
          name,
          {
            key: "kind",
            label: "Approvers",
            kind: "select",
            options: [
              { value: "department_approvers", label: "Department approvers" },
              { value: "user", label: "A named person" },
            ],
          },
          { key: "user", label: "Approver username", kind: "text", when: (v) => v.kind === "user" },
          {
            key: "rule",
            label: "Rule",
            kind: "select",
            options: [
              { value: "any", label: "Any approver" },
              { value: "all", label: "All approvers" },
            ],
          },
        ],
        initial: { name: step.name, kind: step.approvers?.kind ?? "department_approvers", user: step.approvers?.user ?? "", rule: step.rule ?? "any" },
        build: (values) => {
          const errors = named(values);
          if (values.kind === "user" && text(values, "user").trim() === "") errors.user = "Approver username is required.";
          return finish(errors, () => ({
            ...base(values),
            approvers: values.kind === "user" ? { kind: "user", user: text(values, "user").trim() } : { kind: "department_approvers", user: null },
            rule: text(values, "rule") === "all" ? "all" : "any",
          }));
        },
      };
    case "create_task":
      return {
        fields: [
          name,
          { key: "group", label: "Task group", kind: "text" },
          { key: "short_description", label: "Short description", kind: "text" },
          { key: "wait", label: "Wait for the task", kind: "check" },
        ],
        initial: { name: step.name, group: step.group ?? "", short_description: step.short_description ?? "", wait: step.wait !== false },
        build: (values) => finish(named(values), () => ({ ...base(values), group: text(values, "group"), short_description: text(values, "short_description"), wait: values.wait === true })),
      };
    case "set_fields":
      return {
        fields: [name, { key: "fields", label: "Fields", kind: "area", hint: 'A JSON object of field names and expressions, for example {"state": "\\"resolved\\""}.' }],
        initial: { name: step.name, fields: JSON.stringify(step.fields ?? {}) },
        build: (values) => {
          const errors = named(values);
          const fields = stringMap(text(values, "fields"));
          if (typeof fields === "string") errors.fields = fields;
          return finish(errors, () => ({ ...base(values), fields: typeof fields === "string" ? {} : fields }));
        },
      };
    case "wait":
      return {
        fields: [name, { key: "units", label: "Units", kind: "text", hint: "Whole wait units, one or more." }],
        initial: { name: step.name, units: String(step.units ?? 1) },
        build: (values) => {
          const errors = named(values);
          const units = Number(text(values, "units").trim());
          if (!Number.isInteger(units) || units < 1) errors.units = "Enter a whole number of 1 or more.";
          return finish(errors, () => ({ ...base(values), units }));
        },
      };
    case "subflow":
      return {
        fields: [name, { key: "flow", label: "Flow", kind: "text" }, { key: "inputs", label: "Inputs", kind: "area", hint: "A JSON object of input names and expressions." }],
        initial: { name: step.name, flow: step.flow ?? "", inputs: JSON.stringify(step.inputs ?? {}) },
        build: (values) => {
          const errors = named(values);
          const inputs = stringMap(text(values, "inputs"));
          if (typeof inputs === "string") errors.inputs = inputs;
          return finish(errors, () => ({ ...base(values), flow: text(values, "flow").trim(), inputs: typeof inputs === "string" ? {} : inputs }));
        },
      };
    case "notify":
      return {
        fields: [name, { key: "to", label: "To", kind: "area", hint: 'A JSON object such as {"users": ["oona"], "roles": []}.' }, { key: "text", label: "Text", kind: "area" }],
        initial: { name: step.name, to: JSON.stringify(step.to ?? { users: [], roles: [] }), text: step.text ?? "" },
        build: (values) => {
          const errors = named(values);
          const parsed = parseJson(text(values, "to"));
          const target = parsed.ok && typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value) ? (parsed.value as { users?: unknown; roles?: unknown }) : null;
          const valid = (list: unknown): list is string[] | undefined => list === undefined || (Array.isArray(list) && list.every((v) => typeof v === "string"));
          if (!parsed.ok) errors.to = NOT_JSON;
          else if (!target || !valid(target.users) || !valid(target.roles)) errors.to = "Enter a JSON object with users and roles lists.";
          return finish(errors, () => ({ ...base(values), to: { users: (target?.users as string[] | undefined) ?? [], roles: (target?.roles as string[] | undefined) ?? [] }, text: text(values, "text") }));
        },
      };
    default:
      return {
        fields: [name],
        initial: { name: step.name },
        build: (values) => finish(named(values), () => base(values)),
      };
  }
}

/** Edits one step; saving hands the changed step to `onSave`, which answers the API message when the draft is refused. */
export function EditStepDialog({ step, onSave, onClose }: { step: Step; onSave: (next: Step) => Promise<string | null>; onClose: () => void }): JSX.Element {
  const editor = editorFor(step);
  const [values, setValues] = useState<Values>(editor.initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const built = editor.build(values);
    if ("errors" in built) {
      setErrors(built.errors);
      setFailure(null);
      return;
    }
    setErrors({});
    setBusy(true);
    const refusal = await onSave(built.step);
    if (refusal !== null) {
      setFailure(refusal);
      setBusy(false);
    }
  };

  return (
    <Modal label={`Edit step ${step.name}`} onClose={onClose}>
      <h2>Edit step</h2>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        {editor.fields
          .filter((field) => !field.when || field.when(values))
          .map((field) => {
            const set = (value: string | boolean): void => setValues((previous) => ({ ...previous, [field.key]: value }));
            if (field.kind === "check") return <CheckField key={field.key} label={field.label} checked={values[field.key] === true} onChange={set} />;
            return (
              <Labelled key={field.key} label={field.label} hint={field.hint} error={errors[field.key]}>
                {(described) =>
                  field.kind === "select" ? (
                    <select {...described} value={String(values[field.key] ?? "")} onChange={(event) => set(event.target.value)}>
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.kind === "area" ? (
                    <textarea {...described} rows={3} value={String(values[field.key] ?? "")} onChange={(event) => set(event.target.value)} spellCheck={false} />
                  ) : (
                    <input {...described} type="text" value={String(values[field.key] ?? "")} onChange={(event) => set(event.target.value)} autoComplete="off" />
                  )
                }
              </Labelled>
            );
          })}
        {failure ? <p className="form-error">{failure}</p> : null}
        <div className="row">
          <Button type="submit" busy={busy} disabled={busy}>
            Save step
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
