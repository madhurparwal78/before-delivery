import { useEffect, useState } from "react";
import type { Entry, FieldKind } from "../../../shared/types.js";
import { Icon } from "../../ui/icons.js";
import { useEditor } from "../context.js";

const KIND_LABEL: Record<FieldKind, string> = { text: "Text", rich_text: "Rich text", image: "Image" };

function EntryEditor({ entry, onDone }: { entry: Entry | null; onDone: () => void }) {
  const { state, act } = useEditor();
  const fields = state.doc.collection.fields;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(entry?.values ?? {}) }));
  useEffect(() => {
    if (fields.some((f) => f.kind === "image")) act.loadImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <form
      className="pl-entry-editor"
      aria-label={entry ? "Edit entry" : "New entry"}
      onSubmit={(e) => {
        e.preventDefault();
        act.putEntry(entry?.id, Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? ""])));
        onDone();
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className="pl-prop pl-prop-stacked">
          <span>
            {f.name} <span className="pl-muted pl-mono">{KIND_LABEL[f.kind]}</span>
          </span>
          {f.kind === "image" ? (
            <select className="pl-select" aria-label={f.name} value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              <option value="">No image</option>
              {state.images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.fileName}
                </option>
              ))}
            </select>
          ) : f.kind === "rich_text" ? (
            <textarea className="pl-input pl-textarea" aria-label={f.name} value={values[f.name] ?? ""} maxLength={4000} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          ) : (
            <input className="pl-input" aria-label={f.name} value={values[f.name] ?? ""} maxLength={2000} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          )}
        </label>
      ))}
      {fields.length === 0 && <p className="pl-hint">Add a field first; each entry fills every field.</p>}
      <p className="pl-hint">Rich text keeps paragraphs, bold, italic, lists and http, https or mailto links. Anything else is removed and its text kept.</p>
      <div className="pl-form-row">
        <button type="submit" className="pl-primary">
          Save entry
        </button>
        <button type="button" className="pl-button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CollectionPanel() {
  const { state, act } = useEditor();
  const { fields } = state.doc.collection;
  const entries = [...state.doc.collection.entries].sort((a, b) => a.order - b.order);
  const [fieldName, setFieldName] = useState("");
  const [fieldKind, setFieldKind] = useState<FieldKind>("text");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const addField = () => {
    const name = fieldName.trim();
    if (!name || name.length > 80) return setError("A field name is 1 to 80 characters.");
    if (fields.some((f) => f.name === name)) return setError(`There is already a field named ${name}.`);
    if (fields.length >= 20) return setError("A collection has at most 20 fields.");
    act.setFields([...fields, { name, kind: fieldKind }]);
    setFieldName("");
    setError(null);
  };
  const label = (entry: Entry) => {
    const first = fields.find((f) => f.kind !== "image");
    const text = first ? (entry.values[first.name] ?? "").replace(/<[^>]*>/g, "") : "";
    return text || "Untitled entry";
  };
  return (
    <>
      <h3 className="pl-subhead">
        {state.doc.collection.name} <span className="pl-mono pl-muted">{entries.length} entries</span>
      </h3>
      <ul className="pl-fields" aria-label="Fields">
        {fields.map((f) => (
          <li key={f.name}>
            <span>{f.name}</span>
            <span className="pl-mono pl-muted">{KIND_LABEL[f.kind]}</span>
            <button type="button" className="pl-icon-button" aria-label={`Remove ${f.name}`} title={`Remove ${f.name}`} onClick={() => act.setFields(fields.filter((x) => x.name !== f.name))}>
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="pl-form-row">
        <input className="pl-input" aria-label="Field name" value={fieldName} onChange={(e) => (setFieldName(e.target.value), setError(null))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addField())} />
        <select className="pl-select" aria-label="Field kind" value={fieldKind} onChange={(e) => setFieldKind(e.target.value as FieldKind)}>
          <option value="text">Text</option>
          <option value="rich_text">Rich text</option>
          <option value="image">Image</option>
        </select>
        <button type="button" className="pl-button" onClick={addField}>
          Add field
        </button>
      </div>
      {error && (
        <p className="pl-inline-error">
          <Icon name="triangle-alert" size={12} />
          {error}
        </p>
      )}
      <table aria-label="Entries" className="pl-table pl-entries">
        <tbody>
          {entries.map((entry, i) => (
            <tr key={entry.id}>
              <td className="pl-mono pl-muted">{i + 1}</td>
              <td className="pl-entry-label">{label(entry)}</td>
              <td className="pl-entry-actions">
                <button type="button" className="pl-icon-button" aria-label={`Move entry ${i + 1} up`} disabled={i === 0} onClick={() => act.moveEntry(entry.id, i - 1)}>
                  <Icon name="chevron-down" size={14} style={{ transform: "rotate(180deg)" }} />
                </button>
                <button type="button" className="pl-icon-button" aria-label={`Move entry ${i + 1} down`} disabled={i === entries.length - 1} onClick={() => act.moveEntry(entry.id, i + 1)}>
                  <Icon name="chevron-down" size={14} />
                </button>
                <button type="button" className="pl-icon-button" aria-label={`Edit entry ${i + 1}`} onClick={() => setEditing(entry.id)}>
                  <Icon name="pencil" size={14} />
                </button>
                <button type="button" className="pl-icon-button" aria-label={`Delete entry ${i + 1}`} onClick={() => act.deleteEntry(entry.id)}>
                  <Icon name="trash-2" size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p className="pl-panel-empty">Nothing here yet.</p>}
      {editing ? (
        <EntryEditor key={editing} entry={editing === "new" ? null : (entries.find((e) => e.id === editing) ?? null)} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="pl-button" onClick={() => setEditing("new")}>
          <Icon name="plus" />
          Add entry
        </button>
      )}
    </>
  );
}
