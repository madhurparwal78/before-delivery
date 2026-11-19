import type { ReactNode } from "react";
import type { QueryForm } from "./useDocuments.js";

/** The query bar: Filter, Projection, Sort, Limit and Run. Ctrl+Enter (Cmd+Enter) runs it from any control inside. */
export function QueryBar({ form, onChange, onRun }: { form: QueryForm; onChange: (form: QueryForm) => void; onRun: () => void }): ReactNode {
  const text = (key: keyof QueryForm, label: string, placeholder: string): ReactNode => (
    <label className={`field field-${key}`}>
      <span className="field-label">{label}</span>
      <input
        className="input"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder={placeholder}
        value={form[key]}
        onChange={(event) => onChange({ ...form, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <form
      className="query-bar"
      role="search"
      aria-label="Query bar"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onRun();
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          onRun();
        }
      }}
    >
      {text("filter", "Filter", '{ "tags": "red" }')}
      <div className="query-row">
        {text("projection", "Projection", '{ "sku": 1 }')}
        {text("sort", "Sort", '{ "price": -1 }')}
        <label className="field field-limit">
          <span className="field-label">Limit</span>
          <input className="input" type="number" min={0} step={1} placeholder="0" value={form.limit} onChange={(event) => onChange({ ...form, limit: event.target.value })} />
        </label>
        <button type="submit" className="btn btn-lime run-button">
          Run
        </button>
      </div>
    </form>
  );
}
