import { useState } from "preact/hooks";
import { DIALECT_NAMES, exportDdl, type Dialect } from "../../shared/ddl-export.js";
import type { Model } from "../../shared/model.js";
import { matchTemplates, type Template } from "../../shared/templates.js";
import { api } from "../api.js";
import { copy } from "../copy.js";

interface ExportJson {
  id: string;
  fileName: string;
  downloadUrl: string;
}

export function ExportPanel({
  projectId,
  model,
  canEdit,
  announce,
  alert,
  prepare,
}: {
  projectId: string;
  model: Model;
  canEdit: boolean;
  announce: (text: string) => void;
  alert: (text: string) => void;
  prepare: () => Promise<number>;
}) {
  const [dialect, setDialect] = useState<Dialect>("postgresql");
  const [pending, setPending] = useState(false);
  const [stored, setStored] = useState<ExportJson | null>(null);
  const preview = exportDdl(model, dialect);

  const save = async () => {
    setPending(true);
    announce(copy.savingExport);
    await prepare();
    const result = await api<ExportJson>("POST", `/api/projects/${projectId}/exports`, { dialect });
    setPending(false);
    if (result.ok) {
      setStored(result.data);
      announce(copy.exportSaved(DIALECT_NAMES[dialect]));
      return;
    }
    announce("");
    alert(result.status === 503 ? copy.exportStorageDown : (result.error?.message ?? copy.exportStorageDown));
  };

  const download = async (event: Event, item: ExportJson) => {
    event.preventDefault();
    const response = await fetch(item.downloadUrl, { credentials: "same-origin" });
    if (response.status === 409) {
      setStored(null);
      alert(copy.downloadExpired);
      return;
    }
    if (!response.ok) {
      alert(copy.exportStorageDown);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = item.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section role="region" aria-label="Export DDL" class="export-panel">
      <h2 class="panel-title">Export DDL</h2>
      <div role="radiogroup" aria-label="Dialect" class="radio-row">
        {(["postgresql", "mysql"] as const).map((d) => (
          <label class="radio" key={d}>
            <input type="radio" name="export-dialect" checked={dialect === d} onChange={() => setDialect(d)} />
            <span>{DIALECT_NAMES[d]}</span>
          </label>
        ))}
      </div>
      <div role="region" aria-label="DDL preview" class="ddl-preview" tabIndex={0}>
        <pre>{preview}</pre>
      </div>
      {canEdit && (
        <button type="button" class="button button-primary" disabled={pending} onClick={() => void save()}>
          {pending ? copy.savingExport : "Save export"}
        </button>
      )}
      {stored && (
        <a class="text-link" href={stored.downloadUrl} onClick={(e) => void download(e as unknown as Event, stored)}>
          Download {stored.fileName}
        </a>
      )}
    </section>
  );
}

export function TemplatesPanel({ onUse }: { onUse: (template: Template) => void }) {
  const [query, setQuery] = useState("");
  const matches = matchTemplates(query);
  return (
    <section role="region" aria-label="Starter templates" class="templates-panel">
      <h2 class="panel-title">Starter templates</h2>
      <input
        type="search"
        class="search"
        aria-label="Find a template"
        placeholder="Find a template"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (matches[0]) onUse(matches[0]);
          }
        }}
      />
      {matches.length === 0 && <p class="muted">{copy.noTemplate(query.trim())}</p>}
      <ul class="template-list">
        {matches.map((t) => (
          <li key={t.id} class="template-entry">
            <strong>{t.name}</strong>
            <span class="template-description">{t.description}</span>
            <button type="button" class="button button-secondary button-small" onClick={() => onUse(t)}>
              Use {t.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
