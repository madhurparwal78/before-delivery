import { api, announce, el, els, qs, qsa, motion, fmtDate, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { withBusy } from "../app.js";
import type { Json } from "../core.js";

type Piece = {
  id: string; clientId: string | null; title: string; maker: string | null; year: string | null; stampNumber: string | null;
  widthCm: number | null; depthCm: number | null; heightCm: number | null; weightKg: number | null;
  dueDate: string | null; notes: string | null; state: string; createdAt: string;
};
type Client = { id: string; name: string; town: string; language: string; email: string; state: string; closesAt: string | null };
type Material = { code: string; name: string; family: string; unit: string; prices: Record<string, string> };
type Estimate = Json & { id: string; version: number; state: string; currency: string; materialCode: string | null; lot: string | null; display: Record<string, string>; milestones: { percent: number; amountMinor: number }[] };

const stateNames: Record<string, string> = {
  received: "Received", inSurvey: "In survey", onTheBench: "On the bench", ready: "Ready", collected: "Collected", archived: "Archived",
};
const townList = ["Turin", "London", "New York", "Kyoto", "Dubai"];
const languageList = [["English", "en"], ["Italian", "it"], ["Japanese", "ja"], ["Arabic", "ar"]] as const;

let refreshTimer = 0;
export function autoRefresh(fn: () => Promise<void>): void {
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(async () => {
    try {
      await fn();
      const refreshState = qs("#refresh-state");
      if (refreshState) refreshState.textContent = "";
    } catch (e) {
      if (e instanceof ApiFail && (e.status >= 500 || e.status === 0)) {
        const refreshState = qs("#refresh-state");
        if (refreshState) refreshState.textContent = "Couldn't refresh. Trying again.";
      }
    }
  }, 5000);
}

const mainBar = (label: string, onClick: () => void, id = "main-action"): void => {
  const bar = qs("#bottom-bar");
  if (!bar) return;
  bar.innerHTML = `<button class="primary" id="${id}">${label}</button>`;
  (qs(`#${id}`, bar) as HTMLButtonElement).addEventListener("click", onClick);
};

export const mintTile = (figure: string, caption: string): string => `<div class="tile tile-mint"><p class="tile-figure">${figure}</p><p class="tile-caption">${caption}</p></div>`;

export async function piecesScreen(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div class="bento">
    <div class="tile filter-tile">
      <form id="pieces-filter" class="filters">
        <label>Client<select name="client" aria-label="Client"><option value="">All clients</option></select></label>
        <label>State<select name="state" aria-label="State"><option value="">All but archived</option></select></label>
        <label>Sort<select name="sort" aria-label="Sort"><option value="title">Title</option><option value="dueDate">Due date</option></select></label>
      </form>
    </div>
    <div class="tile table-tile" id="pieces-table-tile">
      <div class="mint-strip" id="due-strip"></div>
      <div class="table-frame" tabindex="0" role="region" aria-label="Pieces table"><table id="pieces-table"></table></div>
      <nav class="pager"><a href="#" id="next-page">Next page</a></nav>
    </div>
  </div>`;
  mainBar("New piece", () => newPieceDialog(root));
  setTitleFromRoot(root);

  const params = new URLSearchParams(location.search);
  const filterForm = root.querySelector<HTMLFormElement>("#pieces-filter")!;
  const clients = await api<{ clients: Client[] }>("/api/clients");
  const clientSelect = filterForm.elements.namedItem("client") as HTMLSelectElement;
  for (const c of clients.clients) {
    clientSelect.append(el(`<option value="${c.id}">${c.name}</option>`));
  }
  clientSelect.value = params.get("client") ?? "";
  (filterForm.elements.namedItem("sort") as HTMLSelectElement).value = params.get("sort") ?? "title";
  const stateSelect = filterForm.elements.namedItem("state") as HTMLSelectElement;
  for (const [value, label] of Object.entries(stateNames)) {
    stateSelect.append(el(`<option value="${value}">${label}</option>`));
  }
  stateSelect.value = params.get("state") ?? "";

  const commit = () => {
    const next = new URLSearchParams();
    const client = clientSelect.value;
    const state = stateSelect.value;
    const sort = (filterForm.elements.namedItem("sort") as HTMLSelectElement).value;
    if (client) next.set("client", client);
    if (state) next.set("state", state);
    if (sort && sort !== "title") next.set("sort", sort);
    history.pushState({}, "", `/pieces${next.toString() ? `?${next}` : ""}`);
    void loadPage();
  };
  filterForm.addEventListener("change", commit);

  const loadPage = async (): Promise<void> => {
    const url = new URLSearchParams(location.search);
    const cursor = url.get("cursor");
    const query = new URLSearchParams();
    for (const key of ["client", "state", "sort"]) {
      const value = url.get(key);
      if (value) query.set(key, value);
    }
    const path = `/api/pieces${query.toString() ? `?${query}` : ""}${cursor ? `${query.toString() ? "&" : "?"}` : ""}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data = await api<{ pieces: Piece[]; nextCursor: string | null }>(path);
    renderTable(data.pieces);
    const next = root.querySelector<HTMLAnchorElement>("#next-page")!;
    if (data.nextCursor) {
      next.textContent = "Next page";
      next.onclick = (e) => {
        e.preventDefault();
        const params2 = new URLSearchParams(location.search);
        params2.set("cursor", data.nextCursor!);
        history.pushState({}, "", `/pieces?${params2}`);
        void loadPage();
      };
    } else {
      next.textContent = "";
      next.onclick = null;
    }
    const strip = qs("#due-strip", root);
    const today = (await api<{ session: { today: string } }>("/api/session")).session.today;
    const dueSoon = data.pieces.filter((p) => p.dueDate && p.state !== "archived" && p.dueDate >= today && daysBetween(today, p.dueDate) <= 14);
    if (strip && dueSoon.length) {
      const p = dueSoon[0]!;
      strip.innerHTML = mintTile(p.title, "due in 14 days");
    } else if (strip) {
      strip.innerHTML = "";
    }
  };

  const renderTable = (pieces: Piece[]): void => {
    const table = root.querySelector<HTMLTableElement>("#pieces-table")!;
    table.innerHTML = `<thead><tr><th>Title</th><th>Due</th><th>State</th><th></th></tr></thead>
    <tbody>${pieces.length ? "" : `<tr><td colspan="4" class="empty">No pieces yet.</td></tr>`}</tbody>`;
    const tbody = table.querySelector("tbody")!;
    for (const p of pieces) {
      const row = el(`<tr>
        <td><a href="/pieces/${p.id}">${p.title}</a></td>
        <td>${p.dueDate ? fmtDate(p.dueDate) : ""}</td>
        <td>${stateNames[p.state] ?? p.state}</td>
        <td></td>
      </tr>`);
      const link = row.querySelector("a")!;
      link.addEventListener("click", (e) => { e.preventDefault(); navigateTo(`/pieces/${p.id}`); });
      const actions = el(`<button aria-haspopup="menu" aria-expanded="false">Actions for ${p.title}</button>`);
      actions.addEventListener("click", () => actionMenu(actions, p, root));
      row.querySelector("td:last-child")!.append(actions);
      tbody.append(row);
    }
  };

  await loadPage();
  autoRefresh(loadPage);
}

export function navigateTo(path: string): void {
  // Same-origin relative path; the app is fully server-rendered first, so a plain
  // navigation keeps the published behaviour simple and correct.
  window.location.href = path;
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function actionMenu(button: HTMLElement, piece: Piece, root: HTMLElement): void {
  const existing = qs("#row-menu");
  existing?.remove();
  const menu = el(`<div id="row-menu" role="menu">
    <button role="menuitem">Open</button>
    <button role="menuitem">Duplicate</button>
    <button role="menuitem">Archive</button>
  </div>`);
  const rect = button.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 160))}px`;
  document.body.append(menu);
  button.setAttribute("aria-expanded", "true");
  const close = () => {
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    button.focus();
  };
  const onDoc = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  });
  setTimeout(() => document.addEventListener("click", onDoc, true), 0);
  const [openBtn, dupeBtn, archiveBtn] = [...menu.querySelectorAll("button")] as HTMLButtonElement[];
  openBtn.addEventListener("click", () => { close(); navigateTo(`/pieces/${piece.id}`); });
  dupeBtn.addEventListener("click", async () => {
    close();
    await withBusy(archiveBtn, async () => {
      const res = await api<{ piece: Piece }>("/api/pieces", { method: "POST", json: { duplicateOf: piece.id } });
      announce(`${piece.title} duplicated.`);
      void res;
      window.location.reload();
    });
  });
  archiveBtn.addEventListener("click", async () => {
    close();
    await withBusy(archiveBtn, async () => {
      await api(`/api/pieces/${piece.id}`, { method: "PATCH", json: { state: "archived" } });
      announce(`${piece.title} archived.`);
      window.location.reload();
    });
  });
  void root;
}

function newPieceDialog(root: HTMLElement): void {
  void api<{ clients: Client[] }>("/api/clients").then(({ clients }) => {
    const options = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    const panel = dialogs.openDialog(
      "New piece",
      `<label>Client<select name="clientId" aria-label="Client">${options}</select></label>
       <label>Title<input name="title"></label>
       <label>Maker<input name="maker"></label>
       <label>Year<input name="year"></label>
       <label>Stamp number<input name="stampNumber"></label>
       <label>Width in cm<input name="widthCm" inputmode="decimal"></label>
       <label>Depth in cm<input name="depthCm" inputmode="decimal"></label>
       <label>Height in cm<input name="heightCm" inputmode="decimal"></label>
       <label>Weight in kg<input name="weightKg" inputmode="decimal"></label>
       <label>Due date<input name="dueDate" placeholder="YYYY-MM-DD"></label>
       <label>Notes<textarea name="notes"></textarea></label>`,
      async (form) => {
        const json: Record<string, unknown> = {};
        for (const [key, name] of Object.entries({ clientId: "clientId", title: "title", maker: "maker", year: "year", stampNumber: "stampNumber", dueDate: "dueDate", notes: "notes" })) {
          const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
          if (input && input.value !== "") json[key] = input.value;
        }
        for (const [key, name] of Object.entries({ widthCm: "widthCm", depthCm: "depthCm", heightCm: "heightCm", weightKg: "weightKg" })) {
          const input = form.elements.namedItem(name) as HTMLInputElement | null;
          if (input && input.value !== "") json[key] = input.value;
        }
        const res = await api<{ piece: Piece }>("/api/pieces", { method: "POST", json });
        announce(`${res.piece.title} saved.`);
        dialogs.closeDialog();
        navigateTo(`/pieces`);
      }
    );
    void panel;
    void root;
  });
}

export async function pieceScreen(root: HTMLElement): Promise<void> {
  const id = root.dataset.pieceId!;
  const load = async (): Promise<void> => {
    const [{ piece }, clients, holds, page] = await Promise.all([
      api<{ piece: Piece }>(`/api/pieces/${id}`),
      api<{ clients: Client[] }>("/api/clients"),
      api<{ holds: { holdId: string; code: string; lot: string; quantity: number | string; state: string; label: string }[] }>(`/api/pieces/${id}/holds`),
      api<{ clientPage: { address: string | null; state: string | null; endsAt: string | null; answer: { seatHeightCm: string } | null; signOff: { typedName: string; at: string } | null } }>(`/api/pieces/${id}/client-page`),
    ]);
    const client = clients.clients.find((c) => c.id === piece.clientId);
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <h2>${piece.title}</h2>
        <dl>
          <div><dt>Client</dt><dd><a href="/clients/${piece.clientId ?? ""}">${client?.name ?? ""}</a></dd></div>
          <div><dt>Maker</dt><dd>${piece.maker ?? ""} ${piece.year ?? ""}</dd></div>
          <div><dt>Stamp number</dt><dd>${piece.stampNumber ?? ""}</dd></div>
          <div><dt>Size</dt><dd>${piece.widthCm ?? ""} × ${piece.depthCm ?? ""} × ${piece.heightCm ?? ""} cm, ${piece.weightKg ?? ""} kg</dd></div>
          <div><dt>Due</dt><dd>${piece.dueDate ? fmtDate(piece.dueDate) : ""}</dd></div>
          <div><dt>State</dt><dd><select id="piece-state" aria-label="State">${Object.entries(stateNames).map(([v, l]) => `<option value="${v}" ${piece.state === v ? "selected" : ""}>${l}</option>`).join("")}</select></dd></div>
        </dl>
        <nav class="subnav">
          <a href="/pieces/${id}/condition">Condition</a>
          <a href="/pieces/${id}/photographs">Photographs</a>
          <a href="/pieces/${id}/hide">Hide</a>
          <a href="/pieces/${id}/estimate">Estimate</a>
          <a href="/pieces/${id}/collection">Collection</a>
          <a href="/pieces/${id}/dossier">Dossier</a>
        </nav>
      </div>
      <div class="tile">
        <button id="send-page" class="primary">Send client page</button>
        <button id="end-page">End this page</button>
        <details><summary>Holds</summary><ul>${holds.holds.map((h) => `<li>${h.code} ${h.lot} — ${h.label}</li>`).join("") || "<li>No holds yet.</li>"}</ul></details>
        <details><summary>Client page</summary><p id="page-state">${page.clientPage.address ? page.clientPage.address : "No page sent."}</p></details>
        <details><summary>Answers</summary><p id="answer-state">${page.clientPage.answer ? `${page.clientPage.answer.seatHeightCm} cm` : "No answer yet."}</p>${page.clientPage.signOff ? `<p>Signed off by ${page.clientPage.signOff.typedName}</p>` : ""}</details>
      </div>
      ${piece.dueDate ? mintTile(String(daysBetween(today(), piece.dueDate)), "days to due") : ""}
    </div>`;
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = piece.title;
    document.title = `${piece.title} — Semenza Desk`;
    qs("#send-page", root)!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      await withBusy(btn, async () => {
        const res = await api<{ clientPage: { address: string } }>(`/api/pieces/${id}/client-page`, { method: "POST", json: {} });
        announce(`Client page sent to ${client?.email ?? ""}.`);
        void res;
        await load();
      });
    });
    qs("#end-page", root)!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      await withBusy(btn, async () => {
        await api(`/api/pieces/${id}/client-page`, { method: "DELETE" });
        announce("Client page ended.");
        await load();
      });
    });
    qs("#piece-state", root)!.addEventListener("change", async (e) => {
      const select = e.currentTarget as HTMLSelectElement;
      try {
        await api(`/api/pieces/${id}`, { method: "PATCH", json: { state: select.value } });
        announce(select.value === "archived" ? `${piece.title} archived.` : `${piece.title} is now ${stateNames[select.value]}.`);
      } catch (err) {
        if (err instanceof ApiFail) announce(err.message);
      }
    });
  };
  mainBar("Send client page", () => qs("#send-page", root)?.click());
  await load();
  autoRefresh(load);
}

const today = (): string => new Date().toISOString().slice(0, 10);
const setTitleFromRoot = (root: HTMLElement): void => {
  void root;
};
void qsa;
void els;
void motion;
