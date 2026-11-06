// Event screens: list, overview, timing, rota, live results, protests,
// corrections and publish.
import { api, ApiFail, type EventObj, type RegistrationObj, type ProtestObj } from "../api.js";
import {
  h, liveRegion, announce, errorMessage, errorFields, fixFieldsAlert,
  Dialog, dialogTrap, localTime, statusLabels, pendingButton, fieldFor,
} from "../ui.js";
import { state, shell, navigate, eventSectionsNav } from "../client.js";

export async function renderEvents(): Promise<void> {
  const { events } = await api.get<{ events: EventObj[] }>("/api/events");
  const content = h("div", null);
  content.appendChild(h("h1", { text: "Events" }));

  const roles = state.user?.roles ?? [];
  if (roles.includes("chair")) {
    const newButton = h<HTMLButtonElement>("button", {
      class: "primary",
      text: "New event",
      onclick: (e: Event) => void openNewEventDialog(e.currentTarget as HTMLButtonElement, content),
    });
    content.appendChild(newButton);
    content.appendChild(h("div", { style: "height:12px" }));
  }

  const list = h("div", { class: "panel" });
  if (events.length === 0) {
    list.appendChild(h("p", { class: "dim", text: "No events yet." }));
  }
  for (const event of events) {
    const row = h("a", {
      class: "rail-item",
      href: `#/events/${event.id}`,
      onclick: (e: Event) => {
        e.preventDefault();
        void navigate(`/events/${event.id}`);
      },
    });
    row.appendChild(h("div", { class: "heat-link", text: event.name }));
    row.appendChild(h("div", { class: "classes", text: `${event.date} - ${event.venue}` }));
    row.appendChild(h("div", { class: "count", text: statusLabels[event.status] }));
    list.appendChild(row);
  }
  content.appendChild(list);
  await shell(content);
}

async function openNewEventDialog(opener: HTMLButtonElement, _content: HTMLElement): Promise<void> {
  const tables = await api.get<{ tables: { effectiveDate: string; factors: Record<string, string> }[] }>("/api/index-tables");
  const classes = Object.keys(tables.tables[tables.tables.length - 1]?.factors ?? {}).sort();

  let heatsCount = 2;
  const classHeatSelects = new Map<string, HTMLSelectElement>();

  const dialog = new Dialog("New event", (dlg) => {
    const form = h("form", { role: "dialog", "aria-label": "New event" }) as HTMLFormElement;

    const name = document.createElement("input");
    name.id = "ev-name";
    form.appendChild(fieldFor("Event name", name));

    const date = document.createElement("input");
    date.id = "ev-date";
    date.placeholder = "YYYY-MM-DD";
    form.appendChild(fieldFor("Date", date));

    const venue = document.createElement("input");
    venue.id = "ev-venue";
    form.appendChild(fieldFor("Venue", venue));

    const cutoff = document.createElement("input");
    cutoff.id = "ev-cutoff";
    cutoff.placeholder = "YYYY-MM-DDTHH:MM";
    form.appendChild(fieldFor("Registration cutoff", cutoff));

    const runs = document.createElement("input");
    runs.type = "number";
    runs.min = "1";
    runs.max = "6";
    runs.value = "3";
    form.appendChild(fieldFor("Runs per driver", runs));

    const heats = document.createElement("input");
    heats.type = "number";
    heats.min = "2";
    heats.max = "4";
    heats.value = "2";
    heats.addEventListener("change", () => {
      heatsCount = Number(heats.value);
      rebuildClassRows();
    });
    form.appendChild(fieldFor("Heats", heats));

    const classRows = h("div", null);
    form.appendChild(classRows);

    function rebuildClassRows(): void {
      classRows.textContent = "";
      for (const cls of classes) {
        const select = document.createElement("select");
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "Not run";
        select.appendChild(none);
        for (let i = 1; i <= heatsCount; i++) {
          const option = document.createElement("option");
          option.value = String(i);
          option.textContent = `Heat ${i}`;
          select.appendChild(option);
        }
        classHeatSelects.set(cls, select);
        classRows.appendChild(fieldFor(`Heat for ${cls}`, select));
      }
    }
    rebuildClassRows();

    const stations = document.createElement("textarea");
    stations.id = "ev-stations";
    stations.placeholder = "One station per line";
    form.appendChild(fieldFor("Stations", stations));

    const save = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Save event" });
    const cancel = h<HTMLButtonElement>("button", { type: "button", text: "Cancel", onclick: () => dlg.close() });
    form.appendChild(h("div", { class: "actions" }, save, cancel));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      save.textContent = "Saving event";
      const classHeats: Record<string, number | null> = {};
      for (const [cls, select] of classHeatSelects) {
        classHeats[cls] = select.value ? Number(select.value) : null;
      }
      try {
        const result = await api.post<{ event: EventObj }>("/api/events", {
          name: name.value,
          date: date.value,
          venue: venue.value,
          registrationCutoff: cutoff.value,
          runsPerDriver: Number(runs.value),
          heats: Number(heats.value),
          classHeats,
          stations: stations.value.split("\n").map((s) => s.trim()).filter(Boolean),
        });
        dlg.close();
        await navigate(`/events/${result.event.id}`);
      } catch (e) {
        save.disabled = false;
        save.textContent = "Save event";
        if (e instanceof ApiFail && Object.keys(e.body.fields ?? {}).length > 0) {
          form.querySelector(".alert-fix")?.remove();
          form.insertBefore(fixFieldsAlert(e.body.fields ?? {}, {}), form.firstChild);
        }
      }
    });

    dialogTrap(dlg, form);
    return form;
  }, opener);
  dialog.open();
}

export async function renderEventOverview(eventId: string): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Event updates");
  content.appendChild(region);
  const body = h("div", { id: "overview-body" });
  content.appendChild(body);
  await shell(content, { eventId });
  await drawOverview(eventId, body, region);
  const timer = setInterval(() => void drawOverview(eventId, body, region), 10_000);
  window.addEventListener("hashchange", () => clearInterval(timer), { once: true });
}

async function drawOverview(eventId: string, body: HTMLElement, region: HTMLElement): Promise<void> {
  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
  const { registrations } = await api.get<{ registrations: RegistrationObj[] }>(`/api/events/${eventId}/registrations`);
  body.textContent = "";
  body.appendChild(eventSectionsNav(event, "overview"));

  const panel = h("div", { class: "panel" });
  panel.appendChild(h("h1", { text: event.name }));
  panel.appendChild(h("div", { class: "status-label", text: statusLabels[event.status] }));
  panel.appendChild(h("div", { class: "status-line", text: `${event.date} - ${event.venue}` }));
  panel.appendChild(h("div", { class: "status-line", text: registrationLine(event) }));
  if (event.status === "provisional" || event.status === "final" || event.status === "published") {
    panel.appendChild(h("div", { class: "status-line", text: protestLine(event) }));
  }
  panel.appendChild(h("div", { class: "status-line", text: `Index table effective ${event.indexTable.effectiveDate}` }));
  for (const cls of Object.keys(event.factors).sort()) {
    if (event.heats.some((hh) => hh.classes.includes(cls))) {
      panel.appendChild(h("div", { class: "status-line mono", text: `${cls} ${event.factors[cls]}` }));
    }
  }
  body.appendChild(panel);

  const roles = state.user?.roles ?? [];
  const me = state.user;
  const myReg = registrations.find((r) => r.driver.id === me?.id) ?? null;
  const protests = ["provisional", "final"].includes(event.status)
    ? (await api.get<{ protests: ProtestObj[] }>(`/api/events/${eventId}/protests`)).protests
    : [];

  // Lifecycle buttons for the chair.
  if (roles.includes("chair")) {
    const bar = h("div", { class: "panel" });
    const moves: [string, string][] = [
      ["draft", "Open registration"],
      ["registration_open", "Close registration"],
      ["registration_closed", "Start event"],
      ["running", "Post provisional results"],
      ["provisional", "Set results final"],
    ];
    for (const [from, label] of moves) {
      if (event.status !== from) continue;
      const button = h<HTMLButtonElement>("button", {
        class: "primary",
        text: label,
        onclick: async (e: Event) => {
          const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Updating event");
          try {
            const to = movesNext(from);
            await api.post(`/api/events/${event.id}/transition`, { to });
            announce(region, `Event is now ${statusLabels[to]}.`);
            await drawOverview(eventId, body, region);
          } catch (err) {
            announce(region, errorMessage(err));
          } finally {
            restore();
          }
        },
      });
      if (from === "provisional") {
        button.disabled = event.protestWindowOpen || protests.some((p) => p.status === "pending");
      }
      bar.appendChild(button);
    }
    if (bar.children.length > 0) body.appendChild(bar);
  }

  // The signed-in driver's registration panel.
  if (me && !roles.includes("operator")) {
    const panel2 = h("div", { class: "panel" });
    if (myReg) {
      panel2.appendChild(h("div", { text: `Car ${myReg.carNumber} ${myReg.classCode} - run heat ${myReg.runHeat}` }));
      if (myReg.station) {
        panel2.appendChild(h("div", { class: "status-line", text: `Working ${myReg.station.name} in heat ${myReg.station.heat}` }));
      }
      if (myReg.checkedIn) {
        panel2.appendChild(h("div", { class: "status-line", text: "Checked in. Your signed waiver is saved." }));
      } else if (["registration_closed", "running"].includes(event.status)) {
        panel2.appendChild(h<HTMLButtonElement>("button", {
          text: "Check in",
          onclick: (e: Event) => { void openCheckInDialog(myReg, e.currentTarget as HTMLButtonElement, region, async () => { await drawOverview(eventId, body, region); }); },
        }));
      }
      if (["registration_open", "registration_closed"].includes(event.status)) {
        panel2.appendChild(h<HTMLButtonElement>("button", {
          text: "Withdraw",
          onclick: async (e: Event) => {
            const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Withdrawing");
            try {
              await api.del(`/api/registrations/${myReg.id}`);
              announce(region, `You have withdrawn from ${event.name}.`);
              await drawOverview(eventId, body, region);
            } catch (err) {
              announce(region, errorMessage(err));
            } finally {
              restore();
            }
          },
        }));
      }
    } else {
      const form = h("form", null) as HTMLFormElement;
      form.setAttribute("aria-label", "Register car");
      const classes = event.heats.flatMap((hh) => hh.classes).sort();
      const classSelect = document.createElement("select");
      classSelect.setAttribute("aria-label", "Class");
      for (const cls of classes) {
        const option = document.createElement("option");
        option.value = cls;
        option.textContent = cls;
        classSelect.appendChild(option);
      }
      const carNumber = document.createElement("input");
      carNumber.setAttribute("aria-label", "Car number");
      carNumber.type = "number";
      carNumber.min = "1";
      carNumber.max = "999";
      const carDescription = document.createElement("input");
      carDescription.setAttribute("aria-label", "Car description");
      const registerButton = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Register" });
      if (!event.registrationOpen) registerButton.disabled = true;
      form.appendChild(classSelect);
      form.appendChild(carNumber);
      form.appendChild(carDescription);
      form.appendChild(registerButton);
      form.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        const restore = pendingButton(registerButton, "Registering");
        try {
          const result = await api.post<{ registration: RegistrationObj }>(`/api/events/${event.id}/registrations`, {
            classCode: classSelect.value,
            carNumber: Number(carNumber.value),
            carDescription: carDescription.value,
          });
          const pending = result.registration.confirmationEmail === "pending";
          announce(region, `Registered: car ${result.registration.carNumber} ${result.registration.classCode}, run heat ${result.registration.runHeat}.` + (pending ? " Your confirmation email is delayed. We'll keep trying." : ""));
          await drawOverview(eventId, body, region);
        } catch (err) {
          announce(region, errorMessage(err));
        } finally {
          restore();
        }
      });
      panel2.appendChild(form);
    }
    if (panel2.children.length > 0) body.appendChild(panel2);
  }
}

function movesNext(from: string): string {
  const map: Record<string, string> = {
    draft: "registration_open",
    registration_open: "registration_closed",
    registration_closed: "running",
    running: "provisional",
    provisional: "final",
  };
  return map[from];
}

export function registrationLine(event: EventObj): string {
  if (!event.registrationOpen) return "Registration closed";
  const at = new Date(event.registrationCutoffUtc);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: event.timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `Registration closes ${map.year}-${map.month}-${map.day} at ${map.hour === "24" ? "00" : map.hour}:${map.minute}`;
}

export function protestLine(event: EventObj): string {
  if (event.protestWindowOpen && event.protestWindowClosesAt) {
    return `Protest window open until ${localTime(event.protestWindowClosesAt, event.timeZone, false)}`;
  }
  return "Protest window closed";
}

async function openCheckInDialog(
  reg: RegistrationObj,
  opener: HTMLButtonElement,
  region: HTMLElement,
  redraw: () => Promise<void>,
): Promise<void> {
  const dialog = new Dialog("Check in and sign waiver", (dlg) => {
    const form = h("form", null) as HTMLFormElement;
    form.setAttribute("aria-label", "Check in and sign waiver");
    const waiver = h("p", { class: "dim", text: "I acknowledge the risks of motorsport and agree to follow all event rules and official instructions." });
    const signature = document.createElement("input");
    signature.setAttribute("aria-label", "Type your full name to sign");
    const sign = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Sign and check in" });
    const cancel = h<HTMLButtonElement>("button", { type: "button", text: "Cancel", onclick: () => dlg.close() });
    form.appendChild(waiver);
    form.appendChild(fieldFor("Type your full name to sign", signature));
    form.appendChild(h("div", { class: "actions" }, sign, cancel));
    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const restore = pendingButton(sign, "Signing your waiver");
      try {
        await api.post(`/api/registrations/${reg.id}/check-in`, { signature: signature.value });
        announce(region, "Checked in. Your signed waiver is saved.");
        dlg.close();
        await redraw();
      } catch (err) {
        announce(region, errorMessage(err));
        const fields = errorFields(err);
        if (fields.signature) {
          form.querySelector(".field-error")?.remove();
          form.appendChild(h("div", { class: "field-error", text: fields.signature }));
        }
      } finally {
        restore();
      }
    });
    dialogTrap(dlg, form);
    return form;
  }, opener);
  dialog.open();
}
