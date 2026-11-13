import { el, api } from "./dom.js";
import { announce } from "./motion.js";
import { clearProblems, problemsRegion } from "./dialogs.js";
import { zoneFor, cityFor } from "./zones.js";
import { DateTime } from "luxon";

type VisitData = {
  memberName: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  isDrawDay: boolean;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string } | null;
  gateNotes: string | null;
  kitCodes: string[];
  state: string;
  collectedAt: string | null;
  endsAt: string;
};

export async function visitPage(token: string): Promise<HTMLElement> {
  const main = el("main", { class: "page visit-page" });
  const result = await api<VisitData>(`/api/visits/${token}`);

  const bottomBar = el("div", { class: "bottom-bar visit-bar" });

  if (!result.ok) {
    if (result.status === 410) {
      main.append(el("h1", { class: "page-title" }, "This visit page has ended."));
      bottomBar.replaceChildren();
      return el("div", { class: "screen" }, main, bottomBar);
    }
    main.append(el("h1", { class: "page-title" }, "We can't find that page."));
    main.append(el("p", { class: "card-copy" }, "Check the address you were sent."));
    bottomBar.replaceChildren();
    return el("div", { class: "screen" }, main, bottomBar);
  }

  const visit = result.data;
  const zone = zoneFor(visit.timeZone);
  const city = cityFor(visit.timeZone);

  main.append(el("h1", { class: "page-title" }, `Visit for ${visit.memberName}`));
  main.append(
    el(
      "p",
      { class: "visit-time" },
      `Draw on ${DateTime.fromISO(visit.localDate).toFormat("ccc dd MMM yyyy")}, ${visit.localTime} ${city} time`
    )
  );

  const addressCard = el("section", { class: "card", role: "region", "aria-label": "Address" });
  if (visit.isDrawDay && visit.address) {
    const lines = [visit.address.line1, visit.address.line2, `${visit.address.city} ${visit.address.state} ${visit.address.postalCode}`].filter((line) => line.trim().length > 0);
    for (const line of lines) addressCard.append(el("p", { class: "card-copy" }, line));
    if (visit.gateNotes) {
      addressCard.append(el("h2", { class: "card-title" }, "Gate notes"));
      addressCard.append(el("p", { class: "card-copy" }, visit.gateNotes));
    }
  } else {
    addressCard.append(el("p", { class: "card-copy" }, "Address shown on the visit day."));
  }
  main.append(addressCard);

  const kitForm = el("form", { class: "form visit-kit", novalidate: true });
  const kitInput = el("input", { type: "text", id: "kitCode", class: "input", "aria-label": "Kit code", placeholder: "KT-1000042-7", autocomplete: "off" });
  const add = el("button", { type: "button", class: "button" }, "Add kit code");
  const list = el("ul", { class: "kit-list", "aria-label": "Kit codes" });
  const renderList = (codes: string[]) => {
    list.replaceChildren(...codes.map((code) => el("li", { class: "kit-item" }, code)));
  };
  renderList(visit.kitCodes);

  const submitKit = async (): Promise<void> => {
    const raw = (kitInput as HTMLInputElement).value;
    if (raw.trim().length === 0) return;
    add.setAttribute("disabled", "");
    const response = await api<{ kitCodes: string[] }>(`/api/visits/${token}/kit-codes`, {
      method: "POST",
      body: JSON.stringify({ kitCode: raw }),
    });
    add.removeAttribute("disabled");
    if (response.ok) {
      (kitInput as HTMLInputElement).value = "";
      renderList(response.data.kitCodes);
      announce(`Kit code ${response.data.kitCodes[response.data.kitCodes.length - 1] ?? ""} added.`);
      clearProblems();
      return;
    }
    announce(response.message || "Something went wrong.");
    problemsRegion(response.fields ?? { kitCode: response.message }, false);
  };
  add.addEventListener("click", () => void submitKit());
  kitInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitKit();
    }
  });
  kitForm.append(kitInput, add, list);
  main.append(kitForm);

  const markCollected = el("button", { type: "button", class: "button primary visit-collect" }, "Mark collected");
  markCollected.addEventListener("click", async () => {
    markCollected.setAttribute("disabled", "");
    const response = await api<{ collectedAt: string }>(`/api/visits/${token}/collect`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    markCollected.removeAttribute("disabled");
    if (response.ok) {
      const collected = DateTime.fromISO(response.data.collectedAt, { zone }).toFormat("HH:mm");
      announce(`Marked collected at ${collected} ${city} time.`);
      markCollected.setAttribute("disabled", "");
      markCollected.textContent = "Marked collected";
      return;
    }
    announce(response.message || "Something went wrong.");
    problemsRegion({ collected: response.message }, false);
  });
  bottomBar.append(markCollected);
  return el("div", { class: "screen" }, main, bottomBar);
}
