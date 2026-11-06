import { api, chargeKindLabel, chargeStatusLabel, pieceStatusLabel, ApiCallError, type Passport } from "../api";
import { h, clear, dollars, screenDate, shortDateTime, screen as appScreen, registerRefresh, heading } from "../helpers";

export function renderPassport(root: HTMLElement, id: string): void {
  const photoPanel = h("section", { class: "panel photo-panel" });
  const details = h("section", { class: "panel passport-details" });
  const layout = h("div", { class: "split-2-2" }, photoPanel, details);
  root.appendChild(appScreen(layout));
  void load();

  async function load(): Promise<void> {
    let piece: Passport;
    try {
      piece = await api<Passport>(`/api/pieces/${encodeURIComponent(id)}`);
    } catch (err) {
      const code = err instanceof ApiCallError && err.kind === "api" ? err.body.error : "network";
      photoPanel.replaceChildren(h("p", { class: "muted", text: code === "not_found" ? "Not found." : "No connection. Check the studio wifi and try again." }));
      return;
    }
    const timeZone = await fetchTimeZone();
    renderPhoto(piece.id, piece.title);
    renderDetails(piece, timeZone);
  }

  let cachedTz: string | null = null;
  async function fetchTimeZone(): Promise<string> {
    if (cachedTz) return cachedTz;
    try {
      const body = await api<{ time_zone: string }>("/api/studio");
      cachedTz = body.time_zone;
    } catch {
      cachedTz = "UTC";
    }
    return cachedTz;
  }

  function renderPhoto(pieceId: string, title: string): void {
    clear(photoPanel);
    const img = document.createElement("img");
    img.alt = `Intake photo of ${title}`;
    img.className = "passport-photo";
    const placeholder = h("div", { class: "photo-placeholder" });
    photoPanel.append(img as unknown as HTMLElement, placeholder);
    void (async () => {
      try {
        const blob = await api<ArrayBuffer>(`/api/pieces/${encodeURIComponent(pieceId)}/photo`);
        const url = URL.createObjectURL(new Blob([blob]));
        img.src = url;
        img.style.display = "";
        placeholder.style.display = "none";
      } catch (err) {
        img.style.display = "none";
        const code = err instanceof ApiCallError && err.kind === "api" ? err.body.error : "network";
        placeholder.textContent = code === "storage_unavailable" ? "Photo unavailable right now" : "No photo yet";
        placeholder.style.display = "";
      }
    })();
  }

  function renderDetails(piece: Passport, timeZone: string): void {
    clear(details);
    const bits: HTMLElement[] = [
      heading(1, piece.title),
      h("div", { class: "status", text: pieceStatusLabel(piece.status) }),
      h("div", { class: "figure-block" },
        fig("RAW", `${piece.length_in} × ${piece.width_in} × ${piece.height_in} IN`),
        fig("ROUNDED", `${piece.rounded.length_in} × ${piece.rounded.width_in} × ${piece.rounded.height_in} IN`),
        fig("CUBIC", `${piece.cubic_inches} CU IN`),
        fig("BISQUE", dollars(piece.quote.bisque.fee_cents)),
        fig("GLAZE", dollars(piece.quote.glaze.fee_cents)),
      ),
    ];
    if (piece.location) bits.push(h("div", { class: "muted", text: `${piece.location.kiln_name}, deck ${piece.location.deck}` }));
    if (piece.outcomes.bisque) bits.push(h("div", { class: "muted", text: `BISQUE ${outcomeLabel(piece.outcomes.bisque)}` }));
    if (piece.outcomes.glaze) bits.push(h("div", { class: "muted", text: `GLAZE ${outcomeLabel(piece.outcomes.glaze)}` }));
    if (piece.pickup_deadline) bits.push(h("div", { class: "muted", text: `COLLECT BY ${screenDate(piece.pickup_deadline, timeZone)}` }));
    details.append(
      ...bits,
      h("div", { class: "figure-block" },
        fig("RAW", `${piece.length_in} × ${piece.width_in} × ${piece.height_in} IN`),
        fig("ROUNDED", `${piece.rounded.length_in} × ${piece.rounded.width_in} × ${piece.rounded.height_in} IN`),
        fig("CUBIC", `${piece.cubic_inches} CU IN`),
        fig("BISQUE", dollars(piece.quote.bisque.fee_cents)),
        fig("GLAZE", dollars(piece.quote.glaze.fee_cents)),
      ),
    );
    const chargesTable = buildChargesTable(piece, timeZone);
    const history = h("ul", { class: "history", "aria-label": "Piece history" });
    for (const row of piece.history) {
      history.appendChild(h("li", { class: "history-row" }, h("span", { text: pieceStatusLabel(row.status) }), h("span", { class: "muted", text: shortDateTime(row.at, timeZone) })));
    }
    details.append(chargesTable, h("div", { class: "caption", text: "HISTORY" }), history);
  }

  function buildChargesTable(piece: Passport, timeZone: string): HTMLElement {
    const dateOf = (d: string): string => screenDate(d, timeZone);
    const table = h("table", { class: "table", "aria-label": "Charges" });
    const thead = h("thead", null, h("tr", null, h("th", { class: "cell", text: "Kind" }), h("th", { class: "cell", text: "Fee" }), h("th", { class: "cell", text: "Status" })));
    const tbody = h("tbody");
    for (const charge of piece.charges) {
      tbody.appendChild(
        h("tr", null,
          h("td", { class: "cell", text: chargeKindLabel(charge, dateOf) }),
          h("td", { class: "cell mono", text: dollars(charge.fee_cents) }),
          h("td", { class: "cell", text: chargeStatusLabel(charge) }),
        ),
      );
    }
    table.append(thead, tbody);
    return table;
  }

  function outcomeLabel(o: string): string {
    return o.charAt(0).toUpperCase() + o.slice(1);
  }

  registerRefresh(() => void load());
}

function fig(caption: string, value: string): HTMLElement {
  return h("div", { class: "figure-row" }, h("span", { class: "muted", text: caption }), h("span", { class: "fig", text: value }));
}
