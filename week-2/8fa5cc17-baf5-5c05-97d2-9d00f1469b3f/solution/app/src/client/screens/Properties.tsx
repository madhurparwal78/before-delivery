// The margin's Properties region: one control per typed field, saved as the brief says per kind.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { get, type ApiResult } from '../api.ts';
import type { FieldJson, ObjectJson, PropertyValue } from '../types.ts';
import { compareIds, compareText } from '../../shared/query.ts';

type Save = (body: Record<string, unknown>) => Promise<ApiResult<ObjectJson & { errors?: Record<string, string> }>>;

const fieldId = (objectId: string, name: string): string => `prop-${objectId}-${name.replace(/[^a-z0-9]/gi, '_')}`;

export function Properties({ objectId, fields, values, onSave }: {
  objectId: string; fields: FieldJson[]; values: Record<string, PropertyValue>; onSave: Save;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, Array<{ id: string; title: string }>>>({});

  useEffect(() => {
    for (const f of fields) {
      if (f.kind !== 'relation' || !f.target_type_id) continue;
      void get<{ objects: Array<{ id: string; title: string }> }>(`/api/objects?type_id=${f.target_type_id}`).then((r) => {
        if (r.status !== 200) return;
        const list = [...r.data.objects].sort((a, b) => compareText(a.title, b.title) || compareIds(a.id, b.id));
        setTargets((t) => ({ ...t, [f.name]: list.filter((o) => o.id !== objectId) }));
      });
    }
  }, [fields, objectId]);

  const save = async (name: string, value: PropertyValue) => {
    const r = await onSave({ properties: { [name]: value } });
    const key = `properties.${name}`;
    setErrors((e) => {
      const next = { ...e };
      if (r.status === 422 && r.data.errors?.[key]) next[name] = r.data.errors[key];
      else delete next[name];
      return next;
    });
    if (r.status === 422) document.getElementById(fieldId(objectId, name))?.focus();
  };

  if (!fields.length) return <p className="muted margin-empty">This type has no fields.</p>;
  return (
    <div className="properties">
      {fields.map((f) => {
        const id = fieldId(objectId, f.name);
        const error = errors[f.name];
        const described = error ? `${id}-error` : undefined;
        return (
          // A relation's control mounts again once its target options arrive, so the stored target shows selected.
          <div className="field" key={`${f.name}:${String(values[f.name] ?? '')}:${f.kind === 'relation' && targets[f.name] ? 'loaded' : ''}`}>
            <label htmlFor={id}>{f.name}</label>
            {f.kind === 'select' || f.kind === 'relation' ? (
              <select id={id} defaultValue={values[f.name] === null || values[f.name] === undefined ? '' : String(values[f.name])} aria-describedby={described}
                aria-invalid={error ? true : undefined} onChange={(e) => void save(f.name, e.target.value === '' ? null : e.target.value)}>
                <option value="">None</option>
                {f.kind === 'select'
                  ? (f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)
                  : (targets[f.name] ?? []).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            ) : (
              <PropertyInput id={id} field={f} value={values[f.name] ?? null} describedBy={described} invalid={Boolean(error)}
                onCommit={(v) => void save(f.name, v)} />
            )}
            {error && <p id={`${id}-error`} className="field-error">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Text, url, number and date fields save on Enter or when they lose focus; cleared means null. */
function PropertyInput({ id, field, value, describedBy, invalid, onCommit }: {
  id: string; field: FieldJson; value: PropertyValue; describedBy?: string; invalid: boolean; onCommit: (v: PropertyValue) => void;
}) {
  const initial = value === null ? '' : String(value);
  const [text, setText] = useState(initial);
  const prose = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = prose.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);
  const commit = () => {
    if (text === initial) return;
    if (text.trim() === '') onCommit(null);
    else if (field.kind === 'number') onCommit(Number.isFinite(Number(text)) ? Number(text) : text);
    else onCommit(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };
  // Prose fields grow with their text so a reading page never hides a definition behind one line.
  if (field.kind === 'text') {
    return (
      <textarea
        ref={prose} id={id} value={text} rows={1} className="property-prose" aria-describedby={describedBy} aria-invalid={invalid ? true : undefined}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      id={id} value={text} aria-describedby={describedBy} aria-invalid={invalid ? true : undefined}
      type={field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : 'text'}
      placeholder={field.kind === 'date' ? 'YYYY-MM-DD' : undefined} inputMode={field.kind === 'date' ? 'numeric' : undefined}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
    />
  );
}
