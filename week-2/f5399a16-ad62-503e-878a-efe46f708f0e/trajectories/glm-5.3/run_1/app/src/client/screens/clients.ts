// Clients: the client list, the erased list, and a client's own screen with
// its producers and its closing journey.

import { el, link, type ScreenContext, heading, workingButton } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";

export async function buildClients(ctx: ScreenContext): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = heading(["Clients"], ctx.announcer);
  const rowsEl = el("tbody", {});
  const table = el("div", { class: "table-frame", role: "region", "aria-label": "Clients", tabindex: "0" },
    el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Place"), el("th", {}, "State"))), rowsEl),
  );
  const erasedList = el("ul", { class: "erased-list" });

  async function load(): Promise<void> {
    const answer = await api.get("/api/clients");
    const clients = (answer.clients as Json[]) ?? [];
    rowsEl.replaceChildren();
    for (const client of clients) {
      rowsEl.append(el("tr", {},
        el("td", {}, link(`/desk/clients/${String(client.id)}`, String(client.name))),
        el("td", {}, placeText(String(client.place))),
        el("td", {}, clientStateText(String(client.state))),
      ));
    }
    const erased = (answer.erasedClients as Json[]) ?? [];
    erasedList.replaceChildren();
    for (const client of erased) {
      erasedList.append(el("li", {}, `${String(client.name)} — Erased`));
    }
  }
  await load();

  const newClient = workingButton("New client", async () => {
    const name = window.prompt("Name") ?? "";
    if (name.trim().length === 0) {
      ctx.announcer.announce("Type a name.");
      return;
    }
    try {
      const client = await api.post("/api/clients", { name: name.trim(), place: "netherlands" });
      ctx.announcer.announce("Client added.");
      await ctx.router.go(`/desk/clients/${String(client.id)}`);
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "clients" }, h, table, el("h2", {}, "Erased"), erasedList, newClient);
  return { heading: h, body, refresh: load };
}

export async function buildClient(ctx: ScreenContext, clientId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  let headingText = "Client";
  const h = el("h1", {});
  const jobsEl = el("ul", { class: "client-jobs" });
  const producersEl = el("ul", { class: "client-producers" });
  const state = el("p", { class: "client-state" });
  let closeButton: HTMLElement | null = null;

  async function load(): Promise<void> {
    const client = await api.get(`/api/clients/${clientId}`);
    headingText = String(client.name);
    h.textContent = headingText;
    state.textContent = clientStateText(String(client.state));
    producersEl.replaceChildren();
    for (const producer of (client.producers as Json[]) ?? []) {
      producersEl.append(el("li", {}, `${String(producer.name)} — ${String(producer.email)}`));
    }
    jobsEl.replaceChildren();
    for (const job of (client.jobs as Json[]) ?? []) {
      jobsEl.append(el("li", {}, link(`/desk/jobs/${String(job.id)}`, String(job.title))));
    }
  }
  await load();

  const newProducer = workingButton("New producer", async () => {
    const name = window.prompt("Name") ?? "";
    const email = window.prompt("Email") ?? "";
    if (name.trim().length === 0 || email.trim().length === 0) {
      ctx.announcer.announce("Type a name.");
      return;
    }
    try {
      await api.post(`/api/clients/${clientId}/producers`, { name: name.trim(), email: email.trim(), town: "amsterdam", language: "en" });
      ctx.announcer.announce("Producer added.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  closeButton = workingButton("Close client", async () => {
    try {
      await api.post(`/api/clients/${clientId}/close`, {});
      ctx.announcer.announce("Closing. You can bring it back until the date shown.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "client" }, h, state, el("h2", {}, "Producers"), producersEl, newProducer, el("h2", {}, "Jobs"), jobsEl, closeButton);
  return { heading: h, body, refresh: load };
}

function placeText(place: string): string {
  switch (place) {
    case "netherlands": return "Netherlands";
    case "ontario": return "Ontario";
    case "newYork": return "New York";
    case "dubai": return "Dubai";
    default: return place;
  }
}

function clientStateText(state: string): string {
  switch (state) {
    case "active": return "Active";
    case "closing": return "Closing";
    case "erasing": return "Erasing";
    case "erased": return "Erased";
    default: return state;
  }
}
