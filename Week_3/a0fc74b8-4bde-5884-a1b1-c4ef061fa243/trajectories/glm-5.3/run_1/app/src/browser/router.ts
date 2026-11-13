import { api, type DocumentDto, type DocumentListItem, type SessionInfo } from "./api.js";
import { el, clear, announce } from "./ui.js";
import { statusWord } from "./api.js";

/* ================= app bootstrap ================= */

let session: SessionInfo | null = null;

export function getSession(): SessionInfo | null { return session; }
export function setSession(s: SessionInfo | null): void { session = s; }

export async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) return;
  window.addEventListener("popstate", () => { void route(); });
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (link === null) return;
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("http") || href.startsWith("#")) return;
    event.preventDefault();
    navigate(href);
  });
  await route();
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  void route();
}

async function route(): Promise<void> {
  const app = document.getElementById("app");
  if (app === null) return;
  const path = location.pathname;
  if (path === "/sign-in") { await renderSignIn(app); return; }
  if (path.startsWith("/sign/")) { await renderSignerLink(app, path.slice("/sign/".length)); return; }
  if (path.startsWith("/documents")) {
    const rest = path.slice("/documents".length);
    if (rest === "" || rest === "/") { await renderDocuments(app); return; }
    const parts = rest.split("/").filter(Boolean);
    if (parts.length === 2 && parts[1] === "audit") { await renderAudit(app, parts[0]); return; }
    if (parts.length === 1) { await renderDocumentPage(app, parts[0]); return; }
    await renderNotFound(app);
    return;
  }
  if (path === "/templates") { await renderTemplates(app); return; }
  if (path === "/team") { await renderTeam(app); return; }
  if (path === "/" ) {
    navigate(session === null ? "/sign-in" : "/documents");
    return;
  }
  await renderNotFound(app);
}

/* ================= frame helpers ================= */

export function frame(active: string, ...children: Node[]): HTMLElement {
  const nav = el("nav", { "aria-label": "Main", role: "navigation", id: "main-nav" });
  for (const [name, label] of [["/documents", "Documents"], ["/templates", "Templates"], ["/team", "Team"]] as const) {
    const link = el("a", { href: name, text: label });
    if (name === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  const bar = el(
    "div",
    { class: "topbar" },
    el("span", { class: "brand", text: "Undersign" }),
    nav,
    el("span", { class: "spacer" }),
    el("button", {
      class: "btn ghost", type: "button", text: "Sign out",
      onclick: "window.__signOut && window.__signOut()",
    }),
  );
  const page = el("main", { class: "page" }, ...children);
  const wrap = el("div", {}, bar, page);
  bar.querySelector("button")?.addEventListener("click", async () => {
    await api.del("/api/session");
    session = null;
    navigate("/sign-in");
  });
  return wrap;
}

/* ================= sign-in ================= */

async function renderSignIn(app: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get("next"));
  const email = el("input", { type: "email", id: "signin-email", autocomplete: "email" });
  const password = el("input", { type: "password", id: "signin-password", autocomplete: "current-password" });
  const error = el("div", { class: "alert", role: "alert", hidden: true ? null : "true" }) as HTMLElement;
  error.hidden = true;
  const submit = el("button", { class: "btn primary", type: "submit", text: "Sign in" });
  const form = el(
    "form",
    { class: "signin" },
    el("h1", { text: "Sign in" }),
    el("label", { for: "signin-email", text: "Email" }),
    email,
    el("label", { for: "signin-password", text: "Password" }),
    password,
    error,
    el("div", { class: "row" }, submit),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const info = await api.post<SessionInfo>("/api/session", {
        email: email.value, password: password.value,
      });
      session = info;
      navigate(next);
    } catch {
      error.hidden = false;
      error.textContent = "Email or password is incorrect.";
      email.focus();
    } finally {
      submit.disabled = false;
    }
  });
  clear(app);
  app.append(form);
}

function safeNext(next: string | null): string {
  if (next === null) return "/documents";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/documents";
  return next;
}

/* ================= not found ================= */

export async function renderNotFound(app: HTMLElement): Promise<void> {
  clear(app);
  app.append(el("div", { class: "notice" },
    el("h1", { text: "Document not found" }),
    el("p", { text: "Check the link, or ask your team owner." }),
  ));
}

/* ================= documents list ================= */

async function renderDocuments(app: HTMLElement): Promise<void> {
  const info = await loadSession(app);
  if (info === null) return;
  const heading = el("h1", { text: "Documents" });
  const updates = el("div", { class: "status-region", role: "status", id: "doc-updates" });
  const serviceNotice = el("div", { class: "status-region", role: "status", id: "service-notice" });

  const fileInput = el("input", { type: "file", accept: "application/pdf", class: "visually-hidden", id: "pdf-file", "aria-label": "Upload PDF" });
  const titleBox = el("input", { type: "text", id: "doc-title", "aria-label": "Title" });
  const uploadBtn = el("button", { class: "btn primary", type: "button", text: "Upload PDF" });
  const uploadRow = el("div", { class: "upload-row" }, fileInput, titleBox, uploadBtn);

  const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "Status filter" });
  const tabDefs: [string, string][] = [
    ["all", "All"], ["in_progress", "In progress"], ["completed", "Completed"], ["closed", "Declined or voided"],
  ];
  let activeTab = "all";
  const tabButtons = tabDefs.map(([key, label], index) => {
    const btn = el("button", { role: "tab", type: "button", text: label, id: `tab-${key}` });
    if (index === 0) {
      btn.setAttribute("aria-selected", "true");
    } else {
      btn.setAttribute("aria-selected", "false");
      btn.tabIndex = -1;
    }
    btn.addEventListener("click", () => { activeTab = key; selectTab(); void refresh(); });
    tabs.append(btn);
    return btn;
  });
  tabs.addEventListener("keydown", (event) => {
    const target = event.target as HTMLButtonElement;
    const index = tabButtons.indexOf(target);
    if (index === -1) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const dir = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + dir + tabButtons.length) % tabButtons.length;
      tabButtons.forEach((b, i) => {
        b.tabIndex = i === nextIndex ? 0 : -1;
        b.setAttribute("aria-selected", i === nextIndex ? "true" : "false");
      });
      const nextBtn = tabButtons[nextIndex];
      nextBtn.focus();
      const keys = ["all", "in_progress", "completed", "closed"];
      activeTab = keys[nextIndex];
      void refresh();
    }
  });
  function selectTab(): void {
    tabButtons.forEach((b, i) => {
      const key = ["all", "in_progress", "completed", "closed"][i];
      b.setAttribute("aria-selected", key === activeTab ? "true" : "false");
      b.tabIndex = key === activeTab ? 0 : -1;
    });
  }

  const tableWrap = el("div", { class: "doc-table" });
  const cardList = el("ul", { class: "card-list", "aria-label": "Documents", role: "list" });

  const content = el("div", {}, heading, updates, serviceNotice, uploadRow, tabs, tableWrap, cardList);
  const shell = frame("/documents", content);
  clear(app);
  app.append(shell);

  if (info.role === "viewer") uploadRow.remove();

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    uploadBtn.disabled = true;
    announce("doc-updates", `Uploading ${file.name}...`);
    const form = new FormData();
    form.append("file", file);
    const title = titleBox.value.trim();
    if (title !== "") form.append("title", title);
    try {
      const doc = await api.upload<DocumentDto>("/api/documents", form);
      announce("doc-updates", `${doc.title}: Draft`);
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      const message = uploadErrorMessage(e, file.name);
      announce("doc-updates", message);
      uploadBtn.focus();
    } finally {
      uploadBtn.disabled = false;
      fileInput.value = "";
    }
  });

  async function refresh(): Promise<void> {
    const data = await api.get<{ documents: DocumentListItem[] }>(`/api/documents?filter=${activeTab}`);
    renderTable(data.documents, tableWrap, cardList);
  }
  await refresh();
}

function uploadErrorMessage(e: unknown, fileName: string): string {
  const err = e as { body?: { error?: string; fields?: Record<string, string> }; status?: number };
  const code = err.body?.error;
  switch (code) {
    case "not_a_pdf": return "That file is not a PDF.";
    case "pdf_encrypted": return "Password-protected PDFs can't be uploaded.";
    case "pdf_has_scripts": return "PDFs with scripts can't be uploaded.";
    case "pdf_rotated": return "Rotated pages aren't supported. Upload a PDF with upright pages.";
    case "too_many_pages": return "This PDF has more than 60 pages.";
    case "too_large": return "This PDF is larger than 25 MB.";
    case "storage_unavailable": return "File storage is unavailable. Your PDF was not uploaded.";
    case "validation": return err.body?.fields?.file ?? err.body?.fields?.title ?? "Something went wrong. Try again.";
    default: return `That file is not a PDF.`;
  }
}

function renderTable(docs: DocumentListItem[], tableWrap: HTMLElement, cardList: HTMLElement): void {
  clear(tableWrap);
  clear(cardList);
  if (docs.length === 0) {
    tableWrap.append(el("p", { text: "No documents yet." }));
    return;
  }
  const table = el("table", { class: "data", "aria-label": "Documents" });
  const head = el("thead", {}, el("tr", {},
    el("th", { scope: "col", text: "Title" }),
    el("th", { scope: "col", text: "Status" }),
    el("th", { scope: "col", text: "Next step" }),
    el("th", { scope: "col", text: "Updated" }),
  ));
  const body = el("tbody");
  for (const doc of docs) {
    const link = el("a", { href: `/documents/${doc.id}`, text: doc.title });
    body.append(el("tr", {},
      el("td", {}, link),
      el("td", { text: statusWord(doc.status) }),
      el("td", { text: doc.nextStep }),
      el("td", { text: formLocalUtc(doc.updatedAt) }),
    ));
    cardList.append(el("li", { role: "listitem" },
      el("div", {}, el("strong", { text: "Title" }), ": ", link.cloneNode(true) as Node),
      el("div", {}, el("strong", { text: "Status" }), ": ", statusWord(doc.status)),
      el("div", {}, el("strong", { text: "Next step" }), ": ", doc.nextStep),
      el("div", {}, el("strong", { text: "Updated" }), ": ", formLocalUtc(doc.updatedAt)),
    ));
  }
  table.append(head, body);
  tableWrap.append(table);
}

function formLocalUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

async function loadSession(app: HTMLElement): Promise<SessionInfo | null> {
  try {
    session = await api.get<SessionInfo>("/api/session");
    return session;
  } catch {
    navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
    return null;
  }
}

/* ---------- audit trail ---------- */

async function renderAuditImpl(app: HTMLElement, documentId: string): Promise<void> {
  const info = await loadSession(app);
  if (info === null) return;
  let doc: DocumentDto | null = null;
  let events: { seq: number; type: string; actor: string; recipientId: string | null; at: string; prevHash: string; hash: string }[] = [];
  try {
    doc = await api.get<DocumentDto>(`/api/documents/${documentId}`);
    const audit = await api.get<{ events: typeof events }>(`/api/documents/${documentId}/audit`);
    events = audit.events;
  } catch {
    await renderNotFound(app);
    return;
  }
  const heading = el("h1", { text: "Audit trail" });
  const table = el("table", { class: "data", "aria-label": "Audit trail" });
  const head = el("thead", {}, el("tr", {},
    el("th", { scope: "col", text: "#" }),
    el("th", { scope: "col", text: "Event" }),
    el("th", { scope: "col", text: "By" }),
    el("th", { scope: "col", text: "Time (UTC)" }),
    el("th", { scope: "col", text: "Hash" }),
  ));
  const body = el("tbody");
  for (const event of events) {
    const hashCell = el("td", { title: event.hash, class: "hash-line", text: event.hash.slice(0, 12) });
    body.append(el("tr", {},
      el("td", { text: String(event.seq) }),
      el("td", { text: event.type }),
      el("td", { text: event.actor }),
      el("td", { class: "hash-line", text: formLocalUtc(event.at) }),
      hashCell,
    ));
  }
  table.append(head, body);
  const back = el("a", { href: `/documents/${documentId}`, text: `Back to ${doc.title}` });
  const content = el("div", {}, heading, back, table);
  if (doc.status === "completed" && doc.completedSha256 !== null) {
    content.append(el("div", { class: "banner" },
      el("div", {}, el("strong", { text: "Completed PDF SHA-256" })),
      el("div", { class: "hash-line", text: doc.completedSha256 }),
    ));
  }
  clear(app);
  app.append(frame("/documents", content));
}

/* ---------- templates ---------- */

async function renderTemplatesImpl(app: HTMLElement): Promise<void> {
  const info = await loadSession(app);
  if (info === null) return;
  const heading = el("h1", { text: "Templates" });
  const list = el("ul", { class: "card-list", "aria-label": "Templates", role: "list", style: "display:block" });
  const data = await api.get<{ templates: { id: string; name: string; status: "draft" | "shared" | "retired"; pageCount: number; signerCount: number }[] }>("/api/templates");
  for (const tpl of data.templates) {
    const li = el("li", { role: "listitem" });
    li.append(el("div", {}, el("strong", { text: tpl.name })));
    li.append(el("div", { text: `${tpl.signerCount} signers, ${tpl.pageCount} pages` }));
    if (info.role === "owner") {
      const word = tpl.status === "draft" ? "Draft" : tpl.status === "shared" ? "Shared" : "Retired";
      li.append(el("div", { text: word }));
      if (tpl.status === "draft") {
        const share = el("button", { class: "btn", type: "button", text: `Share ${tpl.name}` });
        share.addEventListener("click", async () => {
          await api.post(`/api/templates/${tpl.id}/share`);
          await renderTemplatesImpl(app);
        });
        li.append(share);
      } else if (tpl.status === "shared") {
        const retire = el("button", { class: "btn", type: "button", text: `Retire ${tpl.name}` });
        retire.addEventListener("click", async () => {
          await api.post(`/api/templates/${tpl.id}/retire`);
          await renderTemplatesImpl(app);
        });
        li.append(retire);
      }
    }
    const use = el("button", { class: "btn primary", type: "button", text: "Use template" });
    use.addEventListener("click", () => openUseDialog(use, tpl.id, tpl.name, tpl.signerCount, app));
    li.append(use);
    list.append(li);
  }
  clear(app);
  app.append(frame("/templates", heading, list));
}

function openUseDialog(openedBy: HTMLElement, templateId: string, name: string, signerCount: number, app: HTMLElement): void {
  const rows: { name: HTMLInputElement; email: HTMLInputElement }[] = [];
  const form = el("div", {});
  for (let k = 1; k <= signerCount; k++) {
    const nameInput = el("input", { type: "text", "aria-label": `Name for Signer ${k}` }) as HTMLInputElement;
    const emailInput = el("input", { type: "email", "aria-label": `Email for Signer ${k}` }) as HTMLInputElement;
    rows.push({ name: nameInput, email: emailInput });
    form.append(el("label", { text: `Name for Signer ${k}` }), nameInput);
    form.append(el("label", { text: `Email for Signer ${k}` }), emailInput);
  }
  const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
  const createBtn = el("button", { class: "btn primary", type: "button", text: "Create draft" });
  const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel" });
  const dialog = el("div", { class: "dialog-backdrop" },
    el("div", { class: "dialog", role: "dialog", "aria-label": "Use template" },
      el("h2", { text: `Use template: ${name}` }),
      form, errorBox,
      el("div", { class: "actions" }, cancelBtn, createBtn),
    ),
  );
  document.body.append(dialog);
  (rows[0]?.name ?? createBtn).focus();
  const close = (): void => { dialog.remove(); openedBy.focus(); };
  cancelBtn.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") trapTabGlobal(event, dialog);
  });
  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    try {
      const doc = await api.post<{ id: string }>(`/api/templates/${templateId}/use`, {
        signers: rows.map((r) => ({ name: r.name.value, email: r.email.value })),
      });
      dialog.remove();
      navigate(`/documents/${doc.id}`);
    } catch (e) {
      createBtn.disabled = false;
      const fields = (e as { body?: { fields?: Record<string, string> } }).body?.fields ?? {};
      errorBox.hidden = false;
      errorBox.textContent = fields.signers ?? "Something went wrong. Try again.";
    }
  });
}

/* ---------- team ---------- */

async function renderTeamImpl(app: HTMLElement): Promise<void> {
  const info = await loadSession(app);
  if (info === null) return;
  const heading = el("h1", { text: "Team" });
  const accountNotice = el("div", { class: "status-region", role: "status", id: "account-notice" });
  const data = await api.get<{ id: string; name: string; members: { id: string; email: string; name: string; role: string }[] }>("/api/team");
  const table = el("table", { class: "data", "aria-label": "Members" });
  const head = el("thead", {}, el("tr", {},
    el("th", { scope: "col", text: "Name" }),
    el("th", { scope: "col", text: "Email" }),
    el("th", { scope: "col", text: "Role" }),
  ));
  const body = el("tbody");
  for (const member of data.members) {
    const row = el("tr", {},
      el("td", { text: member.name }),
      el("td", { text: member.email }),
    );
    if (info.role === "owner") {
      const combo = el("select", { "aria-label": `Role for ${member.name}` });
      for (const role of ["Owner", "Member", "Viewer"]) {
        const opt = el("option", { value: role.toLowerCase(), text: role });
        if (member.role === role.toLowerCase()) opt.selected = true;
        combo.append(opt);
      }
      const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
      combo.addEventListener("change", async () => {
        try {
          await api.patch(`/api/team/members/${member.id}`, { role: combo.value });
          errorBox.hidden = true;
        } catch (e) {
          const err = (e as { body?: { error?: string } }).body?.error;
          errorBox.hidden = false;
          errorBox.textContent = err === "last_owner" ? "A team needs at least one owner." : "Something went wrong. Try again.";
          combo.value = member.role;
        }
      });
      row.append(el("td", {}, combo, errorBox));
    } else {
      row.append(el("td", { text: member.role }));
    }
    body.append(row);
  }
  table.append(head, body);
  clear(app);
  app.append(frame("/team", heading, accountNotice, table));
}

function trapTabGlobal(event: KeyboardEvent, container: HTMLElement): void {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea"))
    .filter((node) => !node.hasAttribute("disabled"));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/* route dispatch */
async function renderAudit(app: HTMLElement, id: string): Promise<void> { await renderAuditImpl(app, id); }
async function renderDocumentPage(app: HTMLElement, id: string): Promise<void> {
  const info = await loadSession(app);
  if (info === null) return;
  const { renderDocumentEditor } = await import("./editor.js");
  await renderDocumentEditor(app, id, info);
}
async function renderTemplates(app: HTMLElement): Promise<void> { await renderTemplatesImpl(app); }
async function renderTeam(app: HTMLElement): Promise<void> { await renderTeamImpl(app); }
async function renderSignerLink(app: HTMLElement, token: string): Promise<void> {
  const { renderSignerLink: render } = await import("./signer.js");
  await render(app, token);
}
