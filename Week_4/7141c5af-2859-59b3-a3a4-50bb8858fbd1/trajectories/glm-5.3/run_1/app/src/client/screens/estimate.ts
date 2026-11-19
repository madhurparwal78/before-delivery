import { api, announce, el, qs, qsa, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Material = { code: string; name: string; family: string; unit: string };
type Lot = { lot: string; hides?: number; averageSqFt?: string; metres?: string };
type Estimate = {
  id: string; version: number; state: string; currency: string; materialCode: string | null; lot: string | null;
  patternAreaSqFt: string | null; hides: number | null; metres: string | null; labourHours: string;
  labourRateMinor: number; materialMinor: number; labourMinor: number; subtotalMinor: number; taxPercent: number; taxMinor: number; totalMinor: number;
  milestones: { percent: number; amountMinor: number }[]; display: Record<string, string>; createdAt: string;
};
type Piece = { title: string; clientId: string | null };

export async function installEstimate(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let materials: Material[] = [];
  let estimate: Estimate | null = null;

  const load = async (): Promise<void> => {
    const [{ piece }, mats, estimates] = await Promise.all([
      api<{ piece: Piece }>(`/api/pieces/${pieceId}`),
      api<{ materials: Material[] }>("/api/materials"),
      api<{ estimates: Estimate[] }>(`/api/pieces/${pieceId}/estimates`),
    ]);
    materials = mats.materials;
    estimate = estimates.estimates[0] ?? null;
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Estimate for ${piece.title}`;
    document.title = `Estimate for ${piece.title} — Semenza Desk`;
    render();
  };

  const render = (): void => {
    const e = estimate;
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <h2>The estimate</h2>
        ${e ? `
        <dl class="estimate-lines">
          <div><dt>Material</dt><dd>${e.display.material}</dd></div>
          <div><dt>Lot</dt><dd>${e.lot ?? ""}</dd></div>
          <div><dt>Hides</dt><dd>${e.hides ?? ""}</dd></div>
          <div><dt>Labour</dt><dd>${e.display.labour} (${e.labourHours} h)</dd></div>
          <div><dt>Subtotal</dt><dd>${e.display.subtotal}</dd></div>
          <div><dt>Tax</dt><dd>${e.display.tax} (${e.taxPercent}%)</dd></div>
          <div><dt>Total</dt><dd><strong data-part="estimate-total" id="estimate-total">${e.display.total}</strong></dd></div>
        </dl>
        <ol class="milestones">${e.milestones.map((m, i) => `<li>Stage ${i + 1} (${m.percent}%) — ${e!.display.milestones[i]}</li>`).join("")}</ol>`
        : `<p>No estimate yet.</p>`}
      </div>
      ${mintTile(e?.display.total ?? "—", "total")}
    </div>`;
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="edit-estimate">Edit estimate</button>`;
    qs("#edit-estimate", bar)!.addEventListener("click", async () => {
      const lots: Lot[] = [];
      let lotSelectHtml = "";
      let fieldHtml = "";
      const panel = dialogs.openDialog("Edit estimate", `
        <label>Material<select name="material" aria-label="Material"><option value="">None (frame only)</option>${materials.map((m) => `<option value="${m.code}" ${estimate?.materialCode === m.code ? "selected" : ""}>${m.name} ${m.code}</option>`).join("")}</select></label>
        <div id="lot-holder">${lotSelectHtml}</div>
        <div id="unit-holder">${fieldHtml}</div>
        <label>Labour hours<input name="labourHours" value="${estimate?.labourHours ?? ""}" inputmode="decimal"></label>`,
        async (form) => {
          const materialCode = (form.elements.namedItem("material") as HTMLSelectElement).value || null;
          const lotInput = form.elements.namedItem("lot") as HTMLSelectElement | null;
          const areaInput = form.elements.namedItem("patternArea") as HTMLInputElement | null;
          const metresInput = form.elements.namedItem("metres") as HTMLInputElement | null;
          const labourHours = (form.elements.namedItem("labourHours") as HTMLInputElement).value;
          const json: Record<string, unknown> = { materialCode, lot: lotInput?.value ?? null, labourHours, openVersion: estimate?.version };
          if (areaInput?.value) json.patternAreaSqFt = areaInput.value;
          if (metresInput?.value) json.metres = metresInput.value;
          const res = await api<{ estimate: Estimate }>(`/api/pieces/${pieceId}/estimates`, { method: "POST", json });
          announce("Estimate saved.");
          dialogs.closeDialog();
          estimate = res.estimate;
          render();
        }
      );
      const materialSelect = panel.querySelector<HTMLSelectElement>("[name=material]")!;
      const lotHolder = panel.querySelector("#lot-holder")!;
      const unitHolder = panel.querySelector("#unit-holder")!;
      const refreshLots = async () => {
        const code = materialSelect.value;
        lotHolder.innerHTML = "";
        unitHolder.innerHTML = "";
        if (!code) return;
        try {
          const res = await api<{ lots: Lot[] }>(`/api/materials/${code}/lots`);
          lotHolder.innerHTML = `<label>Lot<select name="lot">${res.lots.map((l) => `<option value="${l.lot}">${l.lot}, ${l.hides !== undefined ? `${l.hides === 1 ? "1 hide" : `${l.hides} hides`} at ${l.averageSqFt} sq ft` : `${l.metres} m`}</option>`).join("")}</select></label>`;
          const material = materials.find((m) => m.code === code)!;
          unitHolder.innerHTML = material.unit === "sqFt"
            ? `<label>Pattern area in sq ft<input name="patternArea" inputmode="decimal" value="14.54"></label>`
            : `<label>Metres<input name="metres" inputmode="decimal"></label>`;
        } catch (err) {
          if (err instanceof ApiFail) announce(err.message);
        }
      };
      materialSelect.addEventListener("change", () => void refreshLots());
      await refreshLots();
    });
  }

  await load();
  autoRefresh(load);
  void el;
  void qsa;
}
