// Rota screen: stations per heat, open counters, claim/release/assign.
import { api, type EventObj, type RotaHeat, type RegistrationObj } from "../api.js";
import { h, liveRegion, announce, errorMessage, Dialog, dialogTrap, pendingButton } from "../ui.js";
import { state, shell, eventSectionsNav } from "../client.js";

export async function renderRota(eventId: string): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Rota updates");
  content.appendChild(region);
  const body = h("div", { id: "rota-body" });
  content.appendChild(region.cloneNode(false) ? body : body);
  await shell(content, { eventId });
  await drawRota(eventId, body, region);
  const timer = setInterval(() => void drawRota(eventId, body, region, false), 2000);
  window.addEventListener("hashchange", () => clearInterval(timer), { once: true });
}

export async function drawRota(eventId: string, body: HTMLElement, region: HTMLElement, full = true): Promise<void> {
  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
  const { heats } = await api.get<{ heats: RotaHeat[] }>(`/api/events/${eventId}/rota`);
  const { registrations } = await api.get<{ registrations: RegistrationObj[] }>(`/api/events/${eventId}/registrations`);

  if (full) {
    body.textContent = "";
    body.appendChild(eventSectionsNav(event, "rota"));
    // Under 1024px the heat combobox sits at the top; it shares the shell's copy.
  } else {
    const nav = body.querySelector("nav");
    body.textContent = "";
    if (nav) body.appendChild(nav);
  }

  const me = state.user;
  const myReg = registrations.find((r) => r.driver.id === me?.id) ?? null;
  const roles = me?.roles ?? [];
  const canAssign = roles.includes("chair") || roles.includes("workers");

  for (const heat of heats) {
    const section = h("section", { class: "panel", id: `heat-${heat.number}` });
    section.appendChild(h("h2", {
      role: "heading",
      text: `Heat ${heat.number}: ${heat.unfilled} ${heat.unfilled === 1 ? "station" : "stations"} open`,
    }));
    const rows = h("div", null);
    for (const station of heat.stations) {
      const row = h("div", { class: "rail-item" });
      const label = station.worker
        ? `${station.worker.driverName}, car ${station.worker.carNumber} ${station.worker.classCode}`
        : "Open";
      row.appendChild(h("div", { text: `${station.name} - ${label}` }));
      if (!station.worker && !roles.includes("operator")) {
        row.appendChild(h<HTMLButtonElement>("button", {
          class: "row-button",
          text: `Claim ${station.name}, heat ${heat.number}`,
          onclick: async (e: Event) => {
            const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Claiming");
            try {
              await api.post(`/api/stations/${station.id}/claim`, {});
              announce(region, `You are working ${station.name} in heat ${heat.number}.`);
            } catch (err) {
              announce(region, errorMessage(err));
            } finally {
              restore();
              await drawRota(eventId, body, region, false);
            }
          },
        }));
      }
      if (canAssign) {
        if (station.worker) {
          row.appendChild(h<HTMLButtonElement>("button", {
            class: "row-button",
            text: `Release ${station.name}, heat ${heat.number}`,
            onclick: async (e: Event) => {
              const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Releasing");
              try {
                await api.del(`/api/stations/${station.id}/claim`);
                announce(region, `${station.name} in heat ${heat.number} is open again.`);
              } catch (err) {
                announce(region, errorMessage(err));
              } finally {
                restore();
                await drawRota(eventId, body, region, false);
              }
            },
          }));
        } else {
          row.appendChild(h<HTMLButtonElement>("button", {
            class: "row-button",
            text: `Assign ${station.name}, heat ${heat.number}`,
            onclick: (e: Event) => { void openAssignDialog(heat, station, registrations, e.currentTarget as HTMLButtonElement, region, eventId, body); },
          }));
        }
      }
      rows.appendChild(row);
    }
    section.appendChild(rows);
    body.appendChild(section);
  }
  void myReg;
}

async function openAssignDialog(
  heat: RotaHeat,
  station: RotaHeat["stations"][number],
  registrations: RegistrationObj[],
  opener: HTMLButtonElement,
  region: HTMLElement,
  eventId: string,
  body: HTMLElement,
): Promise<void> {
  // Only drivers allowed that station: registered, not driving this heat, holding no station.
  const allowed = registrations
    .filter((r) => r.runHeat !== heat.number && !r.station)
    .sort((a, b) => a.driver.name.localeCompare(b.driver.name));

  const dialog = new Dialog("Assign worker", (dlg) => {
    const form = h("form", null) as HTMLFormElement;
    form.setAttribute("aria-label", "Assign worker");
    form.appendChild(h("h2", { text: "Assign worker" }));
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Driver");
    for (const reg of allowed) {
      const option = document.createElement("option");
      option.value = reg.id;
      option.textContent = `${reg.driver.name}, car ${reg.carNumber} ${reg.classCode}`;
      select.appendChild(option);
    }
    form.appendChild(select);
    const assign = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Assign" });
    const cancel = h<HTMLButtonElement>("button", { type: "button", text: "Cancel", onclick: () => dlg.close() });
    form.appendChild(h("div", { class: "actions" }, assign, cancel));
    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const restore = pendingButton(assign, "Assigning");
      try {
        const result = await api.post<{ registration: RegistrationObj }>(`/api/stations/${station.id}/assign`, { registrationId: select.value });
        const reg = allowed.find((r) => r.id === result.registration.id);
        announce(region, `${reg?.driver.name} is working ${station.name} in heat ${heat.number}.`);
        dlg.close();
        await drawRota(eventId, body, region, false);
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
