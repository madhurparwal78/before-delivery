import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { withBusy } from "../app.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Material = { code: string; name: string; family: string; unit: string; prices: Record<string, string> };
type Lot = { lot: string; hides?: number; averageSqFt?: string; metres?: string };
type Piece = { id: string; title: string; state: string };

const lotLabel = (l: Lot): string =>
  l.metres !== undefined ? `${l.lot}, ${l.metres} m` : `${l.lot}, ${l.hides === 1 ? "1 hide" : `${l.hides} hides`} at ${l.averageSqFt} sq ft`;

/** A dot-grain swatch: density follows the code's last digit; no leather colour. */
const swatch = (code: string): string => {
  const n = code.charCodeAt(code.length - 1) % 5;
  return `<svg viewBox="0 0 120 90" aria-hidden="true"><rect width="120" height="90" rx="10" fill="#e9e9e9"/>${Array.from({ length: 30 + n * 10 }, (_, i) => `<circle cx="${10 + ((i * 37) % 100)}" cy="${8 + ((i * 53) % 76)}" r="0.8" fill="#6f6f6f"/>`).join("")}</svg>`;
};

export async function libraryScreen(root: HTMLElement): Promise<void> {
  const compare: Material[] = [];
  let chosen: string | null = null;
  let stockHtml = `<p>No material chosen.</p>`;
  const drawing = el(`<div class="material-drawing" id="material-drawing">${swatch("VM-0000")}</div>`);

  const load = async (): Promise<void> => {
    const { materials } = await api<{ materials: Material[] }>("/api/materials");
    const byFamily = new Map<string, Material[]>();
    for (const m of materials) {
      if (!byFamily.has(m.family)) byFamily.set(m.family, []);
      byFamily.get(m.family)!.push(m);
    }
    const params = new URLSearchParams(location.search);
    const wanted = params.get("material");
    if (!chosen && wanted && materials.some((m) => m.code === wanted)) chosen = wanted;
    if (!chosen && materials.length) chosen = materials[0]!.code;
    root.innerHTML = `<div class="bento library-grid">
      <div class="tile wide swatch-tile">
        <h2 id="swatches-heading">Swatches</h2>
        <button id="refresh-library">Refresh library</button>
        ${[...byFamily.entries()].map(([family, mats]) => `
          <section class="swatch-family">
            <h3 class="sticky-heading">${family}</h3>
            <div role="radiogroup" aria-label="${family}">
              ${mats.map((m) => `<label class="swatch"><input type="radio" name="material" value="${m.code}" ${chosen === m.code ? "checked" : ""}><span class="swatch-box">${swatch(m.code)}<span class="swatch-name">${m.name} ${m.code}</span></span></label>`).join("")}
            </div>
          </section>`).join("")}
      </div>
      <div class="tile drawing-tile">
        <h2>The cover</h2>
        <div id="material-drawing-holder"></div>
        <div id="stock-region" class="region" role="region" aria-label="Stock">${stockHtml}</div>
        <button id="add-compare">Add to compare</button>
      </div>
      <div class="tile compare-tile">
        <div id="compare-tray" class="region" role="region" aria-label="Compare tray" hidden></div>
      </div>
      ${mintTile(priceOf(materials, chosen), "price per unit")}
    </div>`;
    const holder = qs("#material-drawing-holder", root)!;
    holder.append(drawing);
    drawing.innerHTML = swatch(chosen ?? "VM-0000");

    qsa("input[name=material]", root).forEach((radio) => {
      radio.addEventListener("change", () => {
        const code = (radio as HTMLInputElement).value;
        chosen = code;
        if (!motion.reduced) {
          motion.animate(drawing, { opacity: "1" }, { opacity: "0" }, 160, () => {
            drawing.innerHTML = swatch(code);
            motion.animate(drawing, { opacity: "0" }, { opacity: "1" }, 160);
          });
        } else {
          drawing.innerHTML = swatch(code);
        }
        const mint = qsa(".tile-mint p:first-child", root);
        if (mint.length) mint[0]!.textContent = priceOf(materials, code);
        void loadStock(code);
        const url = new URLSearchParams(location.search);
        url.set("material", code);
        history.replaceState({}, "", `/library?${url}`);
      });
    });

    qs("#refresh-library", root)!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      await withBusy(btn, async () => {
        const res = await api<{ count: number }>("/api/materials/refresh", { method: "POST", json: {} });
        announce(`Library refreshed: ${res.count} materials.`);
        await load();
      });
    });

    qs("#add-compare", root)!.addEventListener("click", () => {
      const material = materials.find((m) => m.code === chosen);
      if (!material) return;
      if (compare.length >= 4) {
        announce("The tray holds four. Take one out first.");
        return;
      }
      if (compare.some((m) => m.code === material.code)) return;
      compare.push(material);
      renderTray();
    });

    const renderTray = (): void => {
      const tray = qs("#compare-tray", root)!;
      tray.hidden = compare.length === 0;
      tray.innerHTML = compare
        .map((m) => `<div class="compare-member">${swatch(m.code)}<span>${m.name} ${m.code}</span><button data-code="${m.code}" class="take-out">Take out ${m.name} ${m.code}</button></div>`)
        .join("");
      qsa(".take-out", tray).forEach((btn) => {
        btn.addEventListener("click", () => {
          const code = btn.dataset.code!;
          const idx = compare.findIndex((m) => m.code === code);
          compare.splice(idx, 1);
          renderTray();
          const next = compare[idx] ?? compare[idx - 1];
          if (next) (qsa(".take-out", tray)[compare.indexOf(next)] as HTMLElement)?.focus();
          else qs("#swatches-heading", root)?.focus();
        });
      });
      if (compare.length && !motion.reduced) {
        motion.animate(tray, { transform: "translateY(12px)" }, { transform: "translateY(0)" }, 320);
      }
    };
    renderTray();
    await loadStock(chosen ?? "");
  };

  const loadStock = async (code: string): Promise<void> => {
    if (!code) return;
    try {
      const res = await api<{ lots: Lot[] }>(`/api/materials/${code}/lots`);
      stockHtml = `<ul>${res.lots.map((l) => `<li>${lotLabel(l)}</li>`).join("")}</ul>`;
      const region = qs("#stock-region", root);
      if (region) region.innerHTML = stockHtml;
    } catch (e) {
      if (e instanceof ApiFail && e.status === 503) {
        stockHtml = `<p>The supplier is unavailable right now. Nothing changed.</p>`;
        const region = qs("#stock-region", root);
        if (region) region.innerHTML = stockHtml;
      }
    }
  };

  await load();
  autoRefresh(async () => {
    // refresh data quietly
  });
  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="hold-lot">Hold a dye lot</button>`;
    qs("#hold-lot", bar)!.addEventListener("click", async () => {
      const pieces = await api<{ pieces: Piece[] }>("/api/pieces");
      const materials = await api<{ materials: Material[] }>("/api/materials");
      const material = materials.materials.find((m) => m.code === chosen);
      let lots: Lot[] = [];
      if (material) {
        try {
          lots = (await api<{ lots: Lot[] }>(`/api/materials/${material.code}/lots`)).lots;
        } catch {
          lots = [];
        }
      }
      dialogs.openDialog(
        "Hold a dye lot",
        `<label>Piece<select name="piece">${pieces.pieces.filter((p) => p.state !== "archived").map((p) => `<option value="${p.id}">${p.title}</option>`).join("")}</select></label>
         <fieldset><legend>Lot</legend>${lots.map((l, i) => `<label><input type="radio" name="lot" value="${l.lot}" ${i === 0 ? "checked" : ""}> ${lotLabel(l)}</label>`).join("") || "<p>No lots read.</p>"}</fieldset>
         <label>Quantity<input name="quantity" inputmode="decimal"></label>`,
        async (form) => {
          const quantity = (form.elements.namedItem("quantity") as HTMLInputElement).value;
          const pieceId = (form.elements.namedItem("piece") as HTMLSelectElement).value;
          const lot = (form.elements.namedItem("lot") as HTMLInputElement | null)?.value ?? "";
          const res = await api<{ hold: { endsOn: string; label: string } }>(`/api/pieces/${pieceId}/holds`, {
            method: "POST",
            json: { code: chosen, lot, quantity },
          });
          announce(res.hold.label);
          dialogs.closeDialog();
        }
      );
    });
  }
}

const priceOf = (materials: Material[], code: string | null): string => {
  const m = materials.find((x) => x.code === code);
  if (!m) return "";
  return `€${m.prices.eur}`;
};
