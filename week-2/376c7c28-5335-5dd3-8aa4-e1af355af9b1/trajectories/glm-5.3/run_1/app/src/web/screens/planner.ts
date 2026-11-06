import { api, ApiCallError, errorCode, loadStatusLabel, type Ticket, type LoadBody, type KilnRow } from "../api";
import { h, clear, liveRegion, announce, dollars, reducedMotion, animate, screen as appScreen, registerRefresh, showModal, closeModal, debounce } from "../helpers";

const STACK_HEIGHT = 27;
const SHELF_THICKNESS = 0.625;

type PlannerState = {
  loads: LoadBody[];
  load: LoadBody | null;
  waiting: Ticket[];
  selectedTicketId: string | null;
  taken: Set<string>;
};

export function renderPlanner(root: HTMLElement): void {
  const status = liveRegion("Planner status");
  const state: PlannerState = { loads: [], load: null, waiting: [], selectedTicketId: null, taken: new Set() };

  const loadPicker = h("select", { class: "input", "aria-label": "Load" });
  const newLoadButton = h("button", { class: "btn", text: "New load" });
  const actionBar = h("div", { class: "planner-actions" }, loadPicker, newLoadButton);

  // The rail of waiting-piece tickets.
  const railList = h("div", { class: "rail-list", role: "listbox", "aria-label": "Waiting pieces", tabindex: "0" });
  const railPanel = h("aside", { class: "planner-rail panel", "aria-label": "Waiting" }, h("div", { class: "caption", text: "WAITING" }), railList);

  // The kiln elevation drawing.
  const drawing = h("div", { class: "elevation", role: "img", "aria-label": "Kiln elevation" });
  const elevationPanel = h("section", { class: "panel elevation-panel" }, drawing);

  // Load figures.
  const headroomMeter = h("meter", { class: "meter", min: "0", max: "27", "aria-label": "Headroom", value: "27" });
  const headroomFig = h("span", { class: "fig", text: "HEADROOM 27.000 IN" });
  const footprints = h("div", { class: "footprints" });
  const loadValueFig = h("div", { class: "fig big", text: "LOAD VALUE $0.00" });
  const figuresPanel = h("section", { class: "panel figures", "aria-label": "Load figures" },
    h("div", { class: "caption", text: "LOAD FIGURES" }),
    h("div", { class: "figure-row" }, headroomFig, headroomMeter),
    footprints,
    loadValueFig);

  // Decks list.
  const decksList = h("ul", { class: "decks", "aria-label": "Decks" });
  const decksPanel = h("section", { class: "panel" }, h("div", { class: "caption", text: "DECKS" }), decksList);

  // Load action buttons.
  const placeButton = h("button", { class: "btn", text: "Place piece" });
  const addDeckButton = h("button", { class: "btn", text: "Add deck" });
  const removeDeckButton = h("button", { class: "btn", text: "Remove top deck" });
  const markLoadedButton = h("button", { class: "btn", text: "Mark loaded" });
  const startFiringButton = h("button", { class: "btn", text: "Start firing" });
  const startCoolingButton = h("button", { class: "btn", text: "Start cooling" });
  const unloadButton = h("button", { class: "btn", text: "Unload" });
  const cancelButton = h("button", { class: "btn", text: "Cancel load" });
  const buttonsRow = h("div", { class: "load-buttons" }, placeButton, addDeckButton, removeDeckButton, markLoadedButton, startFiringButton, startCoolingButton, unloadButton, cancelButton);

  const figuresColumn = h("div", { class: "figures-column" }, figuresPanel, decksPanel, buttonsRow);
  const layout = h("div", { class: "planner-grid" }, railPanel, elevationPanel, figuresColumn);
  root.appendChild(appScreen(actionBar, layout, status));

  void init();

  async function init(): Promise<void> {
    await reloadAll();
  }

  async function reloadAll(): Promise<void> {
    const loads = await api<LoadBody[]>("/api/loads?open=1").catch(() => [] as LoadBody[]);
    state.loads = loads;
    if (!state.load || !loads.some((l) => l.id === state.load?.id)) {
      const planning = loads.filter((l) => l.status === "planning");
      state.load = planning.length > 0 ? planning[0] : null;
    } else {
      const fresh = loads.find((l) => l.id === state.load?.id);
      if (fresh) state.load = fresh;
    }
    renderLoadPicker();
    await reloadLoadBody();
    await reloadWaiting();
  }

  async function reloadLoadBody(): Promise<void> {
    if (state.load) {
      try {
        state.load = await api<LoadBody>(`/api/loads/${encodeURIComponent(state.load.id)}`);
      } catch {
        state.load = null;
      }
    }
    renderFigures();
    renderDrawing();
    renderDecks();
    renderButtons();
  }

  async function reloadWaiting(): Promise<void> {
    const firing = state.load?.firing ?? "bisque";
    const statusParam = state.load ? `status=waiting_${firing}&unplaced=1` : "status=waiting_bisque&unplaced=1";
    state.waiting = await api<Ticket[]>(`/api/pieces?${statusParam}`).catch(() => [] as Ticket[]);
    renderRail();
  }

  function renderLoadPicker(): void {
    clear(loadPicker);
    for (const load of state.loads) {
      loadPicker.appendChild(h("option", { value: load.id, text: `${load.kiln.name} · ${load.firing} · ${loadStatusLabel(load.status)}`, selected: state.load?.id === load.id }));
    }
  }

  loadPicker.addEventListener("change", () => {
    state.load = state.loads.find((l) => l.id === (loadPicker as HTMLSelectElement).value) ?? null;
    state.selectedTicketId = null;
    void (async () => {
      await reloadLoadBody();
      await reloadWaiting();
    })();
  });

  // ---------- The rail ----------

  function renderRail(): void {
    clear(railList);
    for (const ticket of state.waiting) {
      const isTaken = state.taken.has(ticket.id);
      const option = h("div", {
        class: `ticket-option${isTaken ? " taken" : ""}${state.selectedTicketId === ticket.id ? " selected" : ""}`,
        role: "option",
        "aria-selected": state.selectedTicketId === ticket.id ? "true" : "false",
        tabindex: "-1",
        "data-piece": ticket.id,
      },
        h("div", { class: "ticket-title", text: `${ticket.title} · ${ticket.owner_handle}` }),
        h("div", { class: "muted small", text: `${ticket.length_in} × ${ticket.width_in} × ${ticket.height_in} IN · ${ticket.clay_body}` }),
        isTaken ? h("span", { class: "taken-tag", text: "TAKEN" }) : null);
      if (!isTaken) {
        option.addEventListener("click", () => {
          selectTicket(ticket.id);
        });
        option.addEventListener("pointerdown", (e) => {
          if ((e as PointerEvent).button !== 0 && (e as PointerEvent).pointerType === "mouse") return;
          beginTicketDrag(e as PointerEvent, option, ticket);
        });
      }
      railList.appendChild(option);
    }
  }

  function selectTicket(id: string | null): void {
    state.selectedTicketId = id;
    renderRail();
    renderButtons();
    const selected = railList.querySelector<HTMLElement>(".ticket-option.selected");
    selected?.focus();
  }

  railList.addEventListener("keydown", (e) => {
    const options = Array.from(railList.querySelectorAll<HTMLElement>(".ticket-option:not(.taken)"));
    if (options.length === 0) return;
    const currentIndex = options.findIndex((o) => o.classList.contains("selected"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(options.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
      selectTicket(options[next].getAttribute("data-piece"));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (currentIndex >= 0) selectTicket(options[currentIndex].getAttribute("data-piece"));
    }
  });

  // ---------- Drag placement ----------

  let drag: { ghost: HTMLElement; piece: Ticket; fromRail: HTMLElement | null; pointerId: number; offsetX: number; offsetY: number } | null = null;
  let overlay: HTMLElement | null = null;

  function beginTicketDrag(e: PointerEvent, option: HTMLElement, ticket: Ticket): void {
    let started = false;
    let startX = e.clientX;
    let startY = e.clientY;
    const ghost = h("div", { class: "drag-ghost", text: ticket.title });
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) > 4) {
        started = true;
        document.body.appendChild(ghost);
        option.classList.add("dragging-source");
        document.addEventListener("keydown", onKey, true);
      }
      if (started) {
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
        const deck = deckUnderPointer(ev.clientX, ev.clientY);
        highlightDeck(deck);
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        cleanup();
        springBack(ghost, option);
      }
    };
    const onUp = (ev: PointerEvent): void => {
      if (!started) {
        cleanup();
        return;
      }
      const deck = deckUnderPointer(ev.clientX, ev.clientY);
      cleanup();
      if (deck === null) {
        springBack(ghost, option);
        return;
      }
      void placePiece(ticket, deck);
    };
    const cleanup = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey, true);
      option.classList.remove("dragging-source");
      if (ghost.parentElement) ghost.remove();
      highlightDeck(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function deckUnderPointer(x: number, y: number): number | null {
    const bands = drawing.querySelectorAll<HTMLElement>(".deck-band");
    for (const band of bands) {
      const rect = band.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return Number(band.getAttribute("data-deck"));
      }
    }
    return null;
  }

  function highlightDeck(deck: number | null): void {
    for (const band of drawing.querySelectorAll<HTMLElement>(".deck-band")) {
      band.classList.toggle("hovered", Number(band.getAttribute("data-deck")) === deck);
    }
  }

  function springBack(ghost: HTMLElement, source: HTMLElement): void {
    if (reducedMotion()) {
      ghost.remove();
      return;
    }
    const target = source.getBoundingClientRect();
    ghost.style.transition = "left 0.3s cubic-bezier(0.2,0.8,0.4,1), top 0.3s cubic-bezier(0.2,0.8,0.4,1)";
    ghost.style.left = `${target.left}px`;
    ghost.style.top = `${target.top}px`;
    setTimeout(() => ghost.remove(), 320);
  }

  function showRefusal(deck: number, reason: string): void {
    hideRefusal();
    overlay = h("div", { class: "refusal-overlay", "data-deck": String(deck) }, h("span", { class: "fig", text: reason }));
    const band = drawing.querySelector<HTMLElement>(`.deck-band[data-deck="${deck}"]`);
    band?.appendChild(overlay);
  }

  function hideRefusal(): void {
    overlay?.remove();
    overlay = null;
  }

  // ---------- The elevation drawing ----------

  function renderDrawing(): void {
    clear(drawing);
    const load = state.load;
    const inner = h("div", { class: "elevation-inner" });
    drawing.appendChild(inner);
    if (!load) {
      inner.appendChild(h("div", { class: "muted center", text: "No load selected." }));
      return;
    }
    const totalHeightIn = load.kiln.stack_height_in || STACK_HEIGHT;
    void totalHeightIn;
    let deckBottoms = 0;
    for (const deck of load.decks) {
      const band = h("div", { class: "deck-band", "data-deck": String(deck.number) });
      const piecesRow = h("div", { class: "silhouette-row" });
      band.appendChild(piecesRow);
      inner.appendChild(band);
      deckBottoms += deck.deck_height_in;
    }
    // Positions are set by layout once the element has a size.
    requestAnimationFrame(() => layoutDrawing());
  }

  function layoutDrawing(): void {
    const load = state.load;
    const inner = drawing.querySelector<HTMLElement>(".elevation-inner");
    if (!load || !inner) return;
    const rect = drawing.getBoundingClientRect();
    const pxPerIn = rect.height / STACK_HEIGHT;
    const innerWidth = rect.width;
    // Each deck band's bottom sits at the sum of deck heights below it.
    let bottom = 0;
    for (const deck of load.decks) {
      const band = inner.querySelector<HTMLElement>(`.deck-band[data-deck="${deck.number}"]`);
      if (!band) continue;
      band.style.bottom = `${bottom * pxPerIn}px`;
      band.style.height = `${(deck.deck_height_in - SHELF_THICKNESS) * pxPerIn}px`;
      // Silhouettes stand on the deck floor, in placement order, left to right.
      const row = band.querySelector<HTMLElement>(".silhouette-row");
      if (!row) continue;
      clear(row);
      const gap = 4;
      let widths = deck.pieces.map((p) => roundedWidth(p) * pxPerIn);
      const totalWidth = widths.reduce((s, w) => s + w, 0) + gap * (deck.pieces.length + 1);
      let factor = 1;
      if (totalWidth > innerWidth) factor = innerWidth / totalWidth;
      let left = gap;
      for (let i = 0; i < deck.pieces.length; i++) {
        const piece = deck.pieces[i];
        const silhouette = h("div", { class: "silhouette", "data-piece": piece.id, title: piece.title });
        const widthPx = Math.max(6, widths[i] * factor);
        const heightPx = roundedHeight(piece) * pxPerIn;
        silhouette.style.width = `${widthPx}px`;
        silhouette.style.height = `${heightPx}px`;
        silhouette.style.left = `${left}px`;
        row.appendChild(silhouette);
        left += widthPx + gap;
        attachSilhouetteDrag(silhouette, piece);
      }
      bottom += deck.deck_height_in;
    }
    // Shelf lines and the headroom marker.
    let shelfBottom = 0;
    for (const deck of load.decks) {
      shelfBottom += deck.deck_height_in;
      const shelf = inner.querySelector<HTMLElement>(`.shelf[data-deck="${deck.number}"]`);
      void shelf;
    }
    const headroom = load.headroom_in;
    const headroomY = (STACK_HEIGHT - headroom) * pxPerIn;
    let headroomLine = inner.querySelector<HTMLElement>(".headroom-line");
    if (!headroomLine) {
      headroomLine = h("div", { class: "headroom-line" }, h("span", { class: "fig muted small headroom-label" }));
      inner.appendChild(headroomLine);
    }
    headroomLine.style.bottom = `${(STACK_HEIGHT - headroom) * pxPerIn}px`;
    const label = headroomLine.querySelector<HTMLElement>(".headroom-label");
    if (label) label.textContent = `HEADROOM ${headroom.toFixed(3)} IN`;
    void headroomY;
    // Shelf bands drawn under each deck above deck 1.
    let deckBottom = 0;
    for (const deck of load.decks) {
      deckBottom += deck.deck_height_in;
      let shelfBand = inner.querySelector<HTMLElement>(`.shelf-band[data-top="${deck.number}"]`);
      if (!shelfBand) {
        shelfBand = h("div", { class: "shelf-band", "data-top": String(deck.number) });
        inner.appendChild(shelfBand);
      }
      shelfBand.style.bottom = `${(deckBottom - SHELF_THICKNESS) * pxPerIn}px`;
      shelfBand.style.height = `${SHELF_THICKNESS * pxPerIn}px`;
    }
  }

  window.addEventListener("resize", debounce(() => layoutDrawing(), 100));

  function attachSilhouetteDrag(silhouette: HTMLElement, piece: Ticket): void {
    silhouette.addEventListener("pointerdown", (e) => {
      const pe = e as PointerEvent;
      let started = false;
      const startX = pe.clientX;
      const startY = pe.clientY;
      const ghost = h("div", { class: "drag-ghost", text: piece.title });
      const onMove = (ev: PointerEvent): void => {
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
          started = true;
          document.body.appendChild(ghost);
          document.addEventListener("keydown", onKey, true);
        }
        if (started) {
          ghost.style.left = `${ev.clientX + 8}px`;
          ghost.style.top = `${ev.clientY + 8}px`;
          highlightDeck(deckUnderPointer(ev.clientX, ev.clientY));
        }
      };
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
          cleanup();
          ghost.remove();
        }
      };
      const onUp = (ev: PointerEvent): void => {
        if (!started) {
          cleanup();
          return;
        }
        const deck = deckUnderPointer(ev.clientX, ev.clientY);
        const ownDeck = silhouette.closest<HTMLElement>(".deck-band");
        cleanup();
        ghost.remove();
        if (deck === null || (ownDeck && Number(ownDeck.getAttribute("data-deck")) === deck)) {
          return;
        }
        void movePiece(piece, deck);
      };
      const cleanup = (): void => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("keydown", onKey, true);
        highlightDeck(null);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // ---------- Figures ----------

  const lastFigures = { headroom: 27, value: 0 };

  function renderFigures(): void {
    const load = state.load;
    const headroom = load ? load.headroom_in : STACK_HEIGHT;
    const value = load ? load.value_cents : 0;
    // Each meter's value attribute is set to the final value at once; only the
    // visible numerals count.
    (headroomMeter as HTMLMeterElement).value = Math.max(0, Math.min(27, headroom));
    animate(lastFigures.headroom, headroom, 500, (v) => {
      headroomFig.textContent = `HEADROOM ${v.toFixed(3)} IN`;
    });
    animate(lastFigures.value, value, 500, (v) => {
      loadValueFig.textContent = `LOAD VALUE ${dollars(v)}`;
    });
    lastFigures.headroom = headroom;
    lastFigures.value = value;
    clear(footprints);
    for (const deck of load?.decks ?? []) {
      const meter = h("meter", { class: "meter", min: "0", max: "100", "aria-label": `Footprint, deck ${deck.number}`, value: String(deck.footprint_pct) });
      const label = h("span", { class: "fig", text: `FOOTPRINT D${deck.number} ${deck.footprint_pct.toFixed(1)}%` });
      footprints.appendChild(h("div", { class: "figure-row" }, label, meter));
    }
  }

  function renderDecks(): void {
    clear(decksList);
    const load = state.load;
    if (!load) {
      decksList.appendChild(h("li", { class: "deck-item muted", text: "No load selected." }));
      return;
    }
    for (const deck of load.decks) {
      const item = h("li", { class: "deck-item", text: `DECK ${deck.number} · POST ${deck.post_height_in} IN · ${deck.pieces.length} PIECES` });
      for (const piece of deck.pieces) {
        const moveButton = h("button", { class: "btn small", text: `Move ${piece.title}` });
        const removeButton = h("button", { class: "btn small", text: `Remove ${piece.title}` });
        moveButton.addEventListener("click", () => openMoveDialog(moveButton, piece));
        removeButton.addEventListener("click", () => void removePiece(piece));
        item.appendChild(h("div", { class: "deck-piece" }, h("span", { text: piece.title }), moveButton, removeButton));
      }
      decksList.appendChild(item);
    }
  }

  function renderButtons(): void {
    const status = state.load?.status;
    const isPlanning = status === "planning";
    setEnabled(placeButton, isPlanning && state.selectedTicketId !== null && state.taken.size === 0);
    setEnabled(addDeckButton, isPlanning);
    setEnabled(removeDeckButton, isPlanning);
    setEnabled(markLoadedButton, status === "planning");
    setEnabled(startFiringButton, status === "loaded");
    setEnabled(startCoolingButton, status === "firing");
    setEnabled(unloadButton, status === "cooling");
    setEnabled(cancelButton, isPlanning || status === "loaded");
  }

  function setEnabled(button: HTMLElement, enabled: boolean): void {
    if (enabled) button.removeAttribute("disabled");
    else button.setAttribute("disabled", "true");
  }

  // ---------- Actions ----------

  newLoadButton.addEventListener("click", () => openNewLoadDialog(newLoadButton));

  async function placePiece(ticket: Ticket, deck: number): Promise<void> {
    if (!state.load) return;
    hideRefusal();
    announce(status, "Placing…");
    try {
      const load = await api<LoadBody>(`/api/loads/${encodeURIComponent(state.load.id)}/placements`, { method: "POST", body: { piece_id: ticket.id, deck } });
      state.load = load;
      state.taken.add(ticket.id);
      announce(status, `${ticket.title} placed on deck ${deck}.`);
      scheduleTakenCleanup(ticket.id);
      renderRail();
      renderFigures();
      renderDrawing();
      renderDecks();
      renderButtons();
    } catch (err) {
      handlePlacementRefusal(err, deck, ticket);
    }
  }

  async function movePiece(piece: Ticket, deck: number): Promise<void> {
    if (!state.load) return;
    hideRefusal();
    announce(status, "Moving…");
    try {
      const load = await api<LoadBody>(`/api/loads/${encodeURIComponent(state.load.id)}/moves`, { method: "POST", body: { piece_id: piece.id, deck } });
      state.load = load;
      announce(status, `${piece.title} moved to deck ${deck}.`);
      renderFigures();
      renderDrawing();
      renderDecks();
      renderButtons();
    } catch (err) {
      handlePlacementRefusal(err, deck, piece);
    }
  }

  function handlePlacementRefusal(err: unknown, deck: number, piece: Ticket): void {
    const code = errorCode(err);
    if (code === "exceeds_headroom") {
      const message = err instanceof ApiCallError && err.kind === "api" ? err.body.message : "Too tall for this stack.";
      showRefusal(deck, message);
      announce(status, message);
    } else if (code === "exceeds_footprint") {
      const message = err instanceof ApiCallError && err.kind === "api" ? err.body.message : `Deck ${deck} is full.`;
      showRefusal(deck, message);
      announce(status, message);
    } else if (code === "piece_taken") {
      state.taken.add(piece.id);
      renderRail();
      scheduleTakenCleanup(piece.id);
      announce(status, `Taken: ${piece.title} is already in another load.`);
    } else if (code === "validation" && err instanceof ApiCallError && err.kind === "api" && err.body.errors?.deck) {
      // The deck 422: the deck copy alone, no field message, no fix-the-fields copy.
      announce(status, err.body.errors.deck);
    } else if (code === "network") {
      announce(status, "No connection. Check the studio wifi and try again.");
    } else if (err instanceof ApiCallError && err.kind === "api") {
      announce(status, err.body.message);
    } else {
      announce(status, "Something went wrong. Try again.");
    }
  }

  function scheduleTakenCleanup(pieceId: string): void {
    setTimeout(() => {
      state.taken.delete(pieceId);
      if (state.selectedTicketId === pieceId) state.selectedTicketId = null;
      renderRail();
    }, 3500);
  }

  async function removePiece(piece: Ticket): Promise<void> {
    if (!state.load) return;
    hideRefusal();
    announce(status, "Updating load…");
    try {
      const load = await api<LoadBody>(`/api/loads/${encodeURIComponent(state.load.id)}/placements/${encodeURIComponent(piece.id)}`, { method: "DELETE" });
      state.load = load;
      announce(status, "Load updated.");
      renderFigures();
      renderDrawing();
      renderDecks();
      renderButtons();
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
      else announce(status, "No connection. Check the studio wifi and try again.");
    }
  }

  addDeckButton.addEventListener("click", () => void deckChange("POST", `/api/loads/${state.load?.id}/decks`));
  removeDeckButton.addEventListener("click", () => void deckChange("DELETE", `/api/loads/${state.load?.id}/decks/${state.load?.decks[state.load.decks.length - 1]?.number}`));

  async function deckChange(method: string, path: string): Promise<void> {
    if (!state.load || !path.includes(state.load.id)) return;
    hideRefusal();
    announce(status, "Updating load…");
    try {
      const load = await api<LoadBody>(path, { method });
      state.load = load;
      announce(status, "Load updated.");
      renderFigures();
      renderDrawing();
      renderDecks();
      renderButtons();
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
      else announce(status, "No connection. Check the studio wifi and try again.");
    }
  }

  for (const [button, next] of [
    [markLoadedButton, "loaded"],
    [startFiringButton, "firing"],
    [startCoolingButton, "cooling"],
    [cancelButton, "cancelled"],
  ] as [HTMLElement, string][]) {
    button.addEventListener("click", () => void changeStatus(next, button));
  }

  async function changeStatus(next: string, button: HTMLElement): Promise<void> {
    if (!state.load) return;
    hideRefusal();
    button.setAttribute("disabled", "true");
    announce(status, "Updating load…");
    try {
      const load = await api<LoadBody>(`/api/loads/${encodeURIComponent(state.load.id)}/status`, { method: "POST", body: { status: next } });
      state.load = load;
      announce(status, `Load is now ${loadStatusLabel(load.status)}.`);
      if (load.status === "cancelled" || load.status === "unloaded") state.load = null;
      renderFigures();
      renderDrawing();
      renderDecks();
      renderButtons();
      await reloadAll();
    } catch (err) {
      button.removeAttribute("disabled");
      if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
      else announce(status, "No connection. Check the studio wifi and try again.");
    }
  }

  // ---------- Dialogs ----------

  function openNewLoadDialog(opener: HTMLElement): void {
    void (async () => {
      const kilns = await api<KilnRow[]>("/api/kilns").catch(() => [] as KilnRow[]);
      const kilnSelect = h("select", { class: "input", "aria-label": "Kiln" });
      for (const kiln of kilns) kilnSelect.appendChild(h("option", { value: kiln.id, text: kiln.name }));
      const bisque = h("input", { type: "radio", name: "firing", value: "bisque", checked: true });
      const glaze = h("input", { type: "radio", name: "firing", value: "glaze" });
      const create = h("button", { class: "btn primary", text: "Create load" });
      const cancel = h("button", { class: "btn", text: "Cancel" });
      const dialog = h("div", { class: "dialog panel", "aria-label": "New load" },
        h("div", { class: "caption", text: "NEW LOAD" }),
        h("div", { class: "field" }, h("label", { text: "Kiln" }), kilnSelect),
        h("div", { class: "field", role: "radiogroup", "aria-label": "Firing" },
          h("div", { class: "radio-row" }, bisque, h("label", { text: "Bisque" })),
          h("div", { class: "radio-row" }, glaze, h("label", { text: "Glaze" }))),
        create,
        cancel);
      const close = (): void => {
        create.removeEventListener("click", onCreate);
        cancel.removeEventListener("click", onClose);
      };
      const onClose = (): void => {
        close();
        closeModal();
      };
      const onCreate = (): void => {
        close();
        void (async () => {
          create.setAttribute("disabled", "true");
          announce(status, "Creating load…");
          const firing = (dialog.querySelector('input[name="firing"]:checked') as HTMLInputElement)?.value ?? "bisque";
          try {
            const load = await api<LoadBody>("/api/loads", { method: "POST", body: { kiln_id: (kilnSelect as HTMLSelectElement).value, firing } });
            closeModal();
            state.load = load;
            announce(status, "Load created.");
            await reloadAll();
          } catch (err) {
            create.removeAttribute("disabled");
            if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
            else announce(status, "No connection. Check the studio wifi and try again.");
          }
        })();
      };
      create.addEventListener("click", onCreate);
      cancel.addEventListener("click", onClose);
      showModal(dialog, opener);
    })();
  }

  placeButton.addEventListener("click", () => {
    const ticket = state.waiting.find((t) => t.id === state.selectedTicketId);
    if (!ticket) return;
    openDeckDialog("Place piece", placeButton, ticket, (deck, close) => {
      void placePiece(ticket, deck).then(() => close());
    });
  });

  function openMoveDialog(opener: HTMLElement, piece: Ticket): void {
    openDeckDialog("Move piece", opener, piece, (deck, close) => {
      void movePiece(piece, deck).then(() => close());
    }, `MOVE ${piece.title}`);
  }

  function openDeckDialog(label: string, opener: HTMLElement, piece: Ticket, submit: (deck: number, close: () => void) => void, captionText?: string): void {
    if (!state.load) return;
    const deckSelect = h("div", { class: "deck-list", role: "listbox", "aria-label": "Deck", tabindex: "0" });
    const deckNumbers = state.load.decks.map((d) => d.number);
    let highlighted = 0;
    const renderOptions = (): void => {
      clear(deckSelect);
      deckNumbers.forEach((n, i) => {
        deckSelect.appendChild(h("div", { class: i === highlighted ? "deck-option selected" : "deck-option", role: "option", "aria-selected": i === highlighted ? "true" : "false", text: `Deck ${n}` }));
      });
    };
    renderOptions();
    deckSelect.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlighted = Math.min(deckNumbers.length - 1, highlighted + 1);
        renderOptions();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlighted = Math.max(0, highlighted - 1);
        renderOptions();
      }
    });
    const errorLine = h("div", { class: "field-error", role: "alert" });
    const confirm = h("button", { class: "btn primary", text: label === "Move piece" ? "Confirm move" : "Confirm placement" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    const dialog = h("div", { class: "dialog panel", "aria-label": label },
      h("div", { class: "caption", text: captionText ?? label.toUpperCase() }),
      deckSelect,
      errorLine,
      confirm,
      cancel);
    const close = (): void => {
      confirm.removeEventListener("click", onSubmit);
      cancel.removeEventListener("click", onClose);
    };
    const onClose = (): void => {
      close();
      closeModal();
    };
    const onSubmit = (): void => {
      const deck = deckNumbers[highlighted];
      submit(deck, () => {
        close();
        closeModal();
      });
    };
    confirm.addEventListener("click", onSubmit);
    cancel.addEventListener("click", onClose);
    showModal(dialog, opener);
  }

  unloadButton.addEventListener("click", () => openUnloadDialog(unloadButton));

  function openUnloadDialog(opener: HTMLElement): void {
    if (!state.load) return;
    const idempotencyKey = `unload-${crypto.randomUUID()}`;
    const pieces: Ticket[] = state.load.decks.flatMap((d) => d.pieces);
    if (pieces.length === 0) return;
    const dialog = h("div", { class: "dialog panel", "aria-label": "Unload" }, h("div", { class: "caption", text: "UNLOAD" }));
    const outcomes = new Map<string, string>();
    for (const piece of pieces) {
      const group = h("div", { class: "field", role: "radiogroup", "aria-label": `${piece.title} outcome` });
      outcomes.set(piece.id, "intact");
      for (const [label, value] of [["Intact", "intact"], ["Cracked", "cracked"], ["Damaged", "damaged"]] as [string, string][]) {
        const radio = h("input", { type: "radio", name: `outcome-${piece.id}`, value, checked: value === "intact" });
        radio.addEventListener("change", () => outcomes.set(piece.id, value));
        group.appendChild(h("div", { class: "radio-row" }, radio, h("label", { text: label })));
      }
      group.appendChild(h("div", { class: "muted small", text: piece.title }));
      dialog.appendChild(group);
    }
    const confirm = h("button", { class: "btn primary", text: "Confirm unload" });
    const cancel = h("button", { class: "btn", text: "Cancel" });
    dialog.append(confirm, cancel);
    const close = (): void => {
      confirm.removeEventListener("click", onSubmit);
      cancel.removeEventListener("click", onClose);
    };
    const onClose = (): void => {
      close();
      closeModal();
    };
    const onSubmit = (): void => {
      close();
      void (async () => {
        confirm.setAttribute("disabled", "true");
        announce(status, "Unloading…");
        const body: Record<string, string> = {};
        for (const piece of pieces) body[piece.id] = outcomes.get(piece.id) ?? "intact";
        try {
          const res = await api<{ load: LoadBody; charges: { status: string }[] }>(`/api/loads/${encodeURIComponent(state.load?.id ?? "")}/unload`, { method: "POST", body: { outcomes: body }, idempotencyKey });
          closeModal();
          state.load = null;
          const pending = res.charges.filter((c) => c.status === "pending").length;
          if (pending > 0) {
            announce(status, `Unloaded. ${pending} charges are waiting for billing and will settle automatically.`);
          } else {
            announce(status, `Unloaded. ${res.charges.length} charges settled; receipts follow by email.`);
          }
          await reloadAll();
        } catch (err) {
          confirm.removeAttribute("disabled");
          if (err instanceof ApiCallError && err.kind === "api") announce(status, err.body.message);
          else announce(status, "No connection. Check the studio wifi and try again.");
        }
      })();
    };
    confirm.addEventListener("click", onSubmit);
    cancel.addEventListener("click", onClose);
    showModal(dialog, opener);
  }

  registerRefresh(() => void onLiveUpdate());

  async function onLiveUpdate(): Promise<void> {
    // Another request's change: refetch and redraw to the server's latest values.
    await reloadAll();
  }
}

function roundedHeight(piece: Ticket): number {
  return Math.ceil(piece.height_in * 2 - 1e-9) / 2;
}

function roundedWidth(piece: Ticket): number {
  return Math.ceil(piece.length_in * 2 - 1e-9) / 2;
}
