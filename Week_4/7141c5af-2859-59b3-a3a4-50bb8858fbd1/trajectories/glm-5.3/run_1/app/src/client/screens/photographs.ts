import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { withBusy } from "../app.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Photo = { id: string; number: number; side: string; sha256: string; bytes: number; state: string; createdAt: string };
type Piece = { title: string };

export async function installPhotographs(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let side: "before" | "after" = "before";
  const rowsEl = el(`<ul class="uploads" id="uploads" role="list" aria-label="Uploads"></ul>`);

  const load = async (): Promise<void> => {
    const [{ piece }, { photographs }] = await Promise.all([
      api<{ piece: Piece }>(`/api/pieces/${pieceId}`),
      api<{ photographs: Photo[] }>(`/api/pieces/${pieceId}/photographs`),
    ]);
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Photographs of ${piece.title}`;
    document.title = `Photographs of ${piece.title} — Semenza Desk`;
    root.innerHTML = `<div class="bento photos-grid">
      <div class="tile wide">
        <div id="uploads-holder"></div>
        <div class="ba-wrap" id="ba-wrap">
          <div class="ba-compare">
            <img id="ba-before" alt="Photograph before the work">
            <img id="ba-after" alt="Photograph after the work" class="ba-after">
          </div>
          <input type="range" min="0" max="100" value="50" id="ba-slider" aria-label="Before and after">
        </div>
      </div>
      ${mintTile(String(photographs.filter((p) => p.state === "stored").length), "stored files")}
    </div>`;
    const holder = qs("#uploads-holder", root)!;
    holder.append(rowsEl);
    const before = [...photographs].reverse().find((p) => p.side === "before" && p.state === "stored");
    const after = [...photographs].reverse().find((p) => p.side === "after" && p.state === "stored");
    const url = new URLSearchParams(location.search);
    const share = url.get("before");
    const slider = qs<HTMLInputElement>("#ba-slider", root)!;
    slider.value = share !== null ? String(Math.max(0, Math.min(100, Number(share)))) : "50";
    const beforeImg = qs<HTMLImageElement>("#ba-before", root)!;
    const afterImg = qs<HTMLImageElement>("#ba-after", root)!;
    if (before) beforeImg.src = `/api/pieces/${pieceId}/photographs/${before.id}/raw`;
    if (after) afterImg.src = `/api/pieces/${pieceId}/photographs/${after.id}/raw`;
    applyShare(Number(slider.value));
    slider.addEventListener("input", () => {
      applyShare(Number(slider.value));
      const url2 = new URLSearchParams(location.search);
      url2.set("before", slider.value);
      history.replaceState({}, "", `${location.pathname}?${url2}`);
    });
    function applyShare(v: number): void {
      slider.setAttribute("aria-valuetext", `${v}% before`);
      afterImg.style.clipPath = `inset(0 0 0 ${v}%)`;
    }
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="add-photos">Add photographs</button>`;
    qs("#add-photos", bar)!.addEventListener("click", () => {
      const input = el(`<input type="file" accept="image/png,image/jpeg" multiple hidden>`) as HTMLInputElement;
      document.body.append(input);
      input.addEventListener("change", () => {
        const files = [...(input.files ?? [])];
        for (const file of files) void uploadOne(file);
        input.remove();
      });
      input.click();
    });
  }

  const uploadOne = async (file: File): Promise<void> => {
    const row = el(`<li class="upload-row"><span class="upload-name">${file.name}</span> <span class="upload-state">Waiting</span> <button class="try-again" hidden>Try again</button></li>`);
    rowsEl.append(row);
    const stateSpan = row.querySelector(".upload-state")!;
    const tryAgain = row.querySelector<HTMLButtonElement>(".try-again")!;
    const attempt = async () => {
      stateSpan.textContent = "Sending";
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length > 8_000_000) {
          stateSpan.textContent = "This file is over 8,000,000 bytes.";
          return;
        }
        const form = new FormData();
        form.append("file", new Blob([bytes]), file.name);
        form.append("side", side);
        const res = await fetch(`/api/pieces/${pieceId}/photographs`, { method: "POST", body: form, credentials: "same-origin" });
        const data = await res.json() as { error?: { message?: string }; photograph?: Photo };
        if (!res.ok) {
          stateSpan.textContent = data.error?.message ?? "This file is not a PNG or JPEG.";
          return;
        }
        stateSpan.textContent = "Stored";
        announce(`${file.name} stored.`);
        tryAgain.hidden = true;
      } catch {
        stateSpan.textContent = "The file store is unavailable right now. Nothing was saved.";
        tryAgain.hidden = false;
      }
    };
    tryAgain.addEventListener("click", () => void attempt());
    await attempt();
  };

  const sideToggle = el(`<div class="side-toggle" role="radiogroup" aria-label="Side">
    <label><input type="radio" name="side" value="before" checked> Before</label>
    <label><input type="radio" name="side" value="after"> After</label>
  </div>`);
  root.prepend(sideToggle);
  qsa("input", sideToggle).forEach((radio) =>
    radio.addEventListener("change", () => {
      side = (radio as HTMLInputElement).value as "before" | "after";
    })
  );

  await load();
  autoRefresh(load);
  void motion;
  void ApiFail;
}
