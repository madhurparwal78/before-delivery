// A request card on the board: ref and times, four gate pips, seat sockets and the rolling seat counter.
import type { GateResult, RequestView } from "../../shared/api.js";
import { GATES, SETTING_LABELS } from "../../shared/domain.js";
import { agencyTime, cardDate } from "../../shared/time.js";
import { h, prefersReducedMotion, replace, svg } from "../dom.js";

type PipState = "unchecked" | "pending" | "pass" | "fail";

const ROLL_MS = 200;

/** The tick and cross drawn inside a gate pip or seat socket; CSS shows the one its state needs. */
export function mark(): SVGSVGElement {
  return svg(
    "svg",
    { class: "pip-mark", viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" },
    svg("path", { class: "tick", d: "M2.5 6.4 L5 8.8 L9.6 3.4", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }),
    svg("path", { class: "cross", d: "M3.4 3.4 L8.6 8.6 M8.6 3.4 L3.4 8.6", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" }),
  );
}

export class Card {
  readonly el: HTMLElement;
  request: RequestView;
  private readonly top = h("p", { class: "card-top" });
  private readonly title = h("h3", { class: "card-title" });
  private readonly meta = h("p", { class: "card-meta" });
  private readonly windowMark = h("p", { class: "window-mark" }, "In cancellation window");
  private readonly pipList: HTMLUListElement;
  private readonly pips: HTMLLIElement[];
  private readonly sockets = h("div", { class: "sockets" });
  private readonly reel = h("span", { class: "reel" });
  private readonly total = h("span", {});
  private readonly note = h("p", { class: "card-note" });

  constructor(request: RequestView) {
    this.request = request;
    this.pips = GATES.map(({ label }, i) =>
      h("li", { class: "pip", "data-state": "unchecked", style: `--i: ${i}`, "aria-label": `${label}: unchecked` }, h("span", { class: "pip-dot" }, mark()), h("span", { class: "pip-label" }, label)),
    );
    this.pipList = h("ul", { class: "pips", "data-motion": "instant", "aria-label": `Gates for ${request.ref}` }, this.pips);
    this.el = h(
      "article",
      { class: "card", tabindex: "0", "data-id": request.id },
      this.top,
      this.title,
      h("div", { class: "card-sub" }, this.meta, this.windowMark),
      h(
        "div",
        { class: "card-gates" },
        this.pipList,
        h("div", { class: "card-foot" }, this.sockets, h("span", { class: "counter fig" }, h("span", { class: "roll" }, this.reel), "/", this.total)),
      ),
      this.note,
    );
    this.reel.append(String(request.seats_claimed));
    this.render();
  }

  private render(): void {
    const r = this.request;
    const start = new Date(r.start);
    this.el.setAttribute("aria-label", `${r.ref} ${r.title}`);
    this.el.classList.toggle("in-window", r.in_cancellation_window);
    replace(
      this.top,
      h("span", { class: "fig ref" }, r.ref),
      h("span", { class: "fig time" }, `${agencyTime(start)}–${agencyTime(new Date(r.end))}`),
      h("span", { class: "date" }, cardDate(start)),
      h("span", { class: "state" }, r.status),
    );
    this.windowMark.hidden = !r.in_cancellation_window;
    this.title.textContent = r.title;
    this.meta.textContent = `${SETTING_LABELS[r.setting]} · ${r.org_name} · ${r.consumer.name}`;
    this.total.textContent = String(r.seats_total);
    const sockets = [...r.seats].sort((a, b) => a.position - b.position);
    if (this.sockets.children.length !== sockets.length) {
      replace(
        this.sockets,
        sockets.map((s) => h("button", { type: "button", class: "socket", tabindex: "-1", "data-position": String(s.position) }, h("span", { class: "socket-dot" }, mark()))),
      );
    }
    sockets.forEach((s, i) => {
      const button = this.sockets.children[i];
      if (!(button instanceof HTMLButtonElement)) return;
      button.dataset.state = s.status;
      button.setAttribute("aria-label", `Seat ${s.position} of ${r.seats_total} for ${r.ref}`);
      button.title = s.interpreter ? `Seat ${s.position}: ${s.status}, ${s.interpreter.name}` : `Seat ${s.position}: open`;
    });
  }

  update(request: RequestView): void {
    const before = this.request.seats_claimed;
    this.request = request;
    this.render();
    if (request.seats_claimed !== before) this.roll(before, request.seats_claimed);
  }

  /** The claimed numeral rolls: the old figure slides up and out while the new one slides in. */
  private roll(from: number, to: number): void {
    for (const a of this.reel.getAnimations()) a.finish();
    if (prefersReducedMotion()) {
      replace(this.reel, String(to));
      return;
    }
    const up = to > from;
    const old = h("span", { class: "num" }, String(from));
    const next = h("span", { class: "num" }, String(to));
    replace(this.reel, ...(up ? [old, next] : [next, old]));
    const frames = up ? [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }] : [{ transform: "translateY(-50%)" }, { transform: "translateY(0)" }];
    // At rest the reel holds bare text, so the counter reads "1/1" as one run.
    const done = (): void => replace(this.reel, String(to));
    this.reel.animate(frames, { duration: ROLL_MS, easing: "cubic-bezier(.2,.7,.2,1)" }).finished.then(done, done);
  }

  /** Sets the four pips; a resolved answer staggers left to right unless motion is reduced. */
  pipsTo(state: "unchecked" | "pending" | GateResult[]): void {
    const resolved = Array.isArray(state);
    this.pipList.dataset.motion = resolved && !prefersReducedMotion() ? "stagger" : "instant";
    this.pips.forEach((pip, i) => {
      const label = GATES[i]?.label ?? "";
      const value: PipState = resolved ? (state[i]?.pass ? "pass" : "fail") : state;
      pip.dataset.state = value;
      pip.setAttribute("aria-label", `${label}: ${value === "pending" ? "unchecked" : value}`);
    });
  }

  /** Finishes any pip stagger still running. */
  settlePips(): void {
    for (const a of this.pipList.getAnimations({ subtree: true })) a.finish();
  }

  /** Inline text under the card: a failing gate's reason (signal colour) or a refusal. */
  say(text: string, kind: "gate" | "info"): void {
    this.note.textContent = text;
    this.note.dataset.kind = kind;
    if (!prefersReducedMotion()) this.note.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
  }

  clearNote(): void {
    this.note.textContent = "";
  }

  socketCenter(position: number): { x: number; y: number } {
    const socket = this.sockets.querySelector(`[data-position="${position}"]`) ?? this.sockets;
    const box = socket.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
}
