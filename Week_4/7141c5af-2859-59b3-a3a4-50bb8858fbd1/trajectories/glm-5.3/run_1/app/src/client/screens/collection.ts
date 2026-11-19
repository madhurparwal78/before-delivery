import { api, announce, el, qs, qsa, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Collection = { id: string; state: string; collectAt: string; localDate: string; localTime: string; town: string; display: string; labelSha256: string | null };
type Piece = { title: string };

export async function installCollection(root: HTMLElement): Promise<void> {
  const pieceId = root.dataset.pieceId!;
  let quote: { quoteId: string; display: string } | null = null;

  const load = async (): Promise<void> => {
    const [{ piece }, { collections }] = await Promise.all([
      api<{ piece: Piece }>(`/api/pieces/${pieceId}`),
      api<{ collections: Collection[] }>(`/api/pieces/${pieceId}/collections`),
    ]);
    const heading = qs("#screen-heading");
    if (heading) heading.textContent = `Collection of ${piece.title}`;
    document.title = `Collection of ${piece.title} — Semenza Desk`;
    const next = [...collections].sort((a, b) => a.collectAt.localeCompare(b.collectAt)).find((c) => c.state === "booked" || c.state === "waiting");
    root.innerHTML = `<div class="bento">
      <div class="tile wide">
        <h2>Collections</h2>
        <p id="quote-line">${quote ? `Quote: ${quote.display}.` : "No quote yet."}</p>
        <ul>${collections.length ? collections.map((c) => `<li>${c.display} · <span class="collection-state">${c.state === "booked" ? "Booked" : c.state}</span>${c.labelSha256 ? ` · <a href="/api/pieces/${pieceId}/collections/${c.id}/label" id="label-${c.id}">Label for ${c.id}</a>` : ""}</li>`).join("") : "<li>No collections yet.</li>"}</ul>
      </div>
      ${next ? mintTile(next.display, "next collection") : ""}
    </div>`;
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button id="get-quote">Get a quote</button> <button class="primary" id="book-collection">Book a collection</button>`;
    qs("#get-quote", bar)!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const original = btn.textContent ?? "";
      btn.textContent = "Working…";
      btn.setAttribute("aria-disabled", "true");
      try {
        const res = await api<{ quote: { quoteId: string; display: string } }>(`/api/pieces/${pieceId}/collections/quote`, { method: "POST", json: {} });
        quote = res.quote;
        announce(`Quote: ${res.quote.display}.`);
        await load();
      } catch (err) {
        if (err instanceof ApiFail) announce(err.message);
      } finally {
        btn.textContent = original;
        btn.removeAttribute("aria-disabled");
      }
    });
    qs("#book-collection", bar)!.addEventListener("click", () => {
      dialogs.openDialog(
        "Book a collection",
        `<label>Date<input name="date" placeholder="YYYY-MM-DD"></label>
         <label>Time<input name="time" placeholder="HH:MM"></label>`,
        async (form) => {
          if (!quote) {
            announce("This piece needs its width, depth, height and weight first.");
            return;
          }
          const res = await api<{ collection: Collection }>(`/api/pieces/${pieceId}/collections`, {
            method: "POST",
            json: { quoteId: quote!.quoteId, localDate: (form.elements.namedItem("date") as HTMLInputElement).value, localTime: (form.elements.namedItem("time") as HTMLInputElement).value },
          });
          announce(res.collection.state === "booked" ? "Booked" : res.collection.state);
          dialogs.closeDialog();
          await load();
        }
      );
    });
  }

  await load();
  autoRefresh(load);
  void el;
  void qsa;
}
