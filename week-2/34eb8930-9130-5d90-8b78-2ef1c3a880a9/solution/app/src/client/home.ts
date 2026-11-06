import { ICONS, formatWhen, h, plural, quillMark, svgIcon } from "./dom.js";
import { HttpError, Live, api, type ServerFrame } from "./net.js";
import { NoticesControl } from "./notices.js";
import { navigate, setSession, type View } from "./router.js";
import { announce, debounce, field, openDialog, showFieldErrors } from "./ui.js";
import { ROLE_LABEL, type ProposalSummary, type SessionPerson } from "../shared/types.js";

function menuBar(notices: NoticesControl, ...extra: HTMLElement[]): HTMLElement {
  return h("header", { class: "menubar home-bar" },
    h("a", { href: "/", "data-route": true, class: "brand" }, quillMark(), h("span", {}, "Quillmere Drafts")),
    h("div", { class: "menubar-actions" }, notices.button, ...extra));
}

/** Documents home (Screens and layout; DP-03, DP-04, DP-05, DP-38, DP-39). */
export function mountHome(root: HTMLElement, me: SessionPerson): View {
  const notices = new NoticesControl();
  const signOut = h("button", { type: "button", class: "chrome-btn" }, svgIcon(ICONS.logout), h("span", { class: "label" }, "Sign out"));
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    await api("DELETE", "/api/session").catch(() => undefined);
    setSession(null);
    navigate("/sign-in");
  });
  const search = h("input", { type: "search", id: "proposal-search", "aria-label": "Search proposals", placeholder: "Search titles and clients", autocomplete: "off" });
  const newButton = me.isConsultant ? h("button", { type: "button", class: "btn primary" }, svgIcon(ICONS.plus), "New proposal") : null;
  const lists = h("div", { class: "proposal-lists" });
  const recent = section("Recent", "recent-title");
  const second = section(me.isConsultant ? "My proposals" : "Shared with me", "second-title");
  const results = h("ul", { "aria-label": "Search results", class: "proposal-list" });
  const resultsWrap = h("div", { class: "results", hidden: true }, results);
  lists.append(recent.el, second.el);
  for (const s of [recent, second]) s.list.append(...skeleton());

  let query = "";
  let seq = 0;
  let pendingAnnounce = false;
  let lastCount: number | null = null;
  const announceCount = (): void => {
    if (lastCount === null) { pendingAnnounce = true; return; }
    pendingAnnounce = false;
    announce(lastCount === 0 ? "No proposals match" : plural(lastCount, "proposal", "proposals"));
  };
  const searchTimer = debounce(1000 / 3, announceCount);

  async function load(): Promise<void> {
    const [r, s] = await Promise.all([
      api<{ documents: ProposalSummary[] }>("GET", "/api/documents?view=recent"),
      api<{ documents: ProposalSummary[] }>("GET", `/api/documents?view=${me.isConsultant ? "mine" : "shared"}`),
    ]);
    fill(recent.list, r.documents, false, "Proposals you open appear here.");
    fill(second.list, s.documents, me.isConsultant, me.isConsultant ? "No proposals yet. Start one with New proposal." : "Nothing is shared with you yet.");
    if (query) await runSearch();
  }

  async function runSearch(): Promise<void> {
    const mine = ++seq;
    const q = query;
    const data = await api<{ documents: ProposalSummary[] }>("GET", `/api/documents?q=${encodeURIComponent(q)}`);
    if (mine !== seq || q !== query) return;
    fill(results, data.documents, me.isConsultant, "No proposals match");
    lastCount = data.documents.length;
    if (pendingAnnounce) announceCount();
  }

  search.addEventListener("input", () => {
    query = search.value.trim();
    lastCount = null;
    resultsWrap.hidden = !query;
    lists.hidden = Boolean(query);
    if (!query) { searchTimer.cancel(); return; }
    void runSearch();
    searchTimer.poke();
  });

  /** Keyed rows: an unchanged proposal keeps its row element across live refreshes. */
  function fill(list: HTMLElement, proposals: ProposalSummary[], deletable: boolean, empty: string): void {
    if (!proposals.length) { list.replaceChildren(h("li", { class: "empty-row" }, quillMark(), h("span", {}, empty))); return; }
    const old = new Map([...list.querySelectorAll<HTMLElement>(":scope > li[data-key]")].map((li) => [li.dataset.key, li]));
    const rows = proposals.map((d) => {
      const key = JSON.stringify([d.id, d.title, d.client, d.role, d.updatedAt, deletable]);
      const kept = old.get(key);
      if (kept) return kept;
      const fresh = row(d, deletable && d.role === "owner");
      fresh.dataset.key = key;
      return fresh;
    });
    rows.forEach((r, i) => { if (list.children[i] !== r) list.insertBefore(r, list.children[i] ?? null); });
    while (list.children.length > rows.length) list.lastElementChild?.remove();
  }

  function row(d: ProposalSummary, deletable: boolean): HTMLElement {
    const del = deletable ? h("button", { type: "button", class: "icon-btn danger", "aria-label": `Delete ${d.title}` }, svgIcon(ICONS.trash)) : null;
    del?.addEventListener("click", () => confirmDelete(d, del));
    return h("li", { class: "proposal-row" },
      h("div", { class: "proposal-main" },
        h("a", { href: `/d/${encodeURIComponent(d.id)}`, "data-route": true, class: "proposal-title" }, d.title),
        h("p", { class: "proposal-meta" }, h("span", {}, d.client), h("span", { class: "role-tag" }, ROLE_LABEL[d.role]), h("span", {}, `Changed ${formatWhen(d.updatedAt)}`))),
      del);
  }

  let deleting: (() => void) | null = null;
  function confirmDelete(d: ProposalSummary, opener: HTMLElement): void {
    const yes = h("button", { type: "button", class: "btn danger" }, "Delete");
    const no = h("button", { type: "button", class: "btn quiet" }, "Cancel");
    const alert = h("div", { role: "alert", class: "form-alert" });
    const dialog = h("dialog", { class: "dialog", role: "alertdialog", "aria-labelledby": "delete-title", "aria-describedby": "delete-text" },
      h("h2", { id: "delete-title", class: "dialog-title" }, "Delete proposal"),
      h("p", { id: "delete-text" }, `Delete “${d.title}”? Everyone with access loses it at once.`),
      alert, h("div", { class: "dialog-actions" }, no, yes));
    deleting = openDialog(dialog, { opener, focus: no, onClose: () => dialog.remove() });
    no.addEventListener("click", () => deleting?.());
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      no.disabled = true;
      yes.textContent = "Deleting";
      alert.textContent = "";
      try {
        await api("DELETE", `/api/documents/${encodeURIComponent(d.id)}`);
        announce(`Deleted ${d.title}`);
        deleting?.();
        void load();
      } catch (e) {
        yes.disabled = false;
        no.disabled = false;
        yes.textContent = "Delete";
        alert.textContent = e instanceof HttpError && e.status === 503
          ? "Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute."
          : "The proposal wasn't deleted. Try again in a minute.";
      }
    });
  }

  newButton?.addEventListener("click", () => {
    const title = h("input", { id: "new-title", type: "text", autocomplete: "off" });
    const client = h("input", { id: "new-client", type: "text", autocomplete: "off" });
    const create = h("button", { type: "submit", class: "btn primary" }, "Create");
    const cancel = h("button", { type: "button", class: "btn quiet" }, "Cancel");
    const form = h("form", { novalidate: true, class: "dialog-form" }, field("Title", title), field("Client", client), h("div", { class: "dialog-actions" }, cancel, create));
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "new-title-h" }, h("h2", { id: "new-title-h", class: "dialog-title" }, "New proposal"), form);
    const closeNew = openDialog(dialog, { opener: newButton, focus: title, onClose: () => dialog.remove() });
    cancel.addEventListener("click", () => closeNew());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      create.disabled = true;
      create.textContent = "Creating";
      try {
        const proposal = await api<ProposalSummary>("POST", "/api/documents", { title: title.value, client: client.value });
        closeNew();
        navigate(`/d/${encodeURIComponent(proposal.id)}`);
      } catch (err) {
        create.disabled = false;
        create.textContent = "Create";
        if (err instanceof HttpError) showFieldErrors(form, err.fields, { title, client });
      }
    });
  });

  const live = new Live((f: ServerFrame) => {
    if (f.type === "notice" || f.type === "lists_changed") void notices.refresh();
    if (f.type === "lists_changed") void load();
  }, () => undefined, () => undefined);

  root.append(menuBar(notices, signOut), h("main", { class: "home" },
    h("div", { class: "home-head" },
      h("h1", {}, "Documents"),
      h("p", { class: "lede" }, me.isConsultant ? `Signed in as ${me.displayName}, consultant.` : `Signed in as ${me.displayName}.`)),
    h("div", { class: "home-tools" }, h("div", { class: "search" }, svgIcon(ICONS.search), search), newButton),
    resultsWrap, lists));
  void load().catch(() => undefined);
  return { unmount: () => { live.close(); notices.destroy(); deleting?.(); } };
}

function section(title: string, id: string): { el: HTMLElement; list: HTMLElement } {
  const list = h("ul", { class: "proposal-list", "aria-labelledby": id });
  return { el: h("section", { "aria-labelledby": id, class: "proposal-section" }, h("h2", { id }, title), list), list };
}

function skeleton(): HTMLElement[] {
  return [0, 1, 2].map(() => h("li", { class: "skeleton-row", "aria-hidden": "true" }, h("span", {}), h("span", {})));
}
