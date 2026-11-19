import { api, announce, el, qs, qsa, motion, fmtDate, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { withBusy } from "../app.js";
import { autoRefresh, mintTile, navigateTo } from "./pieces.js";

type Client = { id: string; name: string; town: string; language: string; email: string; state: string; closesAt: string | null };
type Piece = { id: string; clientId: string | null; title: string; dueDate: string | null; state: string; stampNumber: string | null };
const stateNames: Record<string, string> = {
  received: "Received", inSurvey: "In survey", onTheBench: "On the bench", ready: "Ready", collected: "Collected", archived: "Archived",
};
const townList = ["Turin", "London", "New York", "Kyoto", "Dubai"];
const languageList = [["English", "en"], ["Italian", "it"], ["Japanese", "ja"], ["Arabic", "ar"]] as const;

export async function clientsScreen(root: HTMLElement): Promise<void> {
  const load = async () => {
    const { clients } = await api<{ clients: Client[] }>("/api/clients");
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <div class="mint-strip" id="count-strip">${clients.length ? mintTile(String(clients.length), "clients") : ""}</div>
        <div class="table-frame" tabindex="0" role="region" aria-label="Clients table">
          <table><thead><tr><th>Name</th><th>Town</th><th>State</th></tr></thead>
          <tbody>${clients.length ? clients.map((c) => `<tr><td><a href="/clients/${c.id}">${c.name}</a></td><td>${c.town}</td><td>${c.state}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">No clients yet.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
    qsa("tbody a", root).forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo(a.getAttribute("href")!);
      })
    );
  };
  await load();
  autoRefresh(load);
  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="new-client">New client</button>`;
    qs("#new-client", bar)!.addEventListener("click", () => {
      dialogs.openDialog("New client", clientFormHtml(), async (form) => {
        const res = await api<{ client: Client }>("/api/clients", { method: "POST", json: clientFormJson(form) });
        announce(`${res.client.name} saved.`);
        dialogs.closeDialog();
        await load();
      });
    });
  }
}

const clientFormHtml = (c?: Client): string => `
  <label>Name<input name="name" value="${c?.name ?? ""}" autocomplete="name"></label>
  <label>Town<select name="town" aria-label="Town">${townList.map((t) => `<option ${c?.town === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
  <label>Language<select name="language" aria-label="Language">${languageList.map(([l, v]) => `<option value="${v}" ${c?.language === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
  <label>Email<input name="email" value="${c?.email ?? ""}" autocomplete="email"></label>`;

const clientFormJson = (form: HTMLFormElement): Record<string, string> => ({
  name: (form.elements.namedItem("name") as HTMLInputElement).value,
  town: (form.elements.namedItem("town") as HTMLSelectElement).value,
  language: (form.elements.namedItem("language") as HTMLSelectElement).value,
  email: (form.elements.namedItem("email") as HTMLInputElement).value,
});

export async function clientScreen(root: HTMLElement): Promise<void> {
  const id = root.dataset.clientId!;
  const load = async () => {
    const [{ client }, pieces] = await Promise.all([
      api<{ client: Client }>(`/api/clients/${id}`),
      api<{ pieces: Piece[] }>(`/api/pieces?client=${id}`),
    ]);
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = client.name;
    document.title = `${client.name} — Semenza Desk`;
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <h2>${client.name}</h2>
        <dl>
          <div><dt>Town</dt><dd>${client.town}</dd></div>
          <div><dt>Language</dt><dd>${client.language}</dd></div>
          <div><dt>Email</dt><dd>${client.email}</dd></div>
          <div><dt>State</dt><dd id="client-state">${client.state}</dd></div>
          <div><dt>Pieces</dt><dd>${pieces.pieces.map((p) => `<a href="/pieces/${p.id}">${p.title}</a>`).join(", ") || "None"}</dd></div>
        </dl>
      </div>
      ${mintTile(String(pieces.pieces.length), "pieces")}
      <div class="tile actions-tile" id="client-actions"></div>
    </div>`;
    const actions = qs("#client-actions", root)!;
    const render = () => {
      actions.innerHTML = "";
      const rename = el(`<button id="rename-client">Rename client</button>`);
      rename.addEventListener("click", () => {
        dialogs.openDialog("Rename client", clientFormHtml(client), async (form) => {
          const res = await api<{ client: Client }>(`/api/clients/${id}`, { method: "PATCH", json: clientFormJson(form) });
          announce(`${res.client.name} saved.`);
          dialogs.closeDialog();
          await load();
        });
      });
      actions.append(rename);
      if (client.state === "active") {
        const closeBtn = el(`<button id="close-client">Close client</button>`);
        closeBtn.addEventListener("click", () => {
          dialogs.openDialog("Close this client", `<p>Closing ${client.name} starts the wait.</p>`, async () => {
            await api(`/api/clients/${id}/close`, { method: "POST", json: {} });
            announce(`${client.name} is closing. You can bring it back until ${fmtDate(waitEnd(client.closesAt))}.`);
            dialogs.closeDialog();
            await load();
          });
        });
        actions.append(closeBtn);
        const del = el(`<button id="delete-client">Delete client</button>`);
        del.addEventListener("click", async () => {
          await withBusy(del as HTMLButtonElement, async () => {
            await api(`/api/clients/${id}`, { method: "DELETE" });
            announce(`${client.name} deleted.`);
            navigateTo("/clients");
          });
        });
        actions.append(del);
      } else if (client.state === "closing") {
        const bring = el(`<button id="bring-back">Bring back</button>`);
        bring.addEventListener("click", async () => {
          await withBusy(bring as HTMLButtonElement, async () => {
            await api(`/api/clients/${id}/bring-back`, { method: "POST", json: {} });
            announce(`${client.name} is back.`);
            await load();
          });
        });
        actions.append(bring);
      }
    };
    render();
  };
  await load();
  autoRefresh(load);
  void ApiFail;
  void motion;
}

const waitEnd = (closesAt: string | null): string => {
  if (!closesAt) return "";
  const d = new Date(closesAt);
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};
