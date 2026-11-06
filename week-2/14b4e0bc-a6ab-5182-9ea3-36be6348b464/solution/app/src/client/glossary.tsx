import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { announceActivity, onActivity, openActivityStream, ownRoleChanged, rememberFocus, session, syncedSeq } from "./app-state.ts";
import { firstMessage, focusFirstInvalid, TextField } from "./forms.tsx";
import { afterRender, api, ApiFailure, enc, mayCurate, useStore } from "./lib.ts";
import { Shell } from "./shell.tsx";
import { focusEl, Overlay } from "./ui.tsx";

interface Term {
  id: string;
  name: string;
  definition: string;
  revision: number;
  assets: { id: string }[];
}

interface Editing {
  mode: "new" | "edit";
  termId: string | null;
  revision: number;
  name: string;
  definition: string;
  errors: Record<string, string>;
  status: string;
  pending: boolean;
}

const FIELDS: [string, string][] = [["name", "term-name"], ["definition", "term-definition"]];

export function Glossary() {
  const user = useStore(session)!;
  const [terms, setTerms] = useState<Term[]>([]);
  const [renamed, setRenamed] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialogOpen, setDialogOpenState] = useState(false);
  const dialogOpenRef = useRef(false);
  const setDialogOpen = (open: boolean) => {
    dialogOpenRef.current = open;
    setDialogOpenState(open);
  };
  const shown = useRef(new Map<string, string>());
  const opener = useRef<string | null>(null);
  const restore = useRef<(() => void) | null>(null);
  const curate = mayCurate(user.role);

  const paint = (next: Term[], announce: boolean) => {
    restore.current = rememberFocus();
    if (announce) {
      for (const t of next) {
        const before = shown.current.get(t.id);
        if (before !== undefined && before !== t.name) setRenamed(`Term renamed: ${before} is now ${t.name}.`);
      }
    }
    shown.current = new Map(next.map((t) => [t.id, t.name]));
    setTerms(next);
  };

  useLayoutEffect(() => {
    restore.current?.();
    restore.current = null;
  });

  const load = async (announce: boolean) => paint((await api<{ terms: Term[] }>("GET", "/api/terms")).terms, announce);

  useLayoutEffect(() => {
    void load(false);
    openActivityStream(null);
    let chain = Promise.resolve();
    return onActivity((event) => {
      chain = chain.then(async () => {
        if (event.action === "user.role_change" && event.target.id === session.get()!.id) {
          const me = await ownRoleChanged();
          if (!mayCurate(me.role) && dialogOpenRef.current) {
            setDialogOpen(false);
            await afterRender();
            focusEl(document.getElementById("glossary-heading"));
          }
        } else if (event.action.startsWith("term.")) {
          await load(true);
        }
        await afterRender();
        syncedSeq.set(event.seq);
      }).catch(() => undefined);
    });
  }, []);

  const openDialog = (mode: "new" | "edit", term?: Term) => {
    opener.current = mode === "new" ? "new-term" : `edit-${term!.id}`;
    setEditing({
      mode, termId: term?.id ?? null, revision: term?.revision ?? 0, name: term?.name ?? "", definition: term?.definition ?? "",
      errors: {}, status: "", pending: false,
    });
    setDialogOpen(true);
  };

  const close = async (focusKey: string | null) => {
    setDialogOpen(false);
    await afterRender();
    if (!focusEl(document.querySelector(`[data-focus-key="${focusKey}"]`))) focusEl(document.getElementById("glossary-heading"));
  };

  const save = async () => {
    if (!editing || editing.pending) return;
    const e = editing;
    setEditing({ ...e, pending: true, status: "Saving..." });
    try {
      const body = e.mode === "new"
        ? await api<{ term: Term }>("POST", "/api/terms", { name: e.name, definition: e.definition })
        : await api<{ term: Term }>("PATCH", `/api/terms/${enc(e.termId!)}`, { revision: e.revision, name: e.name, definition: e.definition });
      const next = await api<{ terms: Term[] }>("GET", "/api/terms");
      paint(next.terms, false);
      setEditing({ ...e, pending: false, status: "Term saved.", errors: {} });
      announceActivity("Term saved.");
      await close(`edit-${body.term.id}`);
    } catch (failure) {
      const f = failure instanceof ApiFailure ? failure : new ApiFailure(0, "unknown", "Something went wrong. Try again.");
      const errors = f.status === 422 ? f.fields : {};
      setEditing({ ...e, pending: false, errors, status: f.status === 422 ? firstMessage(errors, ["name", "definition"]) ?? f.message : f.message });
      if (f.status === 422) await focusFirstInvalid(errors, FIELDS);
      else {
        await afterRender();
        focusEl(document.getElementById("term-save"));
      }
    }
  };

  return (
    <Shell screen="glossary">
      <section class="glossary">
        <div class="glossary-head">
          <h1 id="glossary-heading" class="screen-title" tabIndex={-1}>Glossary</h1>
          {curate && (
            <button type="button" class="btn btn-ink" data-focus-key="new-term" onClick={() => openDialog("new")}>New term</button>
          )}
        </div>
        <div role="status" aria-label="Glossary updates" class="sr-status">{renamed}</div>
        <ul aria-label="Terms" class="term-grid">
          {terms.map((t) => (
            <li key={t.id} class="term-card" data-revision={String(t.revision)} data-term-id={t.id}>
              <h2 class="term-name">{t.name}</h2>
              <p class="term-definition">{t.definition}</p>
              {t.assets.length > 0 && (
                <p class="term-assets">
                  <span class="visually-hidden">Assets: </span>
                  {t.assets.map((a) => (
                    <a key={a.id} class="mono asset-link" href={`/catalog?asset=${enc(a.id)}`} data-focus-key={`link-${t.id}-${a.id}`}>{a.id}</a>
                  ))}
                </p>
              )}
              {curate && (
                <button type="button" class="btn btn-quiet term-edit" aria-label={`Edit ${t.name}`} data-focus-key={`edit-${t.id}`}
                  onClick={() => openDialog("edit", t)}>
                  Edit
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {editing && (
        <Overlay
          open={dialogOpen}
          kind="dialog"
          label={editing.mode === "new" ? "New term" : "Edit term"}
          onEscape={() => void close(opener.current)}
          initialFocus={() => document.getElementById("term-name")}
        >
          <h2 class="dialog-title">{editing.mode === "new" ? "New term" : "Edit term"}</h2>
          <form class="dialog-form" onSubmit={(ev) => (ev.preventDefault(), void save())} noValidate>
            <TextField id="term-name" label="Term name" value={editing.name} error={editing.errors.name}
              onInput={(v) => setEditing({ ...editing, name: v })} />
            <TextField id="term-definition" label="Definition" value={editing.definition} error={editing.errors.definition} multiline
              onInput={(v) => setEditing({ ...editing, definition: v })} />
            <div class="dialog-actions">
              <button id="term-save" type="submit" class="btn btn-ink">Save term</button>
              <button type="button" class="btn btn-quiet" onClick={() => void close(opener.current)}>Cancel</button>
            </div>
            <div role="status" aria-label="Dialog status" class="dialog-status">{editing.status}</div>
          </form>
        </Overlay>
      )}
    </Shell>
  );
}
