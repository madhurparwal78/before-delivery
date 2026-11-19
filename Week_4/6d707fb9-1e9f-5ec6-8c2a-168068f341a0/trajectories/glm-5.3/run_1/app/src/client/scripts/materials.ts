// Materials: add, edit, reorder lines and legs, with Alt+Up/Alt+Down and stale-save copy.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { MODE_NAMES, UI } from "./copy.js";
import { floatingPanel, overlayClose, overlayOpen } from "./overlay.js";

interface Line {
  id: string;
  position: number;
  materialId: string;
  materialName: string;
  fabricWeightGsm: string | null;
  areaM2: string | null;
  massGrams: string;
  massShown: string;
  fibres: { name: string; sharePercent: string }[];
  tier1: { factory: string | null; town: string | null; country: string | null } | null;
  tier2: { factory: string | null; town: string | null; country: string | null } | null;
  tier3: { factory: string | null; town: string | null; country: string | null } | null;
  answeredFacts: { energyMjPerKg: string | null; waterLitresPerKg: string | null; fibreOrigin: string | null };
}

interface LegsOut {
  lines: Line[];
  version: number;
}

export function registerMaterialsScreen(ctx: RouteCtx): () => void {
  const styleId = location.pathname.split("/")[2];
  const main = ctx.main;
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  let headingDone = false;

  const list = el("ul", { class: "row-list" });
  const legsList = el("ul", { class: "row-list" });
  const addBtn = el("button", { class: "btn btn-primary" }, "Add material");
  const addLegBtn = el("button", { class: "btn" }, "Add leg");
  addBtn.addEventListener("click", () => void openLineDialog(addBtn, null));
  addLegBtn.addEventListener("click", () => void openLegDialog(addLegBtn));

  const timer = window.setInterval(() => void load(false), 5000);

  async function load(first: boolean): Promise<void> {
    try {
      const style = await api<{ name: string }>(`/api/styles/${styleId}`);
      const out = await api<LegsOut>(`/api/styles/${styleId}/lines`);
      const legs = (await api<{ legs: { id: string; mode: string; km: string }[]; version: number }>(`/api/styles/${styleId}`)).legs ?? [];
      refreshLine.hidden = true;
      if (!headingDone) {
        const h1 = el("h1", {}, `Materials for ${style.name}`);
        main.append(h1, refreshLine);
        headingDone = true;
      }
      render(out.lines, legs as { id: string; mode: string; km: string }[]);
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  function render(lines: Line[], legs: { id: string; mode: string; km: string }[]): void {
    list.textContent = "";
    legsList.textContent = "";
    for (const line of lines) {
      const li = el("li", { "data-line-id": line.id });
      li.setAttribute("role", "listitem");
      li.setAttribute("aria-label", line.materialName);
      const head = el("div", { class: "line-head" });
      head.append(
        el("strong", { class: "num" }, `${line.position}. ${line.materialName}`),
        el("span", { class: "num" }, `${line.massShown}`),
      );
      const fibresText = line.fibres.map((f) => `${f.name} ${f.sharePercent}%`).join(", ");
      const tiers: string[] = [];
      for (const t of [line.tier1, line.tier2, line.tier3]) {
        if (t) tiers.push(`${t.factory ?? ""} ${t.town ?? ""} ${t.country ?? ""}`.trim());
      }
      head.append(el("span", { class: "hint" }, `${fibresText}${tiers.length > 0 ? ` \u00B7 ${tiers.join(" \u00B7 ")}` : ""}`));
      const controls = el("div", { class: "line-controls" });
      const mk = (label: string, fn: () => void, disabled = false) => {
        const b = el("button", { class: "btn" }, label);
        if (disabled) b.setAttribute("aria-disabled", "true");
        else b.addEventListener("click", () => void fn());
        controls.append(b);
        return b;
      };
      const upBtn = mk("Move up", () => move(line.id, "up", upBtn), line.position === 1);
      const downBtn = mk("Move down", () => move(line.id, "down", downBtn), line.position === lines.length);
      mk("Edit", () => void openLineDialog(controls.children[2] as HTMLElement, line));
      mk("Remove", () => void removeLine(line));
      li.append(head, controls);
      li.addEventListener("keydown", (e) => {
        if (!e.altKey) return;
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (line.position > 1) void move(line.id, "up", document.activeElement as HTMLElement);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (line.position < lines.length) void move(line.id, "down", document.activeElement as HTMLElement);
        }
      });
      list.append(li);
    }
    for (const leg of legs) {
      const li = el("li", {});
      li.append(el("span", { class: "num" }, `${MODE_NAMES[leg.mode] ?? leg.mode} ${leg.km} km`));
      const remove = el("button", { class: "btn" }, "Remove leg");
      remove.addEventListener("click", () => void removeLeg(leg.id));
      li.append(remove);
      legsList.append(li);
    }
  }

  async function move(lineId: string, direction: "up" | "down", button: HTMLElement): Promise<void> {
    const out = await api<LegsOut>(`/api/styles/${styleId}/lines`);
    await withWorking(button, UI.working, async () => {
      try {
        const moved = await api<{ position: number; total: number; lines: Line[] }>(`/api/styles/${styleId}/lines/${lineId}/move`, {
          method: "POST",
          body: JSON.stringify({ direction, baseVersion: out.version }),
        });
        const line = moved.lines.find((l) => l.id === lineId);
        announce(UI.moved(line?.materialName ?? "", moved.position, moved.total));
        render(moved.lines, (await api<{ legs: { id: string; mode: string; km: string }[] }>(`/api/styles/${styleId}`)).legs ?? []);
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function removeLine(line: Line): Promise<void> {
    try {
      const out = await api<LegsOut>(`/api/styles/${styleId}/lines`);
      await api(`/api/styles/${styleId}/lines/${line.id}?baseVersion=${out.version}`, { method: "DELETE" });
      announce(UI.removed(line.materialName));
      await load(false);
    } catch (err) {
      const failure = err as { message?: string; status?: number };
      if (failure.status === 401) handleSessionEnd();
      else announce(failure.message ?? `Something went wrong.`);
    }
  }

  async function removeLeg(legId: string): Promise<void> {
    try {
      const style = await api<{ version: number; legs: { id: string; mode: string; km: string }[] }>(`/api/styles/${styleId}`);
      await api(`/api/styles/${styleId}/legs/${legId}?baseVersion=${style.version}`, { method: "DELETE" });
      announce(UI.legRemoved);
      await load(false);
    } catch (err) {
      announce((err as { message?: string }).message ?? `Something went wrong.`);
    }
  }

  async function openLineDialog(opener: HTMLElement, existing: Line | null): Promise<void> {
    const out = await api<LegsOut>(`/api/styles/${styleId}/lines`);
    const body = overlayOpen({ label: existing ? "Edit material" : "Add material", opener, sheet: window.innerWidth < 768 });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const problems = el("div", { class: "problems", role: "region", "aria-label": UI.problems, hidden: "true" });

    // The combobox over the published materials.
    const comboWrap = el("label", { class: "field" }, el("span", {}, "Material"));
    const combo = el("input", { type: "text", role: "combobox", "aria-label": "Material", "aria-expanded": "false", "aria-controls": "materials-list", "aria-autocomplete": "list" });
    if (existing) combo.value = existing.materialName;
    const listBox = el("div", { class: "listbox", id: "materials-list", role: "listbox", "aria-label": "Materials", hidden: "true" });
    let chosen = existing ? { id: existing.materialId, name: existing.materialName } : null;
    let activeIndex = -1;
    let listToken = 0;
    const runSearch = (): void => {
      const token = ++listToken;
      window.setTimeout(async () => {
        const q = combo.value.trim();
        const res = await api<{ materials: { id: string; name: string }[] }>(`/api/materials?q=${encodeURIComponent(q)}`);
        if (token !== listToken) return; // an answer to an earlier input is ignored
        listBox.textContent = "";
        const items = res.materials;
        for (let i = 0; i < items.length; i++) {
          const opt = el("div", { role: "option", "aria-selected": "false" }, items[i].name);
          opt.addEventListener("mousedown", (e) => {
            e.preventDefault();
            chosen = items[i];
            combo.value = items[i].name;
            listBox.hidden = true;
            combo.setAttribute("aria-expanded", "false");
          });
          listBox.append(opt);
        }
        activeIndex = -1;
        listBox.hidden = false;
        combo.setAttribute("aria-expanded", "true");
      }, 300);
    };
    combo.addEventListener("input", runSearch);
    combo.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const opts = [...listBox.querySelectorAll<HTMLElement>("[role='option']")];
        if (opts.length === 0) return;
        activeIndex = e.key === "ArrowDown" ? (activeIndex + 1) % opts.length : (activeIndex - 1 + opts.length) % opts.length;
        opts.forEach((o, i) => o.setAttribute("aria-selected", i === activeIndex ? "true" : "false"));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opts = [...listBox.querySelectorAll<HTMLElement>("[role='option']")];
        if (activeIndex >= 0 && opts[activeIndex]) {
          opts[activeIndex].dispatchEvent(new Event("mousedown"));
        }
      } else if (e.key === "Escape") {
        listBox.hidden = true;
        combo.setAttribute("aria-expanded", "false");
      }
    });
    comboWrap.append(combo, listBox);

    const how = el("fieldset", { role: "radiogroup", "aria-label": "How to give the mass" });
    how.append(el("legend", {}, "How to give the mass"));
    const gsm = el("input", { type: "text", "aria-label": "Fabric weight (g/m\u00B2)" });
    const area = el("input", { type: "text", "aria-label": "Area (m\u00B2)" });
    const mass = el("input", { type: "text", "aria-label": "Mass (g)" });
    if (existing) {
      if (existing.fabricWeightGsm) {
        gsm.value = existing.fabricWeightGsm;
        area.value = existing.areaM2 ?? "";
      } else {
        mass.value = existing.massGrams;
      }
    }
    const gsmLabel = el("label", { class: "radio" }, el("input", { type: "radio", name: "masshow", value: "weight" }), "Fabric weight and area");
    const massLabel = el("label", { class: "radio" }, el("input", { type: "radio", name: "masshow", value: "mass" }), "Plain mass");
    if (existing && existing.fabricWeightGsm) (gsmLabel.firstChild as HTMLInputElement).checked = true;
    else (massLabel.firstChild as HTMLInputElement).checked = true;
    how.append(gsmLabel, massLabel);
    const gsmField = el("label", { class: "field" }, el("span", {}, "Fabric weight (g/m\u00B2)"));
    gsmField.append(gsm);
    const areaField = el("label", { class: "field" }, el("span", {}, "Area (m\u00B2)"));
    areaField.append(area);
    const massField = el("label", { class: "field" }, el("span", {}, "Mass (g)"));
    massField.append(mass);

    const fibresWrap = el("div", { class: "field" });
    fibresWrap.append(el("span", {}, "Fibres"));
    const fibreRows: HTMLElement[] = [];
    const addFibreRow = (name = "", share = ""): void => {
      const row = el("div", { class: "row-controls" });
      const nameI = el("input", { type: "text", "aria-label": `Fibre ${fibreRows.length + 1} name` });
      nameI.value = name;
      const shareI = el("input", { type: "text", "aria-label": `Fibre ${fibreRows.length + 1} share (%)` });
      shareI.value = share;
      row.append(nameI, shareI);
      fibreRows.push(row);
      fibresWrap.append(row);
    };
    if (existing) {
      for (const f of existing.fibres) addFibreRow(f.name, f.sharePercent);
    } else {
      addFibreRow();
    }
    const addFibreBtn = el("button", { class: "btn", type: "button" }, "Add fibre");
    addFibreBtn.addEventListener("click", () => addFibreRow());
    fibresWrap.append(addFibreBtn);

    const tierFields: Record<string, { factory: HTMLInputElement; town: HTMLInputElement; country: HTMLSelectElement }> = {};
    const tierSection = el("div");
    for (const n of [1, 2, 3] as const) {
      const existingTier = existing?.[`tier${n}` as const] ?? null;
      const factory = el("input", { type: "text", "aria-label": `Tier ${n} factory` });
      factory.value = existingTier?.factory ?? "";
      const town = el("input", { type: "text", "aria-label": `Tier ${n} town` });
      town.value = existingTier?.town ?? "";
      const country = el("select", { "aria-label": `Tier ${n} country` });
      country.append(el("option", { value: "" }, "Not known yet"));
      for (const [code, cname] of [["PT", "Portugal"], ["TR", "Turkey"], ["VN", "Vietnam"], ["EG", "Egypt"], ["IN", "India"], ["BD", "Bangladesh"]] as [string, string][]) {
        const opt = el("option", { value: code }, cname);
        if (existingTier?.country === code) opt.selected = true;
        country.append(opt);
      }
      tierFields[`tier${n}`] = { factory, town, country };
      tierSection.append(
        el("label", { class: "field" }, el("span", {}, `Tier ${n} factory`), factory),
        el("label", { class: "field" }, el("span", {}, `Tier ${n} town`), town),
        el("label", { class: "field" }, el("span", {}, `Tier ${n} country`), country),
      );
    }

    const save = el("button", { class: "btn btn-primary" }, "Save material");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(problems, comboWrap, how, gsmField, areaField, massField, fibresWrap, tierSection, el("div", { class: "dialog-foot" }, save, close));

    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        const useWeight = (gsmLabel.firstChild as HTMLInputElement).checked;
        const payload: Record<string, unknown> = {
          materialId: chosen?.id ?? existing?.materialId,
          baseVersion: out.version,
        };
        if (useWeight) {
          payload.fabricWeightGsm = gsm.value;
          payload.areaM2 = area.value;
        } else {
          payload.massGrams = mass.value;
        }
        const fibres: { name: string; sharePercent: string }[] = [];
        for (const row of fibreRows) {
          const nameI = row.children[0] as HTMLInputElement;
          const shareI = row.children[1] as HTMLInputElement;
          if (nameI.value.length > 0) fibres.push({ name: nameI.value, sharePercent: shareI.value });
        }
        payload.fibres = fibres;
        for (const n of [1, 2, 3] as const) {
          const t = tierFields[`tier${n}`];
          const empty = t.factory.value === "" && t.town.value === "" && t.country.value === "";
          payload[`tier${n}`] = empty ? null : { factory: t.factory.value || null, town: t.town.value || null, country: t.country.value || null };
        }
        try {
          if (existing) {
            const saved = await api<Line>(`/api/styles/${styleId}/lines/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
            announce(UI.saved(saved.materialName));
          } else {
            const saved = await api<Line>(`/api/styles/${styleId}/lines`, { method: "POST", body: JSON.stringify(payload) });
            announce(UI.added(saved.materialName));
          }
          overlayClose(dialog, opener);
          await load(false);
        } catch (err) {
          const failure = err as { message?: string; fields?: Record<string, string>; status?: number };
          if (failure.status === 401) {
            handleSessionEnd();
            return;
          }
          problems.hidden = false;
          problems.textContent = "";
          problems.append(el("p", {}, failure.message ?? `Give a value here.`));
          problems.focus?.();
        }
      });
    });
  }

  async function openLegDialog(opener: HTMLElement): Promise<void> {
    const style = await api<{ version: number }>(`/api/styles/${styleId}`);
    const body = overlayOpen({ label: "Add leg", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const mode = el("select", { "aria-label": "Mode" });
    for (const [id, name] of [["sea", "Sea"], ["road", "Road"], ["rail", "Rail"], ["air", "Air"]] as [string, string][]) {
      mode.append(el("option", { value: id }, name));
    }
    const km = el("input", { type: "text", "aria-label": "Distance (km)" });
    const save = el("button", { class: "btn btn-primary" }, "Save leg");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(
      el("label", { class: "field" }, el("span", {}, "Mode"), mode),
      el("label", { class: "field" }, el("span", {}, "Distance (km)"), km),
      el("div", { class: "dialog-foot" }, save, close),
    );
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          await api(`/api/styles/${styleId}/legs`, {
            method: "POST",
            body: JSON.stringify({ mode: mode.value, km: km.value, baseVersion: style.version }),
          });
          announce(UI.legAdded);
          overlayClose(dialog, opener);
          await load(false);
        } catch (err) {
          announce((err as { message?: string }).message ?? `Something went wrong.`);
        }
      });
    });
  }

  const bar = el("div", { class: "bottom-bar" });
  bar.append(addBtn.cloneNode(true));
  main.append(list, el("h2", {}, "Transport legs"), legsList, addBtn, addLegBtn, bar);
  void load(true);

  return () => window.clearInterval(timer);
}
