import { all, play, whenFinished } from "./dom.js";

/** A modal dialog: the page behind it is inert, Tab wraps inside, Escape and the backdrop close it, and focus returns to
 * its opener in the same moment. Closed means hidden and inert at once; only the exit animation lingers. */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

interface ModalMotion {
  readonly enter: Keyframe[];
  readonly exit: Keyframe[];
  readonly durationMs: number;
}

export class Modal {
  private opened = false;
  private opener: HTMLElement | undefined;
  private exit: Animation | undefined;

  constructor(
    private readonly layer: HTMLElement,
    private readonly dialog: HTMLElement,
    private readonly siteRoot: HTMLElement,
    private readonly motion: ModalMotion,
    private readonly onChange: (open: boolean) => void,
  ) {
    layer.addEventListener("click", (event) => {
      if (event.target === layer) this.close(true);
    });
    document.addEventListener("keydown", (event) => this.onKey(event));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(opener: HTMLElement, focusTarget: () => HTMLElement): void {
    this.exit?.cancel();
    this.exit = undefined;
    this.opener = opener;
    this.layer.hidden = false;
    this.layer.inert = false;
    this.layer.removeAttribute("aria-hidden");
    this.siteRoot.inert = true;
    this.opened = true;
    this.onChange(true);
    focusTarget().focus({ preventScroll: true });
    play(this.dialog, this.motion.enter, { duration: this.motion.durationMs, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  }

  close(restoreFocus: boolean): void {
    if (!this.opened) return;
    this.opened = false;
    this.siteRoot.inert = false;
    this.layer.inert = true;
    this.layer.setAttribute("aria-hidden", "true");
    this.onChange(false);
    if (restoreFocus) this.opener?.focus({ preventScroll: true });
    this.exit = play(this.dialog, this.motion.exit, { duration: this.motion.durationMs, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" });
    whenFinished(this.exit, () => {
      if (!this.opened) this.layer.hidden = true;
    });
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.opened) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const stops = all<HTMLElement>(this.dialog, FOCUSABLE).filter((stop) => !stop.hidden && stop.closest("[hidden], [inert]") === null);
    const first = stops[0];
    const last = stops.at(-1);
    if (first === undefined || last === undefined) return;
    const inside = this.dialog.contains(document.activeElement);
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }
}
