import { api, announce, el, qs, qsa, motion, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Dossier = { id: string; state: string; message: string | null; signedBy: string | null; signedAt: string | null; history: { at: string; who: string; what: string }[] };
type Piece = { title: string };

const steps = [
  { key: "waiting", label: "Waiting" },
  { key: "rendering", label: "Rendering" },
  { key: "stored", label: "Stored" },
];
const sections = [
  ["01 The piece", "the-piece"], ["02 Condition", "condition"], ["03 Materials", "materials"],
  ["04 Photographs", "photographs"], ["05 Care card", "care-card"], ["06 History", "history"],
];

export async function installDossier(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let dossier: Dossier | null = null;
  let drawn: Record<string, boolean> = {};
  let openedWith: Record<string, boolean> = {};

  const load = async (): Promise<void> => {
    const { piece } = await api<{ piece: Piece }>(`/api/pieces/${pieceId}`);
    try {
      const res = await api<{ dossier: Dossier }>(`/api/pieces/${pieceId}/dossier`);
      dossier = res.dossier;
    } catch (e) {
      if (e instanceof ApiFail && e.status === 404) dossier = null;
      else if (e instanceof ApiFail) throw e;
    }
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Dossier for ${piece.title}`;
    document.title = `Dossier for ${piece.title} — Semenza Desk`;
    render();
  };

  const render = (): void => {
    const state = dossier?.state ?? "none";
    root.innerHTML = `<div class="bento dossier-grid">
      <div class="tile wide">
        <ol id="dossier-steps" class="dossier-steps" aria-label="Dossier steps">
          ${steps.map((s, i) => {
            const done = stateOrder(state) > i;
            const current = stateOrder(state) === i;
            return `<li data-part="dossier-step" data-state="${done ? "done" : current ? "current" : "pending"}">${s.label}${done ? `<span data-part="step-check" class="step-check">✓</span>` : ""}</li>`;
          }).join("")}
        </ol>
        <nav id="dossier-rail" class="sections-rail" aria-label="Sections">
          ${sections.map(([label, hash], i) => `<a href="#${hash}" class="rail-link"><span class="rail-number">${String(i + 1).padStart(2, "0")}</span> ${label}</a>`).join("")}
        </nav>
        <div class="dossier-body">
          <section id="the-piece"><h2>01 The piece</h2><p>The dossier holds the piece, its stamp, the signed pins, materials, photographs and the care card.</p></section>
          <section id="condition"><h2>02 Condition</h2><p>Signed condition pins print as a table.</p></section>
          <section id="materials"><h2>03 Materials</h2><p>The materials with their dye lot.</p></section>
          <section id="photographs"><h2>04 Photographs</h2><p>Before and after photographs.</p></section>
          <section id="care-card"><h2>05 Care card</h2><p>In the client's language.</p></section>
          <section id="history"><h2>06 History</h2>
            <ul id="dossier-history" class="dossier-history" aria-label="Dossier history">
              ${(dossier?.history ?? []).map((h) => `<li>${h.who} ${h.what} at ${h.at}</li>`).join("")}
            </ul>
          </section>
        </div>
        <div class="dossier-actions">
          ${dossier && (state === "stored" || state === "signed") ? `<a href="/api/pieces/${pieceId}/dossier/pdf" id="download-pdf">Download PDF</a>` : ""}
          ${dossier && state === "stored" ? `<button id="sign-dossier">Sign dossier</button>` : ""}
        </div>
      </div>
      ${mintTile(stateName(state), "dossier state")}
    </div>`;
    // A step that finished while the screen is open draws its check once.
    for (let i = 0; i < stateOrder(state); i++) {
      const key = steps[i]!.key;
      if (!drawn[key] && openedWith[key] === false) {
        drawn[key] = true;
        const check = qsa("[data-part=step-check]", root)[i];
        if (check && !motion.reduced) motion.animate(check, { opacity: "0", transform: "scale(0.6)" }, { opacity: "1", transform: "scale(1)" }, 320);
      } else if (openedWith[key] === undefined) {
        drawn[key] = true;
      }
    }
    if (Object.keys(openedWith).length === 0) {
      openedWith = Object.fromEntries(steps.map((s, i) => [s.key, stateOrder(state) > i]));
    }
    qs("#sign-dossier", root)?.addEventListener("click", () => {
      dialogs.openDialog("Sign dossier", `<label>Your full name<input name="typedName" autocomplete="name"></label>`, async (form) => {
        await api(`/api/pieces/${pieceId}/dossier/sign`, { method: "POST", json: { typedName: (form.elements.namedItem("typedName") as HTMLInputElement).value } });
        announce("Dossier signed.");
        dialogs.closeDialog();
        await load();
      });
    });
    qsa("#dossier-rail .rail-link", root).forEach((link) =>
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const hash = link.getAttribute("href")!;
        qsa("#dossier-rail .rail-link", root).forEach((l) => l.removeAttribute("aria-current"));
        link.setAttribute("aria-current", "true");
        const target = qs(hash, root) as HTMLElement;
        target.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
        history.pushState({}, "", `${location.pathname}${hash}`);
      })
    );
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="make-dossier">Make dossier</button>`;
    qs("#make-dossier", bar)!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const original = btn.textContent ?? "";
      btn.textContent = "Working…";
      btn.setAttribute("aria-disabled", "true");
      try {
        await api(`/api/pieces/${pieceId}/dossier`, { method: "POST", json: {} });
        await load();
      } catch (err) {
        if (err instanceof ApiFail) announce(err.message);
      } finally {
        btn.textContent = original;
        btn.removeAttribute("aria-disabled");
      }
    });
  }

  await load();
  autoRefresh(load);
  void el;
}

const stateOrder = (state: string): number => (state === "none" || state === "failed" || state === "waiting" ? 0 : state === "rendering" ? 1 : 2);
const stateName = (state: string): string => (state === "none" ? "None" : state === "stored" ? "Stored" : state === "signed" ? "Signed" : state === "failed" ? "Failed" : state === "rendering" ? "Rendering" : "Waiting");
