import { useCallback, useEffect, useState } from "react";
import { GENERIC_FAILURE } from "../../shared/copy";
import type { DocumentJson, TemplateJson } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { LedgerSheet } from "../components/Empty";
import { ApiFailure, api, failureCopy } from "../lib/api";
import { useLiveEvents } from "../lib/live";
import { useRouter } from "../lib/router";
import { useMe } from "../lib/session";

const STATE_WORD = { draft: "Draft", shared: "Shared", retired: "Retired" } as const;

export function Templates() {
  const me = useMe();
  const [templates, setTemplates] = useState<TemplateJson[] | null>(null);
  const [using, setUsing] = useState<TemplateJson | null>(null);

  const load = useCallback(async () => {
    setTemplates((await api.get<{ templates: TemplateJson[] }>("/api/templates")).templates);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveEvents((event) => {
    if (event.type === "resync" || event.type === "templates") void load();
  });

  const move = async (template: TemplateJson, action: "share" | "retire") => {
    await api.post(`/api/templates/${template.id}/${action}`);
    await load();
  };

  const isOwner = me.role === "owner";
  return (
    <>
      <h1>Templates</h1>
      {templates !== null && templates.length === 0 ? (
        <div className="empty">
          <LedgerSheet />
          <p>No templates yet. An owner can save a draft as a template.</p>
        </div>
      ) : null}
      <ul aria-label="Templates" className="template-list">
        {(templates ?? []).map((template) => (
          <li key={template.id} className="template">
            <div className="template-main">
              <h2>{template.name}</h2>
              <p className="muted">
                {template.signerCount} {template.signerCount === 1 ? "signer" : "signers"}, {template.fields.length} {template.fields.length === 1 ? "field" : "fields"}
              </p>
              {isOwner ? <span className="badge">{STATE_WORD[template.status]}</span> : null}
            </div>
            <div className="template-actions">
              {template.status === "shared" && me.role !== "viewer" ? (
                <button type="button" className="btn" onClick={() => setUsing(template)}>
                  Use template
                </button>
              ) : null}
              {isOwner && template.status === "draft" ? (
                <button type="button" className="btn" onClick={() => void move(template, "share")} aria-label={`Share ${template.name}`}>
                  Share
                </button>
              ) : null}
              {isOwner && template.status === "shared" ? (
                <button type="button" className="btn" onClick={() => void move(template, "retire")} aria-label={`Retire ${template.name}`}>
                  Retire
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {using ? <UseDialog template={using} close={() => setUsing(null)} /> : null}
    </>
  );
}

function UseDialog({ template, close }: { template: TemplateJson; close: () => void }) {
  const { navigate } = useRouter();
  const [people, setPeople] = useState(() => Array.from({ length: template.signerCount }, () => ({ name: "", email: "" })));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const document = await api.post<DocumentJson>(`/api/templates/${template.id}/use`, { signers: people });
      navigate(`/documents/${document.id}`);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failureCopy(failure, GENERIC_FAILURE) : GENERIC_FAILURE);
      setBusy(false);
    }
  };
  return (
    <Dialog label="Use template" onClose={close}>
      <h2>Use template</h2>
      <p className="muted">{template.name}</p>
      {people.map((person, index) => (
        <div key={index} className="stack">
          <label className="field-label">
            {`Name for Signer ${index + 1}`}
            <input type="text" value={person.name} onChange={(e) => setPeople(people.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))} />
          </label>
          <label className="field-label">
            {`Email for Signer ${index + 1}`}
            <input type="text" inputMode="email" value={person.email} onChange={(e) => setPeople(people.map((p, i) => (i === index ? { ...p, email: e.target.value } : p)))} />
          </label>
        </div>
      ))}
      {error ? <p role="alert" className="error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void create()}>
          Create draft
        </button>
      </div>
    </Dialog>
  );
}
