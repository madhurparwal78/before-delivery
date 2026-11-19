// The app shell: routing, sign-in, the documents list and the workspace.
import "./styles.css";
import { request } from "./api.js";
import { CardsView } from "./cards.js";
import { COPY } from "./copy.js";
import { Dialog, field } from "./dialog.js";
import { button, h, layoutOf, overlay, setBusy } from "./dom.js";
import { GridView } from "./grid.js";
import { type Landing, Workspace } from "./workspace.js";

const app = document.getElementById("app")!;
let workspace: Workspace | null = null;
let generation = 0;

// Only a same-origin path is a safe place to return to after sign-in.
function safeNext(next: string | null): string {
  if (!next) return "/";
  return /^\/(?![/\\])/.test(next) ? next : "/";
}

function navigate(path: string, push: boolean, landing: Landing = { focus: "landing" }): void {
  if (push) history.pushState(null, "", path);
  else history.replaceState(null, "", path);
  void render(landing, false);
}

function clearPage(): void {
  workspace?.destroy();
  workspace = null;
  overlay().replaceChildren();
  app.replaceChildren();
}

async function signedIn(): Promise<{ id: string; email: string; display_name: string } | null> {
  const answer = await request<{ user: { id: string; email: string; display_name: string } }>("GET", "/api/me");
  return answer.ok ? answer.data.user : null;
}

async function render(landing: Landing, fromHistory: boolean): Promise<void> {
  const run = ++generation;
  const { pathname, search } = location;
  if (pathname === "/sign-in") {
    clearPage();
    signInPage(new URLSearchParams(search).get("next"));
    return;
  }
  const match = /^\/d\/([^/]+)(?:\/t\/([^/]+))?\/?$/.exec(pathname);
  if (fromHistory || !workspace || !match || workspace.docId !== match[1]) {
    // Nothing from an earlier page shows until the session is confirmed.
    if (fromHistory) clearPage();
    const user = await signedIn();
    if (run !== generation) return;
    if (!user) {
      clearPage();
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      history.replaceState(null, "", `/sign-in${next}`);
      signInPage(pathname === "/" ? null : pathname);
      return;
    }
  }
  if (!match) {
    clearPage();
    if (pathname !== "/") history.replaceState(null, "", "/");
    void documentsPage(landing);
    return;
  }
  const [, docId, tableId] = match;
  if (workspace && workspace.docId === docId && !fromHistory && workspace.tableId !== null) {
    if (tableId && tableId !== workspace.tableId) workspace.showTable(tableId, false);
    return;
  }
  clearPage();
  workspace = new Workspace(docId!, tableId ?? null, landing, (ws) => (layoutOf() === "phone" ? new CardsView(ws) : new GridView(ws)), navigate, () => void signOut());
  app.append(workspace.main);
  workspace.start();
}

async function signOut(): Promise<void> {
  await request("POST", "/api/auth/sign-out");
  clearPage();
  history.pushState(null, "", "/sign-in");
  signInPage(null);
}

function signInPage(next: string | null): void {
  document.title = "Sign in · Tallyframe";
  const email = h("input", { type: "email", autocomplete: "username", spellcheck: "false" }) as HTMLInputElement;
  const password = h("input", { type: "password", autocomplete: "current-password" }) as HTMLInputElement;
  const submit = button("Sign in", { type: "submit", class: "btn primary wide" });
  const alert = h("div", { role: "alert", class: "sign-in-alert" });
  const form = h("form", { class: "sign-in-form", novalidate: true },
    h("h1", {}, "Sign in to Tallyframe"),
    field("Email", email).wrap,
    field("Password", password).wrap,
    alert,
    submit,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      setBusy(submit, true);
      alert.textContent = "";
      const answer = await request<unknown>("POST", "/api/auth/sign-in", { email: email.value, password: password.value });
      setBusy(submit, false);
      if (!answer.ok) {
        alert.textContent = answer.error?.message ?? "";
        return;
      }
      navigate(safeNext(next), false, { focus: "landing" });
    })();
  });
  app.replaceChildren(h("main", { class: "sign-in", "aria-label": "Sign in" }, form));
  email.focus();
}

async function documentsPage(landing: Landing): Promise<void> {
  document.title = "Documents · Tallyframe";
  const answer = await request<{ documents: { id: string; name: string; role: string }[] }>("GET", "/api/documents");
  if (!answer.ok) return;
  const roleWord: Record<string, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
  const list = h("ul", { class: "doc-list" },
    ...answer.data.documents.map((d) =>
      h("li", { class: "doc-item" },
        h("a", {
          href: `/d/${d.id}`, class: "doc-link",
          onclick: (e: Event) => {
            e.preventDefault();
            navigate(`/d/${d.id}`, true);
          },
        }, d.name),
        h("span", { class: "doc-role" }, roleWord[d.role] ?? d.role),
      ),
    ),
  );
  const create = button("New document", { onclick: (e: Event) => newDocument(e.currentTarget as HTMLElement) }, "plus");
  app.replaceChildren(
    h("header", { class: "topbar docs-top" },
      h("p", { class: "wordmark" }, "Tallyframe"),
      h("div", { class: "top-actions" }, button("Sign out", { onclick: () => void signOut() }, "signOut")),
    ),
    h("main", { class: "documents", "aria-label": "Documents" },
      h("div", { class: "documents-head" }, h("h1", {}, "Documents"), create),
      answer.data.documents.length ? list : h("p", { class: "muted" }, "No documents are shared with you yet."),
    ),
  );
  if (landing.focus === "landing") (app.querySelector<HTMLElement>(".doc-link") ?? create).focus();
}

function newDocument(opener: HTMLElement): void {
  const input = h("input", { type: "text", autocomplete: "off" }) as HTMLInputElement;
  const name = field("Document name", input);
  const create = button("Create document", { class: "btn primary" });
  const dialog = new Dialog({ title: "New document", returnTo: () => opener });
  const submit = async () => {
    setBusy(create, true);
    const answer = await request<{ document: { id: string; name: string } }>("POST", "/api/documents", { name: input.value });
    if (!answer.ok) {
      setBusy(create, false);
      if (answer.status === 422) {
        name.setError(answer.error?.fields?.name ?? "");
        input.focus();
      }
      return;
    }
    dialog.close(false);
    navigate(`/d/${answer.data.document.id}`, true, { focus: "landing", announce: COPY.documentCreated(answer.data.document.name) });
  };
  create.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });
  dialog.body.append(name.wrap, h("div", { class: "dialog-buttons" }, create, button("Cancel", { onclick: () => dialog.close() })));
  dialog.show();
}

window.addEventListener("popstate", () => void render({ focus: "none" }, true));
window.addEventListener("pageshow", (e) => {
  if (e.persisted) void render({ focus: "none" }, true);
});
void render({ focus: "landing" }, false);
