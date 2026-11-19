import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Placement = { name: string; width: number; height: number; x?: number; y?: number; rotation?: number; state: "tray" | "placed" };
type Layout = { version: number; hide: { widthCm: number; heightCm: number; areaSqFt: string; flaws: { x: number; y: number; width: number; height: number }[] }; pieces: Placement[]; usedSqFt: string; usedPercent: string; changedAt: string };

const order = ["Seat", "Back", "Left side", "Right side", "Headrest"] as const;
type PieceName = (typeof order)[number];
const grainBound: Record<PieceName, boolean> = { Seat: true, Back: true, "Left side": true, "Right side": true, Headrest: false };
const rotations = (name: PieceName): number[] => (grainBound[name] ? [0, 180] : [0, 90, 180, 270]);
const steps = { Seat: [0, 180], Back: [0, 180], "Left side": [0, 180], "Right side": [0, 180], Headrest: [0, 90, 180, 270] } as Record<PieceName, number[]>;

const dots = (): string =>
  Array.from({ length: 60 }, (_, i) => `<circle cx="${5 + ((i * 37) % 190)}" cy="${5 + ((i * 53) % 230)}" r="0.4" fill="#c9c9c9"/>`).join("");

export async function installHide(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let layout: Layout | null = null;
  let chosen: PieceName = "Seat";
  let lifted: { name: PieceName; x: number; y: number; rotation: number; version: number } | null = null;
  let boxEls = new Map<string, HTMLElement>();

  const load = async (): Promise<void> => {
    const [{ piece }, data] = await Promise.all([
      api<{ piece: { title: string } }>(`/api/pieces/${pieceId}`),
      api<{ layout: Layout }>(`/api/pieces/${pieceId}/layout`),
    ]);
    const sameVersion = layout?.version === data.layout.version && JSON.stringify(layout?.pieces) === JSON.stringify(data.layout.pieces);
    layout = data.layout;
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Hide for ${piece.title}`;
    document.title = `Hide for ${piece.title} — Semenza Desk`;
    if (!sameVersion) render();
    else updateStates();
  };

  const render = (): void => {
    root.innerHTML = `<div class="bento hide-grid">
      <div class="tile hide-tile">
        <div id="hide" class="hide" data-part="hide" tabindex="0" role="group" aria-label="Hide">
          <svg viewBox="0 0 200 240" aria-hidden="true"><rect x="0" y="0" width="200" height="240" rx="8" fill="#efefef"/>
            ${(layout!.hide.flaws ?? []).map((f) => `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" fill="none" stroke="#8f8f8f" stroke-dasharray="2 2"/>`).join("")}
            ${dots()}
          </svg>
          <div id="piece-layer"></div>
        </div>
      </div>
      <div class="tile tray-tile">
        <div id="tray" class="region" role="region" aria-label="Tray"></div>
        <button id="clear-hide">Clear the hide</button>
      </div>
      <div class="tile figure-tile">
        <p data-part="hide-figure" id="hide-figure">Used ${layout!.usedSqFt} sq ft of 51.67 sq ft (${layout!.usedPercent}%)</p>
      </div>
      ${mintTile(`${layout!.usedSqFt} sq ft`, "used of one hide")}
      <div id="hide-controls-bar" class="bottom-controls" hidden></div>
    </div>`;
    boxEls = new Map();
    const layer = qs("#piece-layer", root)!;
    for (const piece of layout!.pieces) {
      const box = el(`<div class="pattern-piece" data-part="pattern-piece" data-piece="${piece.name}" data-state="${piece.state}"><span>${piece.name}</span></div>`);
      if (piece.state === "placed") {
        box.dataset.x = String(piece.x);
        box.dataset.y = String(piece.y);
        box.dataset.rotation = String(piece.rotation);
        positionBox(box, piece.x!, piece.y!, piece.rotation!);
      } else {
        qs("#tray", root)!.append(el(`<div class="tray-piece" data-piece="${piece.name}">${piece.name}</div>`));
      }
      layer.append(box);
      boxEls.set(piece.name, box);
    }
    (boxEls.get(chosen) as HTMLElement).dataset.chosen = "true";
    installKeys();
    installDrag();
    renderBar();
    qs("#clear-hide", root)!.addEventListener("click", () => {
      dialogs.openDialog("Clear the hide", "<p>Every placed piece goes back to the tray.</p>", async () => {
        await api(`/api/pieces/${pieceId}/layout`, { method: "POST", json: { version: layout!.version, placements: [] } });
        announce("Hide cleared.");
        dialogs.closeDialog();
        await load();
      });
    });
  };

  const updateStates = (): void => {
    const figure = qs("#hide-figure", root);
    if (figure) figure.textContent = `Used ${layout!.usedSqFt} sq ft of 51.67 sq ft (${layout!.usedPercent}%)`;
    for (const piece of layout!.pieces) {
      const box = boxEls.get(piece.name);
      if (!box) continue;
      if (piece.state === "placed") {
        box.dataset.state = "placed";
        if (box.dataset.x !== String(piece.x) || box.dataset.y !== String(piece.y) || box.dataset.rotation !== String(piece.rotation)) {
          box.dataset.x = String(piece.x);
          box.dataset.y = String(piece.y);
          box.dataset.rotation = String(piece.rotation);
          positionBox(box, piece.x!, piece.y!, piece.rotation!);
          if (!motion.reduced) motion.animate(box, {}, { left: `${piece.x}px`, top: `${piece.y}px` }, 320);
        }
      }
    }
  };

  function positionBox(box: HTMLElement, x: number, y: number, rotation: number): void {
    const piece = layout!.pieces.find((p) => p.name === box.dataset.piece)!;
    const [w, h] = rotation === 90 || rotation === 270 ? [piece.height, piece.width] : [piece.width, piece.height];
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    box.style.transform = `rotate(${rotation}deg)`;
    box.dataset.rotation = String(rotation);
  }

  const lift = (name: PieceName, fromTray: boolean): void => {
    const box = boxEls.get(name)!;
    lifted = { name, x: 0, y: 0, rotation: 0, version: layout!.version };
    box.dataset.state = "lifted";
    if (fromTray) {
      box.dataset.x = "0";
      box.dataset.y = "0";
      positionBox(box, 0, 0, 0);
      if (!motion.reduced) {
        const from = qs(`.tray-piece[data-piece="${name}"]`, root) as HTMLElement | null;
        if (from) {
          const r = from.getBoundingClientRect();
          box.style.left = `${r.left - (qs("#hide", root) as HTMLElement).getBoundingClientRect().left}px`;
          box.style.top = `${r.top - (qs("#hide", root) as HTMLElement).getBoundingClientRect().top}px`;
          motion.animate(box, {}, { left: "0px", top: "0px" }, 320);
        }
      }
    }
    announce(`${name} lifted. Arrow keys move it, Enter places it, Escape puts it back.`);
  };

  const step = async (dx: number, dy: number): Promise<void> => {
    if (!lifted) return;
    const box = boxEls.get(lifted.name)!;
    lifted.x += dx;
    lifted.y += dy;
    box.dataset.x = String(lifted.x);
    box.dataset.y = String(lifted.y);
    if (!motion.reduced) motion.animate(box, {}, { left: `${lifted.x}px`, top: `${lifted.y}px` }, 160);
    else positionBox(box, lifted.x, lifted.y, lifted.rotation);
  };

  const rotate = (): void => {
    if (!lifted) return;
    const list = steps[lifted.name]!;
    const idx = list.indexOf(lifted.rotation);
    lifted.rotation = list[(idx + 1) % list.length]!;
    const box = boxEls.get(lifted.name)!;
    box.dataset.rotation = String(lifted.rotation);
    if (!motion.reduced) motion.animate(box, {}, { transform: `rotate(${lifted.rotation}deg)` }, 320);
  };

  const putBack = (): void => {
    if (!lifted) return;
    const box = boxEls.get(lifted.name)!;
    const was = layout!.pieces.find((p) => p.name === lifted!.name)!;
    const home = (): void => {
      if (was.state === "placed") {
        box.dataset.state = "placed";
        positionBox(box, was.x!, was.y!, was.rotation!);
      } else {
        box.dataset.state = "tray";
        delete box.dataset.x;
        delete box.dataset.y;
        box.style.left = "";
        box.style.top = "";
        box.style.width = "";
        box.style.height = "";
      }
    };
    if (!motion.reduced) motion.animate(box, {}, {}, 320, home);
    else home();
    announce(`${lifted.name} put back.`);
    lifted = null;
  };

  const place = async (): Promise<void> => {
    if (!lifted) return;
    const current = lifted;
    try {
      const res = await api<{ layout: Layout }>(`/api/pieces/${pieceId}/layout/placements/${encodeURIComponent(current.name)}`, {
        method: "PUT",
        json: { x: current.x, y: current.y, rotation: current.rotation, version: current.version },
      });
      layout = res.layout;
      const box = boxEls.get(current.name)!;
      box.dataset.state = "placed";
      positionBox(box, current.x, current.y, current.rotation);
      lifted = null;
      announce(`${current.name} placed at ${current.x}, ${current.y} cm.`);
      const figure = qs("#hide-figure", root);
      if (figure) figure.textContent = `Used ${layout.usedSqFt} sq ft of 51.67 sq ft (${layout.usedPercent}%)`;
      const mint = qsa(".tile-mint .tile-figure", root)[0];
      if (mint) mint.textContent = `${layout.usedSqFt} sq ft`;
    } catch (e) {
      if (e instanceof ApiFail) {
        if (e.status === 412) {
          announce(e.message);
          await load();
          const box = boxEls.get(current.name)!;
          box.dataset.state = "lifted";
          lifted = { ...current, version: layout!.version };
        } else {
          announce(e.message);
        }
      }
    }
  };

  const installKeys = (): void => {
    const hide = qs("#hide", root)!;
    hide.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = order.indexOf(chosen);
        chosen = order[(idx + 1) % order.length]!;
        markChosen();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = order.indexOf(chosen);
        chosen = order[(idx - 1 + order.length) % order.length]!;
        markChosen();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (lifted) void place();
        else lift(chosen, layout!.pieces.find((p) => p.name === chosen)!.state === "tray");
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (lifted) putBack();
      } else if (e.key.toLowerCase() === "r") {
        if (lifted) rotate();
      } else if (e.key === "Delete") {
        if (lifted) {
          void sendToTray(lifted.name);
        }
      } else if (e.shiftKey && ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const [dx, dy] = e.key === "ArrowRight" ? [10, 0] : e.key === "ArrowLeft" ? [-10, 0] : e.key === "ArrowDown" ? [0, 10] : [0, -10];
        void step(dx, dy);
      } else if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const [dx, dy] = e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowDown" ? [0, 1] : [0, -1];
        void step(dx, dy);
      }
    });
    const markChosen = () => {
      for (const [name, box] of boxEls) {
        if (name === chosen) box.dataset.chosen = "true";
        else delete box.dataset.chosen;
      }
    };
    markChosen();
  };

  const sendToTray = async (name: PieceName): Promise<void> => {
    try {
      const res = await api<{ layout: Layout }>(`/api/pieces/${pieceId}/layout/placements/${encodeURIComponent(name)}?version=${layout!.version}`, { method: "DELETE" });
      layout = res.layout;
      lifted = null;
      render();
      announce(`${name} back in the tray.`);
    } catch (e) {
      if (e instanceof ApiFail) announce(e.message);
    }
  };

  const installDrag = (): void => {
    for (const [name, box] of boxEls) {
      const pieceName = name as PieceName;
      let dragging = false;
      let start = { x: 0, y: 0 };
      let origin = { x: 0, y: 0 };
      box.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse") return;
        dragging = true;
        const piece = layout!.pieces.find((p) => p.name === name)!;
        origin = { x: piece.state === "placed" ? piece.x! : 0, y: piece.state === "placed" ? piece.y! : 0 };
        if (!lifted || lifted.name !== name) lift(pieceName, piece.state === "tray");
        start = { x: e.clientX, y: e.clientY };
        box.setPointerCapture(e.pointerId);
      });
      box.addEventListener("pointermove", (e) => {
        if (!dragging || !lifted) return;
        const nx = Math.round(origin.x + (e.clientX - start.x) / pxPerCm());
        const ny = Math.round(origin.y + (e.clientY - start.y) / pxPerCm());
        lifted.x = nx;
        lifted.y = ny;
        box.dataset.x = String(nx);
        box.dataset.y = String(ny);
        positionBox(box, nx, ny, lifted.rotation);
      });
      box.addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        void place();
      });
      box.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && dragging) {
          dragging = false;
          putBack();
        }
      });
    }
  };

  const pxPerCm = (): number => (qs("#hide", root) as HTMLElement).clientWidth / layout!.hide.widthCm;

  const renderBar = (): void => {
    const bar = qs("#bottom-bar");
    if (!bar) return;
    bar.setAttribute("data-bar", "hide-controls");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Hide controls");
    bar.innerHTML = `
      ${order.map((n) => `<button data-choose="${n}">${n}</button>`).join("")}
      <button id="bar-lift">Lift</button><button id="bar-up">Up</button><button id="bar-down">Down</button>
      <button id="bar-left">Left</button><button id="bar-right">Right</button><button id="bar-rotate">Rotate</button>
      <button id="bar-place">Place</button><button id="bar-putback">Put back</button><button id="bar-tray">To tray</button>`;
    qsa("[data-choose]", bar).forEach((btn) =>
      btn.addEventListener("click", () => {
        chosen = btn.dataset.choose as PieceName;
        for (const [name, box] of boxEls) {
          if (name === chosen) box.dataset.chosen = "true";
          else delete box.dataset.chosen;
        }
      })
    );
    qs("#bar-lift", bar)!.addEventListener("click", () => lift(chosen, layout!.pieces.find((p) => p.name === chosen)!.state === "tray"));
    qs("#bar-up", bar)!.addEventListener("click", () => void step(0, -1));
    qs("#bar-down", bar)!.addEventListener("click", () => void step(0, 1));
    qs("#bar-left", bar)!.addEventListener("click", () => void step(-1, 0));
    qs("#bar-right", bar)!.addEventListener("click", () => void step(1, 0));
    qs("#bar-rotate", bar)!.addEventListener("click", () => rotate());
    qs("#bar-place", bar)!.addEventListener("click", () => void place());
    qs("#bar-putback", bar)!.addEventListener("click", () => putBack());
    qs("#bar-tray", bar)!.addEventListener("click", () => void sendToTray((lifted?.name ?? chosen) as PieceName));
  };

  await load();
  autoRefresh(load);
}
