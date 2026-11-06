// New type: a name and typed fields (text, number, date, url, select with options, relation with a target).
import { useState } from 'react';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { announce } from './feedback.ts';
import { refreshLibrary, useLibrary } from './library.ts';
import type { FieldKind, TypeJson } from './types.ts';

const KIND_LABELS: Array<[FieldKind, string]> = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['url', 'URL'], ['select', 'Select'], ['relation', 'Relation']];
interface Row { key: number; name: string; kind: FieldKind; required: boolean; options: string; target: string }
let rowSeq = 0;

export function NewTypeDialog({ onClose }: { onClose: () => void }) {
  const library = useLibrary();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const firstType = library.types[0]?.id ?? '';

  const create = async () => {
    const fields = rows.map((r) => ({
      name: r.name, kind: r.kind, required: r.required,
      options: r.kind === 'select' ? r.options.split('\n').map((o) => o.trim()).filter(Boolean) : null,
      target_type_id: r.kind === 'relation' ? r.target || firstType : null,
    }));
    const res = await api<TypeJson & { errors?: Record<string, string> }>('POST', '/api/types', { name, fields });
    if (res.status === 201) {
      await refreshLibrary();
      announce(`Type ${res.data.name} created.`);
      onClose();
      return;
    }
    const errs = res.data.errors ?? {};
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) document.getElementById(`nt-${first.replace(/\./g, '-')}`)?.focus();
  };

  const err = (key: string) => (errors[key] ? <p id={`nt-${key.replace(/\./g, '-')}-error`} className="field-error">{errors[key]}</p> : null);
  const described = (key: string) => (errors[key] ? `nt-${key.replace(/\./g, '-')}-error` : undefined);

  return (
    <Dialog label="New type" onClose={onClose} className="new-type">
      <h2>New type</h2>
      <div className="field">
        <label htmlFor="nt-name">Type name</label>
        <input id="nt-name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={described('name')} />
        {err('name')}
      </div>
      {rows.map((r, i) => (
        <fieldset key={r.key} className="field-row">
          <legend className="small-caps muted">Field {i + 1}</legend>
          <div className="field">
            <label htmlFor={`nt-fields-${i}-name`}>Field name</label>
            <input id={`nt-fields-${i}-name`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-describedby={described(`fields.${i}.name`)} />
            {err(`fields.${i}.name`)}
          </div>
          <div className="field">
            <label htmlFor={`nt-fields-${i}-kind`}>Field kind</label>
            <select id={`nt-fields-${i}-kind`} value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as FieldKind })} aria-describedby={described(`fields.${i}.kind`)}>
              {KIND_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {err(`fields.${i}.kind`)}
          </div>
          <label className="check"><input type="checkbox" checked={r.required} onChange={(e) => update(r.key, { required: e.target.checked })} />Required</label>
          {r.kind === 'select' && (
            <div className="field">
              <label htmlFor={`nt-fields-${i}-options`}>Options</label>
              <textarea id={`nt-fields-${i}-options`} rows={3} value={r.options} onChange={(e) => update(r.key, { options: e.target.value })} aria-describedby={described(`fields.${i}.options`)} />
              {err(`fields.${i}.options`)}
            </div>
          )}
          {r.kind === 'relation' && (
            <div className="field">
              <label htmlFor={`nt-fields-${i}-target_type_id`}>Target type</label>
              <select id={`nt-fields-${i}-target_type_id`} value={r.target || firstType} onChange={(e) => update(r.key, { target: e.target.value })} aria-describedby={described(`fields.${i}.target_type_id`)}>
                {library.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {err(`fields.${i}.target_type_id`)}
            </div>
          )}
        </fieldset>
      ))}
      <button type="button" className="quiet add-field" onClick={() => setRows((list) => [...list, { key: ++rowSeq, name: '', kind: 'text', required: false, options: '', target: '' }])}>Add field</button>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={() => void create()}>Create type</button>
      </div>
    </Dialog>
  );
}
