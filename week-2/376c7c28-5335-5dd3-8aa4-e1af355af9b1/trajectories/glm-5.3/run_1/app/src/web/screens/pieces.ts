import { api, type Passport, pieceStatusLabel } from "../api";
import { h, clear, dollars, screenDate, screen as appScreen, registerRefresh } from "../helpers";
import { me, navigate } from "../main";

export function renderPieces(root: HTMLElement): void {
  const list = h("ul", { class: "piece-grid", "aria-label": "My pieces" });
  const body = appScreen(h("section", { class: "panel" }, list));
  root.appendChild(body);
  const timeZone = me()?.timeZone ?? "UTC";
  void load();

  async function load(): Promise<void> {
    try {
      const pieces = await api<Passport[]>("/api/pieces");
      clear(list);
      for (const piece of pieces) {
        const card = h(
          "li",
          { class: "card" },
          h("a", { class: "card-title", href: `/pieces/${piece.id}`, text: piece.title }),
          h("div", { class: "status", text: pieceStatusLabel(piece.status) }),
          h("div", { class: "mono-row" }, h("span", { class: "fig", text: `${dollars(piece.quote.bisque.fee_cents)} bisque` }), h("span", { class: "fig", text: `${dollars(piece.quote.glaze.fee_cents)} glaze` })),
          piece.pickup_deadline ? h("div", { class: "muted", text: `COLLECT BY ${screenDate(piece.pickup_deadline, timeZone)}` }) : null,
        );
        card.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          navigate(`/pieces/${piece.id}`);
        });
        list.appendChild(card);
      }
    } catch {
      /* the next live update will refill the list */
    }
  }

  registerRefresh(() => void load());
}
