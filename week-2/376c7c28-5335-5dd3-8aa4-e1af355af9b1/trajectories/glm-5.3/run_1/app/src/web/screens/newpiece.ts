import { api, ApiCallError, errorFields, type Passport } from "../api";
import { h, liveRegion, announce, dollars, debounce, screen as appScreen } from "../helpers";
import { applyFieldErrors } from "./join";
import { navigate } from "../main";

export function renderNewPiece(root: HTMLElement): void {
  const status = liveRegion("Piece status");
  const title = h("input", { class: "input", type: "text", id: "log-title", "data-field": "title" });
  const clay = h("select", { class: "input", id: "log-clay", "data-field": "clay_body_id" });
  const length = h("input", { class: "input small", type: "number", id: "log-length", "data-field": "length_in", step: "0.01", min: "0", max: "24" });
  const width = h("input", { class: "input small", type: "number", id: "log-width", "data-field": "width_in", step: "0.01", min: "0", max: "24" });
  const height = h("input", { class: "input small", type: "number", id: "log-height", "data-field": "height_in", step: "0.01", min: "0", max: "24" });
  const photo = h("input", { type: "file", id: "log-photo", accept: "image/jpeg,image/png,image/webp" });
  const photoLabel = h("label", { class: "file-label", for: "log-photo", text: "Intake photo" });
  const submit = h("button", { class: "btn primary", text: "Log piece", type: "submit" });

  const quoteCubic = h("div", { class: "fig big", text: "—" });
  const quoteBisque = h("div", { class: "fig", text: "—" });
  const quoteGlaze = h("div", { class: "fig", text: "—" });
  const quoteRegion = h("section", { class: "panel quote-panel", "aria-label": "Quote" }, h("div", { class: "caption", text: "QUOTE" }), quoteCubic, quoteBisque, quoteGlaze);

  const form = h(
    "form",
    {
      class: "panel log-form",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void log();
      },
    },
    h("h1", { class: "heading", text: "Log a piece" }),
    fieldBlock("Title", title, "log-title"),
    fieldBlock("Clay body", clay, "log-clay"),
    h(
      "div",
      { class: "dim-row" },
      fieldBlock("Length (in)", length, "log-length"),
      fieldBlock("Width (in)", width, "log-width"),
      fieldBlock("Height (in)", height, "log-height"),
    ),
    h("div", { class: "quote-slot-375" }, quoteRegion),
    h("div", { class: "field" }, photoLabel, photo, h("div", { class: "field-error", "data-for": "log-photo" })),
    submit,
    status,
  );

  const grid = h("div", { class: "split-8-4" }, form, h("div", { class: "quote-slot-wide" }, quoteRegion));
  root.appendChild(appScreen(grid));

  const dimsValid = (): boolean => {
    for (const input of [length, width, height] as HTMLInputElement[]) {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value) || value <= 0 || value > 24) return false;
    }
    return true;
  };

  const refreshQuote = debounce(() => {
    if (!dimsValid()) {
      quoteCubic.textContent = "Quote unavailable — check the dimensions.";
      quoteBisque.textContent = "";
      quoteGlaze.textContent = "";
      return;
    }
    void (async () => {
      try {
        const quote = await api<{ cubic_inches: number; bisque: { fee_cents: number }; glaze: { fee_cents: number } }>("/api/quotes", {
          method: "POST",
          body: { length_in: Number((length as HTMLInputElement).value), width_in: Number((width as HTMLInputElement).value), height_in: Number((height as HTMLInputElement).value) },
        });
        quoteCubic.textContent = `${quote.cubic_inches} CU IN`;
        quoteBisque.textContent = `BISQUE ${dollars(quote.bisque.fee_cents)}`;
        quoteGlaze.textContent = `GLAZE ${dollars(quote.glaze.fee_cents)}`;
      } catch {
        quoteCubic.textContent = "Quote unavailable — check the dimensions.";
        quoteBisque.textContent = "";
        quoteGlaze.textContent = "";
      }
    })();
  }, 333);

  for (const input of [length, width, height] as HTMLInputElement[]) {
    input.addEventListener("input", refreshQuote);
  }

  void (async () => {
    try {
      const bodies = await api<{ id: string; name: string }[]>("/api/clay-bodies");
      for (const body of bodies) {
        clay.appendChild(h("option", { value: body.id, text: body.name }));
      }
    } catch {
      /* clay bodies list will refill on the next change */
    }
  })();

  async function log(): Promise<void> {
    submit.setAttribute("disabled", "true");
    announce(status, "Logging piece…");
    const body = {
      title: (title as HTMLInputElement).value,
      clay_body_id: (clay as HTMLSelectElement).value,
      length_in: Number((length as HTMLInputElement).value),
      width_in: Number((width as HTMLInputElement).value),
      height_in: Number((height as HTMLInputElement).value),
    };
    let piece: Passport;
    try {
      piece = await api<Passport>("/api/pieces", { method: "POST", body });
    } catch (err) {
      const fields = errorFields(err);
      if (fields) {
        applyFieldErrors(form, fields);
        announce(status, "Fix the highlighted fields.");
      } else if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
      submit.removeAttribute("disabled");
      return;
    }
    // If a photo is attached it is uploaded after the piece is created.
    const file = (photo as HTMLInputElement).files?.[0];
    if (file) {
      try {
        const form = new FormData();
        form.append("photo", file);
        await api(`/api/pieces/${piece.id}/photo`, { method: "PUT", rawBody: form as unknown as BodyInit });
      } catch (err) {
        const code = err instanceof ApiCallError && err.kind === "api" ? err.body.error : "network";
        if (code === "photo_too_large") announce(status, "Photo is larger than 5,000,000 bytes. The piece is logged; add a smaller photo.");
        else if (code === "unsupported_photo") announce(status, "Use a JPEG, PNG or WebP photo. The piece is logged; add the photo again.");
        else if (code === "storage_unavailable") announce(status, "Photo storage is unavailable. The piece is logged; add the photo again in a few minutes.");
        else announce(status, "No connection. Check the studio wifi and try again.");
        navigate(`/pieces/${piece.id}`);
        return;
      }
    }
    announce(status, "Piece logged. Bring it to the intake shelf.");
    navigate(`/pieces/${piece.id}`);
  }
}

function fieldBlock(label: string, input: HTMLElement, id: string): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id }));
}
