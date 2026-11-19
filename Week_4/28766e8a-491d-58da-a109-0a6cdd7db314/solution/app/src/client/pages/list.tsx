// The diagram list (brief: Screens): most recently changed first, and New diagram.
import { useEffect, useState } from "preact/hooks";
import { copy } from "../../shared/copy";
import { titleError } from "../../shared/text";
import type { DiagramDocument, DiagramSummary } from "../../shared/types";
import { announce } from "../announce";
import { api } from "../api";
import { Dialog } from "../dialog";
import { Icon } from "../icons";

export function DiagramList() {
  const [diagrams, setDiagrams] = useState<DiagramSummary[] | null>(null);
  const [creating, setCreating] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ diagrams: DiagramSummary[] }>("GET", "/api/diagrams").then((res) => {
      if (res.ok) setDiagrams(res.data.diagrams);
      else if (res.status === 401) location.assign("/signin?next=%2F");
    });
  }, []);

  const create = async (e: Event) => {
    e.preventDefault();
    const local = titleError(title);
    if (local) {
      setError(local);
      announce(local);
      return;
    }
    const res = await api<{ diagram: { id: string }; document: DiagramDocument }>("POST", "/api/diagrams", { title });
    if (res.ok) {
      location.assign(`/d/${res.data.diagram.id}?page=${res.data.document.pages[0]?.id ?? ""}`);
      return;
    }
    const message = res.error.fields?.title ?? res.error.message;
    setError(message);
    announce(message);
  };

  const signOut = async () => {
    await api("POST", "/api/auth/signout");
    location.assign("/signin");
  };

  return (
    <main class="list-page">
      <header class="list-head">
        <p class="brand">Ferrule &amp; Pell <span>Linewell</span></p>
        <button type="button" class="ghost" onClick={signOut}>Sign out</button>
      </header>
      <section class="list-body">
        <div class="list-title">
          <h1>Your diagrams</h1>
          <button type="button" class="primary" onClick={(e) => setCreating(e.currentTarget)}><Icon name="plus" size={16} /> New diagram</button>
        </div>
        {diagrams === null ? <p class="muted">Loading your diagrams…</p> : diagrams.length === 0 ? (
          <div class="empty-list"><Icon name="compass" size={28} /><p>{copy.emptyList}</p></div>
        ) : (
          <ul class="diagram-list">
            {diagrams.map((d) => (
              <li key={d.id}>
                <a href={`/d/${d.id}`}>{d.title}</a>
                <span class="meta mono">{d.role} · {new Date(d.updatedAt).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {creating && (
        <Dialog label="New diagram" onClose={() => setCreating(null)} returnTo={creating}>
          <form class="dialog-body" onSubmit={create} noValidate>
            <div class="field">
              <label for="new-title">Title</label>
              <input id="new-title" value={title} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "new-title-error" : undefined}
                onInput={(e) => setTitle(e.currentTarget.value)} />
              {error && <p class="field-error" id="new-title-error">{error}</p>}
            </div>
            <button class="primary" type="submit">Create</button>
          </form>
        </Dialog>
      )}
    </main>
  );
}
