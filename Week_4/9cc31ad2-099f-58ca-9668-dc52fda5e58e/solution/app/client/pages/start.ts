import { acceptedNext } from "../../shared/rules";
import { get, send } from "../api";
import { h } from "../dom";
import { navigate, type PageContext } from "../router";
import { loadMe } from "../session";
import { renderShell } from "../shell";
import { carDrawing } from "../drawing";
import { outline, trackPath, tulip } from "../track";
import type { CatalogueCar } from "../types";

const AGE_ERROR = "Confirm you are 13 or older to play.";
const GUIDED_RACE = "/race?layout=saltflat-ring&mode=practice&event=guided-first-race";

export async function startPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Start racing";
  const main = renderShell(false, ["Age", "Car", "Start"]);
  const next = acceptedNext(ctx.url.searchParams.get("next"));
  const cars = (await get<{ cars: CatalogueCar[] }>("/v1/cars", ctx.signal)).data.cars.filter((car) => car.starter);

  const age = h("input", { type: "checkbox", id: "age", name: "age", "aria-describedby": "age-error" });
  const error = h("div", { id: "age-error", role: "alert", class: "field-error" });
  const start = h("button", { type: "submit", class: "primary" }, "Start racing");
  const radios = cars.map((car, i) => h("label", { class: "starter" },
    h("input", { type: "radio", name: "starter", value: car.carId, checked: i === 0, "aria-label": car.name }),
    carDrawing(car.carId, null),
    h("span", null, h("span", { class: "starter-name" }, car.name), h("span", { class: "label" }, `Class ${car.class}`)),
    h("span", { class: "fig" }, `PI ${car.pi}`)));
  const route = trackPath("saltflat-ring");
  const card = h("aside", { class: "map-card start-card", "aria-label": "Guided first race" },
    ...route.turns.map((turn, i) => {
      const glyph = tulip(turn);
      glyph.classList.add(["tl", "tr", "br"][i]);
      return glyph;
    }),
    h("div", { class: "map-card-body" },
      h("p", { class: "kicker" }, "Your first stage"),
      h("h2", null, "Guided first race"),
      h("p", null, "Saltflat Ring · one lap. Hold Up or W to drive, Left and Right to change lane, and collect the coins in your lane."),
      h("p", { class: "label" }, "Paid after the server replays your run")),
    outline("saltflat-ring", "Saltflat Ring"));

  const form = h("form", { class: "start", novalidate: true },
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Stage 01 · Sign on"), h("h1", null, "Start racing"))),
    h("p", null, "Pick a starter car and drive the guided first race. Your garage and coins are kept on the server."),
    h("label", { class: "check-row", for: "age" }, age, "I am 13 or older"),
    error,
    h("fieldset", { class: "starter-list", role: "radiogroup", "aria-label": "Starter car" },
      h("legend", { class: "label" }, "Starter car"), ...radios),
    h("div", null, start));
  main.append(h("div", { class: "start-layout" }, form, card));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (start.disabled) return;
    if (!age.checked) {
      error.textContent = AGE_ERROR;
      age.focus();
      return;
    }
    error.textContent = "";
    const chosen = form.querySelector<HTMLInputElement>("input[name=starter]:checked")?.value ?? cars[0].carId;
    start.disabled = true;
    start.textContent = "Starting…";
    const result = await send<{ playerId: string }>("POST", "/v1/guests", { ageConfirmed: true, starterCarId: chosen }).catch(() => null);
    if (!result || result.status !== 201) {
      start.disabled = false;
      start.textContent = "Start racing";
      return;
    }
    await loadMe();
    navigate(next ?? GUIDED_RACE);
  });
}
