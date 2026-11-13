import { api, navigate, state, clear, appEl, el, ApiFailure } from "../app.js";
import type { Tournament } from "../../shared/types.js";

export async function renderTournamentList(): Promise<() => void> {
  document.title = "Your tournaments · Cupfold";
  const app = appEl();
  clear(app);
  if (!state.username) {
    navigate(`/signin?next=${encodeURIComponent(location.pathname)}`, true);
    return () => {};
  }
  const data = await api<{ tournaments: Tournament[] }>("GET", "/api/tournaments");
  const items = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Your tournaments" } });
  if (data.tournaments.length === 0) {
    app.appendChild(
      el("main", { class: "page stack" }, [
        el("h1", {}, ["Your tournaments"]),
        el("p", { class: "muted" }, ["No tournaments yet."]),
        el("a", { href: "/t/new", class: "btn" }, ["New tournament"]),
      ])
    );
    return () => {};
  }
  for (const t of data.tournaments) {
    items.appendChild(el("li", {}, [el("a", { href: `/t/${t.id}` }, [t.name])]));
  }
  app.appendChild(
    el("main", { class: "page stack" }, [
      el("div", { class: "spread" }, [
        el("h1", {}, ["Your tournaments"]),
        el("a", { href: "/t/new", class: "btn" }, ["New tournament"]),
      ]),
      items,
    ])
  );
  return () => {};
}

export async function renderCreate(): Promise<() => void> {
  document.title = "New tournament · Cupfold";
  const app = appEl();
  clear(app);
  if (!state.username) {
    navigate(`/signin?next=${encodeURIComponent(location.pathname)}`, true);
    return () => {};
  }
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes("UTC")) zones.unshift("UTC");
  const nameInput = el("input", { id: "f-name", attrs: { name: "name" } }) as HTMLInputElement;
  const zoneSelect = el("select", { id: "f-zone", attrs: { name: "time_zone" } }) as HTMLSelectElement;
  for (const z of zones) {
    const o = document.createElement("option");
    o.value = z;
    o.textContent = z;
    if (z === "UTC") o.selected = true;
    zoneSelect.appendChild(o);
  }
  const formatHost = el("div", { attrs: { role: "radiogroup", "aria-label": "Format" } });
  let chosenFormat = "single_elimination";
  const formats: { value: string; label: string }[] = [
    { value: "single_elimination", label: "Single elimination" },
    { value: "double_elimination", label: "Double elimination" },
    { value: "round_robin", label: "Round robin" },
    { value: "swiss", label: "Swiss" },
  ];
  const drawFormats = (): void => {
    clear(formatHost);
    for (const f of formats) {
      const id = `fmt-${f.value}`;
      formatHost.appendChild(
        el("div", { class: "row" }, [
          el("input", {
            id,
            type: "radio",
            attrs: { name: "format", value: f.value, ...(f.value === chosenFormat ? { checked: "checked" } : {}) },
            on: { change: () => { chosenFormat = f.value; drawFormats(); } },
          }),
          el("label", { attrs: { for: id } }, [f.label]),
        ])
      );
    }
  };
  drawFormats();
  const fillHost = el("div", { attrs: { role: "radiogroup", "aria-label": "Trophy fill" } });
  let chosenFill = "lilac";
  const fills = [
    { value: "lilac", label: "Lilac" },
    { value: "lemon", label: "Lemon" },
    { value: "mint", label: "Mint" },
  ];
  const drawFills = (): void => {
    clear(fillHost);
    for (const f of fills) {
      const id = `fill-${f.value}`;
      fillHost.appendChild(
        el("div", { class: "row" }, [
          el("input", {
            id,
            type: "radio",
            attrs: { name: "fill", value: f.value, ...(f.value === chosenFill ? { checked: "checked" } : {}) },
            on: { change: () => { chosenFill = f.value; drawFills(); } },
          }),
          el("label", { attrs: { for: id } }, [f.label]),
        ])
      );
    }
  };
  drawFills();
  const errHost = el("div", {});
  const form = el("form", { class: "card stack", attrs: { style: "max-width:560px" } }, [
    el("h2", {}, ["New tournament"]),
    el("div", { class: "field" }, [
      el("label", { attrs: { for: "f-name" } }, ["Tournament name"]),
      nameInput,
    ]),
    el("div", { class: "field" }, [el("span", { class: "small muted" }, ["Format"]), formatHost]),
    el("div", { class: "field" }, [
      el("label", { attrs: { for: "f-zone" } }, ["Time zone"]),
      zoneSelect,
    ]),
    el("div", { class: "field" }, [el("span", { class: "small muted" }, ["Trophy fill"]), fillHost]),
    errHost,
    el("div", { class: "sheet-actions" }, [
      el("button", { class: "btn", type: "submit" }, ["Create tournament"]),
    ]),
  ]);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errHost.textContent = "";
    document.querySelectorAll(".field-error").forEach((n) => n.remove());
    try {
      const res = await api<{ tournament: Tournament }>("POST", "/api/tournaments", {
        name: nameInput.value,
        format: chosenFormat,
        time_zone: zoneSelect.value,
        fill: chosenFill,
      });
      navigate(`/t/${res.tournament.id}/setup`);
    } catch (e) {
      if (e instanceof ApiFailure) {
        for (const [key, message] of Object.entries(e.body.fields ?? {})) {
          const input = form.querySelector(`[name="${key}"]`) as HTMLInputElement | null;
          const wrap = input?.closest(".field");
          if (wrap) wrap.appendChild(el("p", { class: "field-error" }, [message]));
          else errHost.appendChild(el("p", { class: "field-error", attrs: { role: "alert" } }, [message]));
        }
      }
    }
  });
  app.appendChild(el("main", { class: "page" }, [form]));
  nameInput.focus();
  return () => {};
}
