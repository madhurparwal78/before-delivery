import { reducedMotion } from "../ui.js";

interface PlacedCard { id: string; el: HTMLElement; signature: string; colour: string; hasRange: boolean }

const GAP = 8;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const SVG = "http://www.w3.org/2000/svg";

/**
 * The Margin (Motion and effects, the margin tether): cards in page order, each card's top level with
 * the first line of its range, crowded cards stacked 8 px apart, and a 1 px tether in the author's
 * colour from the range's last line to the card. Settled cards fold while the cards below glide up.
 */
export class Margin {
  private cards = new Map<string, PlacedCard>();
  private order: string[] = [];
  private tethers = new Map<string, SVGPathElement>();
  private lastTop = new Map<string, number>();
  private looping = false;
  private ready = false;
  stacked = true;

  constructor(private host: HTMLElement, private svg: SVGSVGElement, private page: HTMLElement) {}

  /** Keyed update: new cards fade in, changed cards rebuild, missing ones leave (see `settle`). */
  update(list: { id: string; signature: string; colour: string; hasRange: boolean; build: () => HTMLElement }[]): void {
    const seen = new Set<string>();
    for (const item of list) {
      seen.add(item.id);
      const known = this.cards.get(item.id);
      if (known && known.signature === item.signature) { known.hasRange = item.hasRange; continue; }
      const el = item.build();
      if (known || !this.ready) el.classList.add("settled");
      if (known) {
        const focusInside = known.el.contains(document.activeElement);
        el.style.top = known.el.style.top;
        known.el.replaceWith(el);
        if (focusInside) el.focus({ preventScroll: true });
      }
      this.cards.set(item.id, { id: item.id, el, signature: item.signature, colour: item.colour, hasRange: item.hasRange });
    }
    for (const id of [...this.cards.keys()]) if (!seen.has(id)) this.drop(id, false);
    this.order = list.map((c) => c.id);
    this.ready = true;
    const els = this.order.map((id) => this.cards.get(id)?.el).filter((e): e is HTMLElement => Boolean(e));
    const closing = [...this.host.children].filter((c) => c.classList.contains("closing"));
    if (els.some((e, i) => this.host.children[i] !== e) || this.host.children.length !== els.length + closing.length) this.host.replaceChildren(...els, ...closing);
  }

  card(id: string): HTMLElement | undefined { return this.cards.get(id)?.el; }
  ids(): string[] { return [...this.order]; }

  private anchorRects(id: string): DOMRect[] {
    return [...this.page.querySelectorAll(`[data-anchor-for="${CSS.escape(id)}"]`)]
      .flatMap((s) => [...s.getClientRects()]).filter((r) => r.width > 0 && r.height > 0);
  }

  /** Places every card and redraws the tethers in the same frame as the text reflow. */
  layout(): void {
    if (!this.stacked) {
      for (const c of this.cards.values()) c.el.style.top = "";
      this.host.style.height = "";
      for (const t of this.tethers.values()) t.remove();
      this.tethers.clear();
      return;
    }
    const origin = this.host.getBoundingClientRect().top;
    let bottom = -Infinity;
    for (const id of this.order) {
      const c = this.cards.get(id);
      if (!c) continue;
      const rects = this.anchorRects(id);
      const desired = rects.length ? Math.min(...rects.map((r) => r.top)) - origin : this.lastTop.get(id) ?? Math.max(0, bottom + GAP);
      if (rects.length) this.lastTop.set(id, desired);
      const top = Math.max(desired, bottom + GAP);
      const px = `${Math.round(top * 100) / 100}px`;
      if (c.el.style.top !== px) c.el.style.top = px;
      bottom = top + c.el.offsetHeight;
    }
    this.host.style.height = `${Math.max(0, bottom + GAP)}px`;
    this.drawTethers();
  }

  drawTethers(): void {
    if (!this.stacked) return;
    const box = this.svg.getBoundingClientRect();
    const pageRight = this.page.getBoundingClientRect().right;
    const live = new Set<string>();
    for (const id of this.order) {
      const c = this.cards.get(id);
      const rects = c ? this.anchorRects(id) : [];
      if (!c || !rects.length) continue;
      live.add(id);
      const lastTop = Math.max(...rects.map((r) => r.top));
      const line = rects.filter((r) => Math.abs(r.top - lastTop) < 1);
      const x1 = Math.max(...line.map((r) => r.right)) - box.left;
      const y1 = Math.max(...line.map((r) => r.bottom)) - box.top - 3;
      const card = c.el.getBoundingClientRect();
      const x2 = card.left - box.left;
      const y2 = card.top - box.top + 16;
      const xg = Math.min(Math.max(x1, pageRight - box.left + 8), x2);
      const mid = (xg + x2) / 2;
      const d = `M ${x1} ${y1} L ${xg} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      let path = this.tethers.get(id);
      if (!path) {
        path = document.createElementNS(SVG, "path");
        path.setAttribute("data-tether-for", id);
        path.setAttribute("class", "tether");
        this.svg.append(path);
        this.tethers.set(id, path);
      }
      path.style.stroke = c.colour;
      path.classList.toggle("tether-focus", c.el.classList.contains("is-focused"));
      if (path.getAttribute("d") !== d) path.setAttribute("d", d);
    }
    for (const [id, path] of this.tethers) if (!live.has(id)) { path.remove(); this.tethers.delete(id); }
  }

  /** Redraw tethers on every frame while cards move. */
  follow(): void {
    if (this.looping) return;
    this.looping = true;
    const tick = (): void => {
      this.drawTethers();
      const moving = this.host.getAnimations({ subtree: true }).some((a) => a.playState === "running");
      if (moving) requestAnimationFrame(tick);
      else this.looping = false;
    };
    requestAnimationFrame(tick);
  }

  /** Focus look without motion bookkeeping (used after every render). */
  setFocusedSilently(id: string | null): void {
    for (const c of this.cards.values()) c.el.classList.toggle("is-focused", c.id === id);
  }

  setFocused(id: string | null): void {
    this.setFocusedSilently(id);
    for (const s of this.page.querySelectorAll(".anc")) s.classList.toggle("anc-focus", (s as HTMLElement).dataset.anchorFor === id);
    this.drawTethers();
    this.follow();
    for (const c of this.cards.values()) {
      if (c.id !== id) continue;
      c.el.addEventListener("transitionend", () => this.drawTethers(), { once: true });
    }
  }

  /** A card left (card_closed): fold it shut while the cards below glide up with tethers attached. */
  settle(id: string): void { this.drop(id, true); }

  private drop(id: string, animate: boolean): void {
    const c = this.cards.get(id);
    if (!c) return;
    this.cards.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.tethers.get(id)?.remove();
    this.tethers.delete(id);
    if (!animate || reducedMotion() || !this.stacked) {
      c.el.remove();
      this.layout();
      return;
    }
    const before = new Map([...this.cards.values()].map((o) => [o.id, o.el.getBoundingClientRect().top]));
    const height = c.el.offsetHeight;
    c.el.classList.add("closing");
    c.el.removeAttribute("tabindex");
    this.layout();
    const timing = { duration: 333, delay: 250, easing: EASE };
    for (const o of this.cards.values()) {
      const dy = (before.get(o.id) ?? 0) - o.el.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) continue;
      o.el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { ...timing, fill: "backwards" })
        .finished.then(() => this.drawTethers(), () => undefined);
    }
    c.el.animate([{ height: `${height}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { ...timing, fill: "forwards" })
      .finished.then(() => c.el.remove(), () => c.el.remove());
    this.follow();
  }
}
