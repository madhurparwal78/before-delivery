// Protests and corrections screens.
import {
  api, type EventObj, type ProtestObj, type CorrectionObj, type RegistrationObj,
} from "../api.js";
import { h, liveRegion, announce, errorMessage, Dialog, dialogTrap, fieldFor, pendingButton, localTime } from "../ui.js";
import { state, shell, eventSectionsNav } from "../client.js";

export async function renderProtests(eventId: string): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Protest updates");
  content.appendChild(region);
  const body = h("div", null);
  content.appendChild(body);
  await shell(content, { eventId });
  await drawProtests(eventId, body, region);
  const timer = setInterval(() => void drawProtests(eventId, body, region, false), 10_000);
  window.addEventListener("hashchange", () => clearInterval(timer), { once: true });
}

async function drawProtests(eventId: string, body: HTMLElement, region: HTMLElement, full = true): Promise<void> {
  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
  const { protests } = await api.get<{ protests: ProtestObj[] }>(`/api/events/${eventId}/protests`);
  const { registrations } = await api.get<{ registrations: RegistrationObj[] }>(`/api/events/${eventId}/registrations`);

  if (!full) {
    const nav = body.querySelector("nav");
    const heading = body.querySelector("h1");
    const fileButton = body.querySelector("button");
    body.textContent = "";
    if (nav) body.appendChild(nav);
    if (heading) body.appendChild(heading);
    if (fileButton) body.appendChild(fileButton);
  } else {
    body.textContent = "";
    body.appendChild(eventSectionsNav(event, "protests"));
    body.appendChild(h("h1", { text: "Protests" }));
    body.appendChild(h("div", { class: "status-line", text: protestLineText(event) }));

    const myReg = registrations.find((r) => r.driver.id === state.user?.id);
    if (myReg && event.protestWindowOpen) {
      body.appendChild(h<HTMLButtonElement>("button", {
        class: "primary",
        text: "File a protest",
        onclick: (e: Event) => { void openFileProtestDialog(event, registrations, e.currentTarget as HTMLButtonElement, region, async () => { await drawProtests(eventId, body, region, false); }); },
      }));
      body.appendChild(h("div", { style: "height:12px" }));
    }
  }

  const list = h("div", { class: "panel" });
  if (protests.length === 0) {
    list.appendChild(h("p", { class: "dim", text: "No protests." }));
  }
  const isChair = state.user?.roles.includes("chair") ?? false;
  for (const protest of protests) {
    const item = h("div", { class: "rail-item" });
    item.appendChild(h("div", { text: `Against car ${protest.subject.carNumber} ${protest.subject.classCode} (${protest.subject.driverName}), by ${protest.filedBy.name}` }));
    item.appendChild(h("div", { class: "dim", text: protest.text }));
    item.appendChild(h("div", { class: "status-line", text: `Filed ${localTime(protest.filedAt, event.timeZone, true)}` }));
    if (protest.status === "pending") {
      item.appendChild(h("div", { class: "status-line", text: "Pending decision" }));
    } else {
      item.appendChild(h("div", { class: "status-line", text: `${protest.status === "upheld" ? "Upheld" : "Denied"} - ${protest.decisionNote ?? ""}` }));
    }
    if (isChair && protest.status === "pending" && ["provisional"].includes(event.status)) {
      // The chair reads the correction entries beside the subject car, then decides.
      const detail = h("div", null);
      const toggle = h<HTMLButtonElement>("button", {
        class: "row-button",
        text: `Show corrections for car ${protest.subject.carNumber} ${protest.subject.classCode}`,
        onclick: async () => {
          const expanded = detail.hidden;
          detail.hidden = !expanded;
          if (expanded) {
            const { corrections } = await api.get<{ corrections: CorrectionObj[] }>(`/api/events/${eventId}/corrections?registrationId=${protest.subject.registrationId}`);
            detail.textContent = "";
            const region2 = h("div", { role: "region", "aria-label": `Protest against car ${protest.subject.carNumber} ${protest.subject.classCode}` });
            const ul = h("ul", { "aria-label": `Corrections for car ${protest.subject.carNumber} ${protest.subject.classCode}` });
            for (const c of corrections) {
              ul.appendChild(h("li", { text: correctionLine(c, event) }));
            }
            region2.appendChild(ul);
            detail.appendChild(region2);
          }
        },
      });
      item.appendChild(toggle);
      item.appendChild(detail);
      item.appendChild(decideControls(protest, region, async () => { await drawProtests(eventId, body, region, false); }));
    }
    list.appendChild(item);
  }
  body.appendChild(list);
}

function decideControls(protest: ProtestObj, region: HTMLElement, redraw: () => Promise<void>): HTMLElement {
  const note = document.createElement("input");
  note.setAttribute("aria-label", "Decision note");
  const uphold = h<HTMLButtonElement>("button", {
    class: "row-button",
    text: "Uphold",
    onclick: async (e: Event) => {
      const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Saving decision");
      try {
        await api.post(`/api/protests/${protest.id}/decision`, { decision: "upheld", note: note.value });
        announce(region, "Protest upheld.");
        await redraw();
      } catch (err) {
        announce(region, errorMessage(err));
        restore();
      }
    },
  });
  const deny = h<HTMLButtonElement>("button", {
    class: "row-button",
    text: "Deny",
    onclick: async (e: Event) => {
      const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Saving decision");
      try {
        await api.post(`/api/protests/${protest.id}/decision`, { decision: "denied", note: note.value });
        announce(region, "Protest denied.");
        await redraw();
      } catch (err) {
        announce(region, errorMessage(err));
        restore();
      }
    },
  });
  return h("div", { class: "timing-header" }, note, uphold, deny);
}

async function openFileProtestDialog(
  event: EventObj,
  registrations: RegistrationObj[],
  opener: HTMLButtonElement,
  region: HTMLElement,
  redraw: () => Promise<void>,
): Promise<void> {
  const dialog = new Dialog("File a protest", (dlg) => {
    const form = h("form", null) as HTMLFormElement;
    form.setAttribute("aria-label", "File a protest");
    form.appendChild(h("h2", { text: "File a protest" }));
    const car = document.createElement("select");
    car.setAttribute("aria-label", "Car protested");
    const ordered = [...registrations].sort((a, b) => a.classCode.localeCompare(b.classCode) || a.carNumber - b.carNumber);
    for (const reg of ordered) {
      const option = document.createElement("option");
      option.value = reg.id;
      option.textContent = `Car ${reg.carNumber} ${reg.classCode}, ${reg.driver.name}`;
      car.appendChild(option);
    }
    form.appendChild(fieldFor("Car protested", car));
    const text = document.createElement("textarea");
    text.setAttribute("aria-label", "Protest details");
    form.appendChild(fieldFor("Protest details", text));
    const file = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "File protest" });
    const cancel = h<HTMLButtonElement>("button", { type: "button", text: "Cancel", onclick: () => dlg.close() });
    form.appendChild(h("div", { class: "actions" }, file, cancel));
    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const restore = pendingButton(file, "Filing protest");
      try {
        const result = await api.post<{ protest: ProtestObj }>(`/api/events/${event.id}/protests`, {
          registrationId: car.value,
          text: text.value,
        });
        announce(region, `Protest filed against car ${result.protest.subject.carNumber} ${result.protest.subject.classCode}.`);
        dlg.close();
        await redraw();
      } catch (err) {
        announce(region, errorMessage(err));
        restore();
      }
    });
    dialogTrap(dlg, form);
    return form;
  }, opener);
  dialog.open();
}

export function protestLineText(event: EventObj): string {
  if (event.protestWindowOpen && event.protestWindowClosesAt) {
    return `Protest window open until ${localTime(event.protestWindowClosesAt, event.timeZone, false)}`;
  }
  if (["provisional", "final", "published"].includes(event.status)) return "Protest window closed";
  return "The protest window opens when provisional results are posted.";
}

/** `<raw time> +<cones>` or `DNF`, the shared correction value format. */
export function correctionValue(values: CorrectionObj["before"]): string {
  if (values.outcome === "dnf") return "DNF";
  return `${values.rawTime ?? ""} +${values.cones ?? 0}`;
}

export function correctionLine(c: CorrectionObj, event: EventObj): string {
  return `Run ${c.runNumber}: ${correctionValue(c.before)} to ${correctionValue(c.after)} by ${c.actor.name} at ${localTime(c.at, event.timeZone, false)}, reason: ${c.reason}`;
}

export async function renderCorrections(eventId: string): Promise<void> {
  const content = h("div", null);
  const body = h("div", null);
  content.appendChild(body);
  await shell(content, { eventId });
  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
  const { corrections } = await api.get<{ corrections: CorrectionObj[] }>(`/api/events/${eventId}/corrections`);

  body.appendChild(eventSectionsNav(event, "corrections"));
  body.appendChild(h("h1", { text: "Correction log" }));

  const table = h("table", { class: "data", "aria-label": "Correction log" }) as HTMLTableElement;
  table.appendChild(h("thead", null, h("tr", null,
    h("th", { text: "Time" }),
    h("th", { text: "Car" }),
    h("th", { text: "Run" }),
    h("th", { text: "Before" }),
    h("th", { text: "After" }),
    h("th", { text: "By" }),
    h("th", { text: "Reason" }),
  )));
  const tbody = h("tbody", null);
  for (const c of corrections) {
    tbody.appendChild(h("tr", null,
      h("td", { text: localTime(c.at, event.timeZone, true) }),
      h("td", { class: "mono", text: `${c.carNumber} ${c.classCode}` }),
      h("td", { class: "mono", text: String(c.runNumber) }),
      h("td", { class: "mono", text: correctionValue(c.before) }),
      h("td", { class: "mono", text: correctionValue(c.after) }),
      h("td", { text: c.actor.name }),
      h("td", { text: c.reason }),
    ));
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

export async function renderPublish(eventId: string): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Publish progress");
  content.appendChild(region);
  const body = h("div", null);
  content.appendChild(body);
  await shell(content, { eventId });

  const roles = state.user?.roles ?? [];
  if (!roles.includes("chair")) {
    body.appendChild(h("p", { class: "dim", text: "Publishing is for the event chair." }));
    return;
  }

  const draw = async () => {
    const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
    const publication = await api.get<{ status: string; renderer: "ok" | "unavailable"; publishedAt: string | null; checksum: string | null; emailsAccepted: number; emailsTotal: number }>(`/api/events/${eventId}/publication`);
    body.textContent = "";
    body.appendChild(eventSectionsNav(event, "publish"));
    body.appendChild(h("h1", { text: "Publish final results" }));

    if (publication.renderer === "unavailable") {
      body.appendChild(h("div", { class: "alert-fix", role: "alert", text: "Results PDF renderer is offline. Publishing is paused and drivers have not been emailed." }));
    }

    const bar = h("div", { class: "panel" });
    const publishButton = h<HTMLButtonElement>("button", {
      class: "primary",
      text: "Publish final results",
      onclick: async (e: Event) => {
        const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Publishing final results");
        try {
          await api.post(`/api/events/${eventId}/publish`, {});
          announce(region, "Final results published.");
          await draw();
        } catch (err) {
          announce(region, errorMessage(err));
        } finally {
          restore();
        }
      },
    });
    if (event.status !== "final" || publication.renderer === "unavailable") publishButton.disabled = true;
    bar.appendChild(publishButton);
    body.appendChild(bar);

    if (publication.publishedAt) {
      const info = h("div", { class: "panel" });
      info.appendChild(h("div", { text: `Published at ${localTime(publication.publishedAt, event.timeZone, true)}` }));
      if (publication.checksum) {
        info.appendChild(h("div", { class: "mono", text: `Checksum ${publication.checksum}` }));
      }
      info.appendChild(h("a", { href: `/api/events/${eventId}/results.pdf`, text: "Download results PDF" }));
      body.appendChild(info);
    }
  };

  await draw();
  const timer = setInterval(() => void draw(), 10_000);
  window.addEventListener("hashchange", () => clearInterval(timer), { once: true });
  void region;
}
