// The operator screen: club workspaces and onboarding.
import { api, type ClubRow, type User } from "../api.js";
import { h, liveRegion, announce, errorMessage, errorFields, fixFieldsAlert, pendingButton } from "../ui.js";
import { state, shell } from "../client.js";

export async function renderOperator(): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Operator updates");
  content.appendChild(region);
  await shell(content);

  if (!state.user?.roles.includes("operator")) {
    const root = document.querySelector(".content") as HTMLElement;
    root.appendChild(h("p", { class: "dim", text: "This screen is for the founder operator." }));
    return;
  }

  const root = document.querySelector(".content") as HTMLElement;
  root.appendChild(h("h1", { text: "Club workspaces" }));

  const { clubs } = await api.get<{ clubs: ClubRow[] }>("/api/operator/clubs");

  const table = h("table", { class: "data", "aria-label": "Club workspaces" }) as HTMLTableElement;
  table.appendChild(h("thead", null, h("tr", null,
    h("th", { text: "Club" }),
    h("th", { text: "Time zone" }),
    h("th", { text: "Events" }),
    h("th", { text: "Drivers" }),
    h("th", { text: "Published" }),
    h("th", { text: "Last delivery failure" }),
  )));
  const tbody = h("tbody", null);
  for (const club of clubs) {
    const failure = club.lastDeliveryFailure
      ? `${cap(club.lastDeliveryFailure.service)} at ${club.lastDeliveryFailure.at} UTC`
      : "None";
    tbody.appendChild(h("tr", null,
      h("td", { text: club.name }),
      h("td", { text: club.timeZone }),
      h("td", { class: "mono", text: String(club.eventCount) }),
      h("td", { class: "mono", text: String(club.driverCount) }),
      h("td", { class: "mono", text: String(club.publishedCount) }),
      h("td", { text: failure }),
    ));
  }
  table.appendChild(tbody);
  root.appendChild(table);

  root.appendChild(h("div", { style: "height:20px" }));

  const form = h("form", { class: "panel" }) as HTMLFormElement;
  form.setAttribute("aria-label", "Onboard club");
  form.appendChild(h("h2", { text: "Onboard club" }));

  const fields: Record<string, HTMLElement> = {};
  const make = (label: string, key = label, type = "text"): HTMLInputElement => {
    const input = document.createElement("input");
    if (type !== "text") input.type = type;
    input.setAttribute("aria-label", label);
    fields[key] = input;
    form.appendChild(h("div", { class: "field" }, h("label", { text: label }), input));
    return input;
  };
  const slug = make("Club slug");
  const name = make("Club name");
  const timeZone = make("Time zone");
  const chairName = make("Chair name");
  const chairEmail = make("Chair email", "chair.email", "email");
  const chairPassword = make("Chair password", "chair.password", "password");
  const onboard = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Onboard club" });
  form.appendChild(onboard);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const restore = pendingButton(onboard, "Creating workspace");
    try {
      const result = await api.post<{ club: { name: string }; chair: { user: User } }>("/api/operator/clubs", {
        slug: slug.value,
        name: name.value,
        timeZone: timeZone.value,
        chair: { name: chairName.value, email: chairEmail.value, password: chairPassword.value },
      });
      announce(region, `Club ${result.club.name} is ready. ${chairName.value} can sign in now.`);
      await renderOperator();
    } catch (err) {
      announce(region, errorMessage(err));
      const fieldErrors = errorFields(err);
      if (Object.keys(fieldErrors).length > 0) {
        form.querySelector(".alert-fix")?.remove();
        form.insertBefore(fixFieldsAlert(fieldErrors, fields), form.firstChild);
      }
      restore();
    }
  });
  root.appendChild(form);
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
