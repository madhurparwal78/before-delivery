// The collection page with its share links, and the board.

import { api, apiFail, type ObjectJson, type ShareLinkJson, type BoardJson, ApiFailure } from "./api.js";
import { h, clearChildren, openDialog, announce, alertMessage, clearAlert } from "./dom.js";
import { state, screens, mainEl, navigate, updateTopbarTitle } from "./app.js";
import { MOTION, QUIRE_CURVE, BOARD } from "./constants.js";
import { reducedMotion } from "./dom.js";

export function openCollectionScreen(collectionId: string): void {
  screens.current = { dispose: () => undefined };
  const onEvent = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string };
    if (detail.event === "share_link.changed" || detail.event === "object.saved" || detail.event === "object.removed") {
      void load();
    }
  };
  document.addEventListener("quire-event", onEvent);
  screens.current = { dispose: () => document.removeEventListener("quire-event", onEvent) };
  void load();

  async function load(): Promise<void> {
    let name = "";
    let objects: ObjectJson[] = [];
    let links: ShareLinkJson[] = [];
    try {
      const res = await api<{ id: string; name: string; objects: ObjectJson[] }>("GET", `/api/collections/${collectionId}`);
      name = res.name;
      objects = res.objects;
      const linkRes = await api<{ share_links: ShareLinkJson[] }>("GET", `/api/collections/${collectionId}/share-links`);
      links = linkRes.share_links;
    } catch {
      const main = mainEl();
      clearChildren(main);
      main.append(h("h1", { text: "We can't find that note." }));
      return;
    }
    const main = mainEl();
    clearChildren(main);
    clearAlert();
    updateTopbarTitle(name);
    main.append(h("h1", { text: name }));
    main.append(h("button", { class: "ghost", onclick: () => void navigate(`/collections/${collectionId}/board`) }, "Board"));
    main.append(h("button", { class: "ghost", onclick: () => openShareDialog(collectionId) }, "Share collection"));
    const list = h("ul", { class: "collection-objects" });
    for (const object of objects) {
      list.append(h("li", {},
        h("a", { href: `/o/${object.id}`, onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/o/${object.id}`); } }, object.title),
        object.share_visibility === "never" ? " Never shared" : ""
      ));
    }
    main.append(list);
    // share links
    main.append(h("h2", { text: "Share links" }));
    const linkList = h("ul", { class: "share-links", "aria-label": "Share links" });
    for (const link of links) {
      const item = h("li", { class: `share-link ${link.status}` },
        h("span", { class: "share-link-status" }, link.status === "active" ? "Active" : link.status === "expired" ? "Expired" : "Revoked"),
        h("span", {}, `Expires ${link.expires_at_display}`),
        h("code", {}, link.url)
      );
      if (link.status === "active") {
        const copy = h("button", { class: "ghost", onclick: () => { void navigator.clipboard.writeText(`${location.origin}${link.url}`); } }, "Copy link");
        const revoke = h("button", { class: "ghost", onclick: () => confirmRevoke(link, collectionId) }, "Revoke link");
        const regen = h("button", { class: "ghost", onclick: () => regenerate(link, collectionId) }, "Regenerate link");
        item.append(copy, revoke, regen);
      }
      linkList.append(item);
    }
    main.append(linkList);
  }
}

async function confirmRevoke(link: ShareLinkJson, collectionId: string): Promise<void> {
  const confirmBtn = h("button", { class: "danger" }, "Revoke");
  const cancel = h("button", {}, "Cancel");
  const dialog = h("div", { role: "alertdialog", "aria-label": "Revoke this link?", class: "dialog" },
    h("h2", { text: "Revoke this link?" }),
    confirmBtn,
    cancel
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  cancel.addEventListener("click", () => dialog.dispatchEvent(new CustomEvent("dialog-close")));
  confirmBtn.addEventListener("click", async () => {
    try {
      await api("POST", `/api/share-links/${link.id}/revoke`);
      announce("Link revoked. Anyone using it now sees that it is no longer active.");
    } catch (e) {
      if (e instanceof ApiFailure && e.body.error === "link_not_active") {
        alertMessage("That share link is no longer active.");
      } else {
        alertMessage(apiFail(e, "id"));
      }
    }
    dialog.dispatchEvent(new CustomEvent("dialog-close"));
  });
  confirmBtn.focus();
}

async function regenerate(link: ShareLinkJson, collectionId: string): Promise<void> {
  try {
    await api("POST", `/api/share-links/${link.id}/regenerate`);
    announce("New link created. The old link no longer works.");
  } catch (e) {
    if (e instanceof ApiFailure && e.body.error === "link_not_active") {
      alertMessage("That share link is no longer active.");
    } else {
      alertMessage(apiFail(e, "id"));
    }
  }
}

function openShareDialog(collectionId: string): void {
  const input = h("input", { type: "datetime-local", "aria-label": "Link expires (home clock)" });
  const create = h("button", {}, "Create link");
  const error = h("div", { class: "field-error", "aria-live": "polite" });
  const dialog = h("div", { role: "dialog", "aria-label": "Share collection", class: "dialog" },
    h("h2", { text: "Share collection" }),
    h("label", {}, "Link expires (home clock) ", input),
    error,
    create
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  create.addEventListener("click", async () => {
    try {
      const res = await api<ShareLinkJson>("POST", `/api/collections/${collectionId}/share-links`, { expires_at: input.value });
      announce(`Link created. It stops working at ${res.expires_at_display}.`);
      dialog.dispatchEvent(new CustomEvent("dialog-close"));
    } catch (e) {
      error.textContent = apiFail(e, "expires_at");
    }
  });
  input.focus();
}

// ---------------------------------------------------------------------------
// The board

export function openBoard(collectionId: string): void {
  const onEvent = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string; data: Record<string, unknown> };
    if (detail.event === "board.saved") {
      const positions = detail.data.positions as Array<{ object_id: string; x: number; y: number }>;
      const other = String((detail.data as { session?: string }).session ?? "");
      void other;
      applyLiveMoves(positions);
    } else if (detail.event === "object.saved" || detail.event === "object.removed") {
      void load();
    }
  };
  document.addEventListener("quire-event", onEvent);
  screens.current = { dispose: () => document.removeEventListener("quire-event", onEvent) };
  let cards: BoardJson["cards"] = [];
  let edges: BoardJson["edges"] = [];
  let z = 1;
  let tx = 0;
  let ty = 0;
  const confirmed = new Map<string, { x: number; y: number }>();
  const drawn = new Map<string, { x: number; y: number }>();
  let viewport: HTMLElement | null = null;
  let surface: HTMLElement | null = null;
  let lasso: HTMLElement | null = null;
  const selection = new Set<string>();

  async function load(): Promise<void> {
    try {
      const board = await api<BoardJson>("GET", `/api/collections/${collectionId}/board`);
      cards = board.cards;
      edges = board.edges;
      for (const card of cards) confirmed.set(card.object_id, { x: card.x, y: card.y });
      render();
    } catch {
      const main = mainEl();
      clearChildren(main);
      main.append(h("h1", { text: "We can't find that note." }));
    }
  }

  function render(): void {
    const main = mainEl();
    clearChildren(main);
    clearAlert();
    const name = state.app?.collections.find((c) => c.id === collectionId)?.name ?? "Board";
    updateTopbarTitle(name);
    main.append(h("h1", { text: name }));
    surface = h("div", { role: "group", "aria-label": "Board", class: "board-surface", "data-board-viewport": "", "data-board-transform": "1.0000,0.0000,0.0000" });
    viewport = h("div", { class: "board-viewport" }, surface);
    main.append(h("h2", { class: "sr-only", text: "Board" }));
    main.append(viewport);
    for (const card of cards) {
      drawn.set(card.object_id, { x: card.x, y: card.y });
      surface.append(cardElement(card));
    }
    drawArrows();
    wireBoardEvents();
  }

  function cardElement(card: BoardJson["cards"][number]): HTMLElement {
    const el = h("button", {
      class: "board-card",
      "data-board-card": card.object_id,
      "aria-label": `${card.title}, x ${card.x}, y ${card.y}`,
      style: { left: "0px", top: "0px", width: `${BOARD.cardWidth}px`, height: `${BOARD.cardHeight}px` },
    }, card.title);
    place(el, card.x, card.y);
    return el;
  }

  function place(el: HTMLElement, x: number, y: number): void {
    el.style.left = `${x * z + tx}px`;
    el.style.top = `${y * z + ty}px`;
  }

  function transformLabel(): void {
    surface?.setAttribute("data-board-transform", `${z.toFixed(4)},${tx.toFixed(4)},${ty.toFixed(4)}`);
  }

  function allPlaced(): void {
    for (const card of cards) {
      const pos = drawn.get(card.object_id) ?? { x: card.x, y: card.y };
      const el = surface?.querySelector(`[data-board-card="${card.object_id}"]`) as HTMLElement | null;
      if (el !== null) {
        place(el, pos.x, pos.y);
        el.setAttribute("aria-label", `${card.title}, x ${pos.x}, y ${pos.y}${selection.has(card.object_id) ? ", selected" : ""}`);
      }
    }
    transformLabel();
    drawArrows();
  }

  /** Arrows between the closest side midpoints, recomputed every frame. */
  function drawArrows(): void {
    if (surface === null) return;
    surface.querySelectorAll("[data-board-arrow]").forEach((a) => a.remove());
    const cardPos = (id: string): { x: number; y: number; drawn: { x: number; y: number } } | null => {
      const card = cards.find((c) => c.object_id === id);
      if (card === undefined) return null;
      return { x: card.x, y: card.y, drawn: drawn.get(id) ?? { x: card.x, y: card.y } };
    };
    for (const edge of edges) {
      const from = cardPos(edge.from);
      const to = cardPos(edge.to);
      if (from === null || to === null) continue;
      const sides = (c: { x: number; y: number }): Array<{ x: number; y: number }> => [
        { x: c.x + BOARD.cardWidth / 2, y: c.y },
        { x: c.x + BOARD.cardWidth, y: c.y + BOARD.cardHeight / 2 },
        { x: c.x + BOARD.cardWidth / 2, y: c.y + BOARD.cardHeight },
        { x: c.x, y: c.y + BOARD.cardHeight / 2 },
      ];
      const fs = sides(from.drawn);
      const ts = sides(to.drawn);
      // the closest pair of side midpoints; ties go to the earliest sides
      let bestA = fs[0];
      let bestB = ts[0];
      let bestDist = Math.hypot(fs[0].x - ts[0].x, fs[0].y - ts[0].y);
      for (let fi = 0; fi < fs.length; fi += 1) {
        for (let ti = 0; ti < ts.length; ti += 1) {
          const dist = Math.hypot(fs[fi].x - ts[ti].x, fs[fi].y - ts[ti].y);
          if (dist < bestDist) {
            bestDist = dist;
            bestA = fs[fi];
            bestB = ts[ti];
          }
        }
      }
      const best = { a: bestA, b: bestB, dist: bestDist };
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("data-board-arrow", String(edge.id));
      line.setAttribute("x1", String((best.a.x * z + tx).toFixed(4)));
      line.setAttribute("y1", String((best.a.y * z + ty).toFixed(4)));
      line.setAttribute("x2", String((best.b.x * z + tx).toFixed(4)));
      line.setAttribute("y2", String((best.b.y * z + ty).toFixed(4)));
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("board-arrows");
      svg.setAttribute("aria-hidden", "true");
      svg.style.position = "absolute";
      svg.style.left = "0";
      svg.style.top = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      svg.append(line);
      surface?.append(svg);
    }
  }

  function wireBoardEvents(): void {
    if (surface === null || viewport === null) return;
    // pan and drag
    let mode: "none" | "pan" | "card" | "lasso" = "none";
    let startPointer = { x: 0, y: 0 };
    let startT = { tx, ty };
    let moved = 0;
    let draggedCards: string[] = [];
    let lassoRect = { x: 0, y: 0, w: 0, h: 0 };

    surface.addEventListener("pointerdown", (e: PointerEvent) => {
      const cardEl = (e.target as HTMLElement).closest("[data-board-card]") as HTMLElement | null;
      startPointer = { x: e.clientX, y: e.clientY };
      startT = { tx, ty };
      moved = 0;
      if (cardEl !== null && !e.shiftKey) {
        const id = cardEl.dataset.boardCard ?? "";
        if (!selection.has(id)) {
          selection.clear();
          selection.add(id);
        }
        mode = "card";
        draggedCards = [...selection];
        cardEl.focus();
      } else if (cardEl !== null && e.shiftKey) {
        mode = "none";
        const id = cardEl.dataset.boardCard ?? "";
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        allPlaced();
      } else if (e.shiftKey) {
        mode = "lasso";
        lassoRect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
      } else {
        mode = "pan";
      }
    });
    window.addEventListener("pointermove", (e: PointerEvent) => {
      if (mode === "none") return;
      const dx = e.clientX - startPointer.x;
      const dy = e.clientY - startPointer.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (mode === "pan") {
        tx = startT.tx + dx;
        ty = startT.ty + dy;
        allPlaced();
      } else if (mode === "card" && moved >= 4) {
        for (const id of draggedCards) {
          const base = confirmed.get(id) ?? { x: 0, y: 0 };
          const snappedX = clampSnap(8 * Math.floor((base.x + dx / z) / 8 + 0.5));
          const snappedY = clampSnap(8 * Math.floor((base.y + dy / z) / 8 + 0.5));
          drawn.set(id, { x: snappedX, y: snappedY });
        }
        allPlaced();
      } else if (mode === "lasso") {
        lassoRect.w = e.clientX - lassoRect.x;
        lassoRect.h = e.clientY - lassoRect.y;
        if (lasso === null) {
          lasso = h("div", { class: "board-lasso", "data-board-lasso": "", "aria-hidden": "true" });
          document.body.append(lasso);
        }
        lasso.style.left = `${Math.min(lassoRect.x, lassoRect.x + lassoRect.w)}px`;
        lasso.style.top = `${Math.min(lassoRect.y, lassoRect.y + lassoRect.h)}px`;
        lasso.style.width = `${Math.abs(lassoRect.w)}px`;
        lasso.style.height = `${Math.abs(lassoRect.h)}px`;
      }
    });
    window.addEventListener("pointerup", () => {
      if (mode === "card" && moved >= 4) {
        void savePositions(draggedCards);
      } else if (mode === "card" && moved < 4) {
        // a click selects the single card
        const id = draggedCards[0];
        selection.clear();
        if (id !== undefined) selection.add(id);
        allPlaced();
      } else if (mode === "lasso") {
        if (lasso !== null) {
          const lassoBox = lasso.getBoundingClientRect();
          lasso.remove();
          lasso = null;
          selection.clear();
          for (const card of cards) {
            const el = surface?.querySelector(`[data-board-card="${card.object_id}"]`) as HTMLElement | null;
            if (el === null) continue;
            const r = el.getBoundingClientRect();
            const intersects = !(r.right < lassoBox.left || r.left > lassoBox.right || r.bottom < lassoBox.top || r.top > lassoBox.bottom);
            if (intersects) selection.add(card.object_id);
          }
          allPlaced();
        }
      }
      mode = "none";
    });
    // wheel zoom about the pointer
    viewport.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? viewport!.clientHeight : e.deltaY;
      const nz = clamp(z * Math.pow(2, -delta / BOARD.wheelDivisor), BOARD.zoomMin, BOARD.zoomMax);
      const p = { x: e.clientX - (viewport?.getBoundingClientRect().left ?? 0), y: e.clientY - (viewport?.getBoundingClientRect().top ?? 0) };
      tx = p.x - (p.x - tx) * (nz / z);
      ty = p.y - (p.y - ty) * (nz / z);
      z = nz;
      allPlaced();
    }, { passive: false });
    // keyboard
    surface.addEventListener("keydown", (e: KeyboardEvent) => {
      const cardEl = (e.target as HTMLElement).closest("[data-board-card]") as HTMLElement | null;
      if (cardEl === null) return;
      const id = cardEl.dataset.boardCard ?? "";
      const base = drawn.get(id) ?? confirmed.get(id) ?? { x: 0, y: 0 };
      if (e.key === "+" || e.key === "=" || e.key === "-") {
        e.preventDefault();
        const group = surface?.getBoundingClientRect();
        const p = { x: (group?.width ?? 0) / 2, y: (group?.height ?? 0) / 2 };
        const nz = clamp(z * Math.pow(2, (e.key === "-" ? 100 : -100) / BOARD.wheelDivisor), BOARD.zoomMin, BOARD.zoomMax);
        tx = p.x - (p.x - tx) * (nz / z);
        ty = p.y - (p.y - ty) * (nz / z);
        z = nz;
        allPlaced();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        allPlaced();
        return;
      }
      if (e.key === "Escape") {
        selection.clear();
        allPlaced();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        cards.forEach((c) => selection.add(c.object_id));
        allPlaced();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void navigate(`/o/${id}`);
        return;
      }
      const step = e.shiftKey ? BOARD.keyNudgeLarge : BOARD.keyNudge;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      const targets = selection.has(id) ? [...selection] : [id];
      for (const t of targets) {
        const b = drawn.get(t) ?? confirmed.get(t) ?? { x: 0, y: 0 };
        drawn.set(t, { x: clampSnap(b.x + dx), y: clampSnap(b.y + dy) });
      }
      allPlaced();
      window.clearTimeout(nudgeTimer);
      nudgeTimer = window.setTimeout(() => {
        void savePositions(targets);
      }, BOARD.saveDebounce);
    });
  }

  let nudgeTimer = 0;

  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  function clampSnap(v: number): number {
    return clamp(8 * Math.round(v / 8), -BOARD.limit, BOARD.limit);
  }

  async function savePositions(ids: string[]): Promise<void> {
    const positions = ids
      .map((id) => ({ object_id: id, x: drawn.get(id)?.x ?? 0, y: drawn.get(id)?.y ?? 0 }))
      .filter((p) => cards.some((c) => c.object_id === p.object_id));
    if (positions.length === 0) return;
    try {
      const res = await api<BoardJson>("PUT", `/api/collections/${collectionId}/board`, { positions });
      for (const card of res.cards) confirmed.set(card.object_id, { x: card.x, y: card.y });
      const n = positions.length;
      const first = cards.find((c) => c.object_id === positions[0].object_id);
      if (first !== undefined && n === 1) {
        announce(`Moved ${first.title} to x ${positions[0].x}, y ${positions[0].y}.`);
      } else {
        announce(`Moved ${n} cards.`);
      }
    } catch (e) {
      alertMessage("Those cards couldn't be moved.");
      // slide back to the last confirmed positions
      for (const id of ids) {
        const c = confirmed.get(id);
        if (c !== undefined) drawn.set(id, { ...c });
        const el = surface?.querySelector(`[data-board-card="${id}"]`) as HTMLElement | null;
        if (el !== null && c !== undefined) {
          if (!reducedMotion()) {
            el.animate(
              [
                { left: el.style.left, top: el.style.top },
                { left: `${c.x * z + tx}px`, top: `${c.y * z + ty}px` },
              ],
              { duration: MOTION.refusalSlide, easing: QUIRE_CURVE }
            ).onfinish = () => {
              place(el, c.x, c.y);
              drawArrows();
            };
          } else {
            place(el, c.x, c.y);
            drawArrows();
          }
        }
      }
    }
  }

  function applyLiveMoves(positions: Array<{ object_id: string; x: number; y: number }>): void {
    for (const p of positions) {
      const c = cards.find((x) => x.object_id === p.object_id);
      if (c === undefined) continue;
      const el = surface?.querySelector(`[data-board-card="${p.object_id}"]`) as HTMLElement | null;
      if (el === null) continue;
      const dragging = el.matches(":active");
      if (dragging) continue; // a card this tab drags stays under the pointer
      c.x = p.x;
      c.y = p.y;
      confirmed.set(p.object_id, { x: p.x, y: p.y });
      drawn.set(p.object_id, { x: p.x, y: p.y });
      if (!reducedMotion()) {
        el.animate(
          [
            { left: el.style.left, top: el.style.top },
            { left: `${p.x * z + tx}px`, top: `${p.y * z + ty}px` },
          ],
          { duration: MOTION.remoteSlide, easing: QUIRE_CURVE }
        ).onfinish = () => {
          place(el, p.x, p.y);
          drawArrows();
        };
      } else {
        place(el, p.x, p.y);
      }
      el.setAttribute("aria-label", `${c.title}, x ${p.x}, y ${p.y}${selection.has(p.object_id) ? ", selected" : ""}`);
    }
    drawArrows();
  }

  void load();
}
