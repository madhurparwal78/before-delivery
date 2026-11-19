import { type ReactNode, useEffect, useState } from "react";
import { displayNumber } from "../../shared/display.js";
import { get } from "../api.js";
import { useShell } from "../shell/ProjectShell.js";

interface Field {
  path: string;
  present: number;
  types: { type: string; share: number }[];
}

export function Schema(): ReactNode {
  const { project, collection } = useShell();
  const [schema, setSchema] = useState<{ sampled: number; fields: Field[] } | null>(null);
  const cid = collection?.id ?? "";
  useEffect(() => {
    setSchema(null);
    get<{ sampled: number; fields: Field[] }>(`/api/projects/${project.id}/collections/${cid}/schema`).then(setSchema, () => setSchema({ sampled: 0, fields: [] }));
  }, [project.id, cid]);
  return (
    <>
      <h1 className="screen-title">Schema</h1>
      <p className="muted">{schema ? `Read from the first ${displayNumber(schema.sampled)} ${schema.sampled === 1 ? "document" : "documents"}.` : "Reading documents"}</p>
      <ul className="schema-list rows panel" role="list" aria-label="Schema fields" aria-busy={schema === null || undefined}>
        {schema === null ? (
          <li className="skeleton-row" />
        ) : (
          schema.fields.map((field) => (
            <li key={field.path} className="schema-row" data-field-path={field.path} data-present={field.present}>
              <span className="schema-meta">
                <span className="schema-path">{field.path}</span>
                <span className="muted">Present in {displayNumber(field.present)}% of documents</span>
              </span>
              <span className="segments">
                {field.types.map((type, index) => (
                  <span
                    key={type.type}
                    className={index % 2 === 0 ? "segment segment-dark" : "segment segment-plum"}
                    data-type={type.type}
                    data-share={type.share}
                    style={{ flexGrow: type.share }}
                  >
                    <span className="segment-text">
                      {type.type} {displayNumber(type.share)}%
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))
        )}
      </ul>
      {schema?.fields.length === 0 ? <p className="muted">Nothing to summarise yet. Add a document first.</p> : null}
    </>
  );
}
