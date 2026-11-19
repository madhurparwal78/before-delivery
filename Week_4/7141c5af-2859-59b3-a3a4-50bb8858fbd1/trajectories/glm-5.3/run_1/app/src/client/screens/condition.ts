import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { withBusy } from "../app.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Pin = { id: string; number: number; x: number; y: number; kind: string; note: string; signed: boolean };
type Piece = { title: string };

const kinds: [string, string][] = [
  ["Tear", "tear"], ["Crack", "crack"], ["Stain", "stain"], ["Loose joint", "looseJoint"], ["Woodworm", "woodworm"],
];
const kindName = (k: string): string => kinds.find(([en, v]) => v === k)?.[0] ?? k;

export async function installCondition(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let pins: Pin[] = [];
  let piece: Piece | null = null;
  let crosshair: { x: number; y: number } | null = null;
  let focusPinIndex = -1;

  const load = async (): Promise<void> => {
    const [{ piece: p }, { pins: next }] = await Promise.all([
      api<{ piece: Piece }>(`/api/pieces/${pieceId}`),
      api<{ pins: Pin[] }>(`/api/pieces/${pieceId}/pins`),
    ]);
    piece = p;
    pins = next;
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Condition of ${p.title}`;
    document.title = `Condition of ${p.title} — Semenza Desk`;
    render();
  };

  const mapEl = (): HTMLElement => root.querySelector("#condition-map")!;

  const render = (): void => {
    root.innerHTML = `<div class="bento condition-grid">
      <div class="tile map-tile">
        <div id="condition-map" class="condition-map" data-part="condition-map" role="group" aria-label="Condition map" tabindex="0">
          <svg viewBox="0 0 320 240" aria-hidden="true"><rect width="320" height="240" rx="14" fill="#f4f4f4"/>${dots()}</svg>
          <div class="pin-layer" id="pin-layer"></div>
        </div>
        <ul class="pin-list" id="pin-list"></ul>
      </div>
      ${mintTile(String(pins.length), "pins")}
    </div>`;
    const map = mapEl();
    const layer = qs("#pin-layer", map)!;
    const reading = [...pins].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const pin of reading) {
      const btn = el(`<button class="pin" data-part="pin" data-x="${pin.x}" data-y="${pin.y}" data-id="${pin.id}" style="left:${pin.x}%;top:${pin.y}%"><span class="pin-dot"></span><span class="sr-only">Pin ${pin.number}: ${kindName(pin.kind)}</span><span aria-hidden="true">${pin.number}</span></button>`);
      btn.setAttribute("aria-label", `Pin ${pin.number}: ${kindName(pin.kind)}`);
      layer.append(btn);
    }
    const composite = qsa(".pin", layer);
    composite.forEach((btn, i) => {
      btn.addEventListener("keydown", (e) => {
        const target = e.currentTarget as HTMLElement;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          (composite[(i + 1) % composite.length] as HTMLElement).focus();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          (composite[(i - 1 + composite.length) % composite.length] as HTMLElement).focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPopover(target);
        }
      });
      btn.addEventListener("click", () => openPopover(btn));
    });
    map.addEventListener("keydown", (e) => {
      if (document.activeElement === map && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
        (composite[0] as HTMLElement | undefined)?.focus();
      }
    });
    map.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && (e.target as HTMLElement).closest(".pin")) return;
      const rect = map.getBoundingClientRect();
      const x = clamp(((e.clientX - rect.left) / rect.width) * 100);
      const y = clamp(((e.clientY - rect.top) / rect.height) * 100);
      void placePin(x, y);
    });
    const list = qs("#pin-list", root)!;
    for (const pin of reading) {
      list.append(el(`<li><button data-id="${pin.id}">Pin ${pin.number}: ${kindName(pin.kind)} at ${pin.x}, ${pin.y}</button></li>`));
    }
    qsa("button", list).forEach((btn) =>
      btn.addEventListener("click", () => {
        const pinEl = qsa(".pin", layer).find((p) => p.dataset.id === btn.dataset.id);
        pinEl?.focus();
        if (pinEl) openPopover(pinEl);
      })
    );
    void focusPinIndex;
  };

  const clamp = (v: number): number => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

  const placePin = async (x: number, y: number): Promise<void> => {
    const panel = dialogs.openDialog(
      "Pin",
      `<label>Kind<select name="kind" aria-label="Kind">${kinds.map(([en, v]) => `<option value="${v}">${en}</option>`).join("")}</select></label>
       <label>Note<textarea name="note"></textarea></label>
       <label>Signed note<input type="checkbox" name="signed"></label>`,
      async (form) => {
        const res = await api<{ pin: Pin }>(`/api/pieces/${pieceId}/pins`, {
          method: "POST",
          json: { x, y, kind: (form.elements.namedItem("kind") as HTMLSelectElement).value, note: (form.elements.namedItem("note") as HTMLTextAreaElement).value, signed: (form.elements.namedItem("signed") as HTMLInputElement).checked },
        });
        announce(`Pin placed at ${x}, ${y}.`);
        dialogs.closeDialog();
        await load();
        const map = mapEl();
        const newest = qsa(".pin", map).find((p) => p.dataset.id === res.pin.id);
        newest?.focus();
      }
    );
    void panel;
  };

  const openPopover = (pinEl: HTMLElement): void => {
    const existing = qs("#pin-popover");
    existing?.remove();
    const pin = pins.find((p) => p.id === pinEl.dataset.id);
    if (!pin) return;
    const popover = el(`<div id="pin-popover" class="pin-popover" role="dialog" aria-label="Pin ${pin.number}">
      <p>${escapeHtml(pin.note)}</p>
      <button class="remove-pin">Remove pin</button>
    </div>`);
    const map = mapEl();
    map.append(popover);
    const mapRect = map.getBoundingClientRect();
    const width = 220;
    const left = Math.min(Math.max(0, (pin.x / 100) * mapRect.width - width / 2), mapRect.width - width);
    const top = Math.min(Math.max(0, (pin.y / 100) * mapRect.height + 16), mapRect.height - 110);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    if (!motion.reduced) motion.animate(popover, { opacity: "0" }, { opacity: "1" }, 160);
    const close = (returnFocus = true) => {
      popover.remove();
      document.removeEventListener("click", onDoc, true);
      if (returnFocus) pinEl.focus();
    };
    const onDoc = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== pinEl) close();
    };
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
    popover.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    });
    const remove = popover.querySelector<HTMLButtonElement>(".remove-pin")!;
    remove.addEventListener("click", async () => {
      await withBusy(remove, async () => {
        await api(`/api/pieces/${pieceId}/pins/${pin.id}`, { method: "DELETE" });
        announce("Pin removed.");
        close(false);
        const indexBefore = qsa(".pin", mapEl()).findIndex((p) => p.dataset.id === pin.id);
        await load();
        const remaining = qsa(".pin", mapEl());
        (remaining[indexBefore] as HTMLElement | undefined)?.focus();
        if (!remaining.length) qs("#add-pin", root)?.focus();
      });
    });
    remove.focus();
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="add-pin">Add a pin</button>`;
    qs("#add-pin", bar)!.addEventListener("click", () => {
      crosshair = { x: 50, y: 50 };
      const map = mapEl();
      let cross = qs("#crosshair", map);
      if (!cross) {
        cross = el(`<div id="crosshair" data-part="crosshair" data-x="50.0" data-y="50.0" class="crosshair"></div>`);
        map.append(cross);
      }
      cross.style.left = "50%";
      cross.style.top = "50%";
      (cross as HTMLElement).dataset.x = "50.0";
      (cross as HTMLElement).dataset.y = "50.0";
      const move = (dx: number, dy: number) => {
        crosshair = { x: clamp(crosshair!.x + dx), y: clamp(crosshair!.y + dy) };
        (cross as HTMLElement).style.left = `${crosshair.x}%`;
        (cross as HTMLElement).style.top = `${crosshair.y}%`;
        (cross as HTMLElement).dataset.x = crosshair.x.toFixed(1);
        (cross as HTMLElement).dataset.y = crosshair.y.toFixed(1);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); move(-1, 0); }
        else if (e.key === "ArrowRight") { e.preventDefault(); move(1, 0); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(0, -1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); move(0, 1); }
        else if (e.key === "Enter") {
          e.preventDefault();
          cleanup();
          void placePin(crosshair!.x, crosshair!.y);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cleanup();
          (cross as HTMLElement).remove();
        } else if (e.key === "Tab" && e.shiftKey) { move(-10, 0); }
      };
      const cleanup = () => document.removeEventListener("keydown", onKey, true);
      document.addEventListener("keydown", onKey, true);
      cross.focus();
    });
  }

  await load();
  autoRefresh(load);
}

const dots = (): string =>
  Array.from({ length: 40 }, (_, i) => `<circle cx="${10 + ((i * 37) % 300)}" cy="${8 + ((i * 53) % 224)}" r="0.5" fill="#c4c4c4"/>`).join("");

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
