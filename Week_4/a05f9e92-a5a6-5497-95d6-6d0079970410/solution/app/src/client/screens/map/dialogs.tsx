import { useEffect, useState, type FormEvent } from "react";
import type { ClassLabel } from "../../../server/map.js";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { Modal } from "../../lib/dialog.js";
import { Button, Field } from "../../lib/ui.js";
import { RELATIONSHIP_TYPES, sentence } from "./mapData.js";
import { localTextToIso } from "../../../shared/tz.js";

const CLASSES: ClassLabel[] = ["Configuration item", "Business service", "Application", "Server", "Virtual server", "Cluster", "Network device", "Storage"];

/** The class attributes each class adds over the base item, including those inherited, as the class tree publishes them. */
const CLASS_ATTRIBUTES: Record<ClassLabel, { name: string; kind: "text" | "integer" }[]> = {
  "Configuration item": [],
  "Business service": [],
  Application: [{ name: "version", kind: "text" }],
  Server: [
    { name: "operating_system", kind: "text" },
    { name: "location", kind: "text" },
  ],
  "Virtual server": [
    { name: "operating_system", kind: "text" },
    { name: "location", kind: "text" },
    { name: "host_name", kind: "text" },
  ],
  Cluster: [{ name: "required_healthy", kind: "integer" }],
  "Network device": [{ name: "location", kind: "text" }],
  Storage: [{ name: "capacity_gb", kind: "integer" }],
};

const ATTRIBUTE_LABELS: Record<string, string> = { capacity_gb: "Capacity (GB)" };

function DialogHead({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
  return (
    <div className="dialog-head">
      <h2>{title}</h2>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

function useFieldErrors(): { fields: Record<string, string>; message: string | null; fail: (error: unknown) => void; clear: () => void } {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  return {
    fields,
    message,
    fail: (error) => {
      setFields(error instanceof ApiFailure ? (error.fields ?? {}) : {});
      setMessage(failureText(error));
    },
    clear: () => {
      setFields({});
      setMessage(null);
    },
  };
}

export function AddItemDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [label, setLabel] = useState<ClassLabel>("Application");
  const [criticality, setCriticality] = useState("2");
  const [businessCritical, setBusinessCritical] = useState(false);
  const [department, setDepartment] = useState("");
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<string[]>([]);
  const [people, setPeople] = useState<{ username: string; display_name: string }[]>([]);
  const [usedDepartments, setUsedDepartments] = useState<string[]>([]);
  const [usedPeople, setUsedPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();

  useEffect(() => {
    void get<{ departments: { name: string }[] }>("/api/departments").then((r) => {
      setDepartments(r.departments.map((d) => d.name));
      setDepartment((current) => current || r.departments[0]?.name || "");
    });
    void get<{ users: { username: string; display_name: string }[] }>("/api/users").then((r) => setPeople(r.users));
  }, []);

  const toggle = (list: string[], value: string, set: (next: string[]) => void): void => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    const body: Record<string, unknown> = { name: name.trim(), class: label, criticality: Number(criticality), business_critical: businessCritical, owner_department: department };
    for (const spec of CLASS_ATTRIBUTES[label]) {
      const raw = (attributes[spec.name] ?? "").trim();
      if (raw !== "") body[spec.name] = spec.kind === "integer" ? Number(raw) : raw;
    }
    if (label === "Business service") body.used_by = { departments: usedDepartments, people: usedPeople };
    errors.clear();
    setBusy(true);
    post("/api/cis", body).then(onDone, (error: unknown) => {
      errors.fail(error);
      setBusy(false);
    });
  };

  return (
    <Modal label="Add item" onClose={onClose} className="map-dialog">
      <DialogHead title="Add item" onClose={onClose} />
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Name" error={errors.fields.name}>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Class" error={errors.fields.class}>
          <select value={label} onChange={(event) => setLabel(event.target.value as ClassLabel)}>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Criticality" error={errors.fields.criticality}>
          <select value={criticality} onChange={(event) => setCriticality(event.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={businessCritical} onChange={(event) => setBusinessCritical(event.target.checked)} />
          <span>Business critical</span>
        </label>
        <Field label="Owner department" error={errors.fields.owner_department}>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        {CLASS_ATTRIBUTES[label].map((spec) => (
          <Field key={spec.name} label={ATTRIBUTE_LABELS[spec.name] ?? sentence(spec.name)} error={errors.fields[spec.name]}>
            <input
              type={spec.kind === "integer" ? "number" : "text"}
              min={spec.kind === "integer" ? 1 : undefined}
              value={attributes[spec.name] ?? ""}
              onChange={(event) => setAttributes({ ...attributes, [spec.name]: event.target.value })}
            />
          </Field>
        ))}
        {label === "Business service" ? (
          <>
            <fieldset className="pick-group">
              <legend>Used by departments</legend>
              {departments.map((d) => (
                <label key={d} className="check-row">
                  <input type="checkbox" checked={usedDepartments.includes(d)} onChange={() => toggle(usedDepartments, d, setUsedDepartments)} />
                  <span>{d}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="pick-group">
              <legend>Used by people</legend>
              {people.map((p) => (
                <label key={p.username} className="check-row">
                  <input type="checkbox" checked={usedPeople.includes(p.username)} onChange={() => toggle(usedPeople, p.username, setUsedPeople)} />
                  <span>{p.display_name}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {errors.message ? <p className="form-error">{errors.message}</p> : null}
        <div className="row">
          <Button type="submit" busy={busy}>
            {busy ? "Saving..." : "Add item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AddRelationshipDialog({ items, from: initial, onClose, onDone }: { items: string[]; from: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [from, setFrom] = useState(initial);
  const [type, setType] = useState(RELATIONSHIP_TYPES[0]!);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    errors.clear();
    setBusy(true);
    post("/api/relationships", { source: from, type, target: to }).then(onDone, (error: unknown) => {
      errors.fail(error);
      setBusy(false);
    });
  };

  const choices = (value: string, set: (next: string) => void, label: string): JSX.Element => (
    <Field label={label}>
      <select value={value} onChange={(event) => set(event.target.value)}>
        <option value="">Choose an item</option>
        {items.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Modal label="Add relationship" onClose={onClose} className="map-dialog">
      <DialogHead title="Add relationship" onClose={onClose} />
      <form className="stack" onSubmit={submit} noValidate>
        {choices(from, setFrom, "From")}
        <Field label="Type">
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {RELATIONSHIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {choices(to, setTo, "To")}
        {errors.message ? <p className="form-error">{errors.message}</p> : null}
        <div className="row">
          <Button type="submit" busy={busy}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function MaintenanceDialog({ item, zone, onClose, onDone }: { item: string; zone: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    const startIso = localTextToIso(start, zone);
    const endIso = localTextToIso(end, zone);
    const local: Record<string, string> = {};
    if (!startIso) local.start = "Type the start as YYYY-MM-DD HH:mm.";
    if (!endIso) local.end = "Type the end as YYYY-MM-DD HH:mm.";
    setProblems(local);
    setMessage(null);
    if (!startIso || !endIso) return;
    setBusy(true);
    post(`/api/cis/${encodeURIComponent(item)}/maintenance`, { start: startIso, end: endIso }).then(onDone, (error: unknown) => {
      setProblems(error instanceof ApiFailure ? (error.fields ?? {}) : {});
      setMessage(failureText(error));
      setBusy(false);
    });
  };

  return (
    <Modal label="Schedule maintenance" onClose={onClose} className="map-dialog">
      <DialogHead title="Schedule maintenance" onClose={onClose} />
      <form className="stack" onSubmit={submit} noValidate>
        <p className="muted">
          {item}, in time zone {zone}.
        </p>
        <Field label="Start" error={problems.start}>
          <input value={start} placeholder="YYYY-MM-DD HH:mm" onChange={(event) => setStart(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="End" error={problems.end}>
          <input value={end} placeholder="YYYY-MM-DD HH:mm" onChange={(event) => setEnd(event.target.value)} autoComplete="off" />
        </Field>
        {message && Object.keys(problems).length === 0 ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <Button type="submit" busy={busy}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
