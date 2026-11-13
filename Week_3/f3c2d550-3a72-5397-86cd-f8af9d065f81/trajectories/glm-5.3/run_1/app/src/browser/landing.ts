// Landing: the hero, the three bundled demo sections and the demo fader.
// The demo stops are bundled with the app and never read from the database or
// storage, so Landing ignores the saved unit and the effective home zone.

import type { ScreenContext } from "./main.js";
import { el, text, buildTile, announce, clearAnnouncer, deckStatus, type TileParts, finishSwapAtOnce, faderPullSwap } from "./dom.js";
import { buildFader, type FaderParts } from "./fader.js";
import { COPY, announcer } from "./copy.js";

interface DemoStop {
  title: string;
  maker: string;
  year: number;
  sizeLine: string;
  photo: string;
  swatch: string;
  about: string;
}

// The three bundled demo stops in seed order, with millimetre size lines.
const DEMO_STOPS: DemoStop[] = [
  { title: "Desk radio", maker: "Braunfeld", year: 1971,
    sizeLine: "236.0 × 152.0 × 98.0 mm", photo: "/demo-radio.jpg",
    swatch: "#767377", about: "Matte textured shell with a brushed fascia; the grille sets the rhythm." },
  { title: "Pocket calculator", maker: "Orrin Electronics", year: 1977,
    sizeLine: "136.0 × 78.0 × 9.5 mm", photo: "/demo-calculator.jpg",
    swatch: "#4c514f", about: "Two-shot PBT keycaps over an ABS frame; the satin finish hides prints." },
  { title: "Enamel kettle", maker: "Halvorsen Emalje", year: 1964,
    sizeLine: "210.0 × 190.0 × 160.0 mm", photo: "/demo-kettle.jpg",
    swatch: "#d6712b", about: "Gloss enamel over steel, a beech handle and no visible fasteners." },
];

export class LandingScreen {
  private tile: TileParts;
  private fader: FaderParts;
  private index = 0;
  private sections: HTMLElement[] = [];
  private swapTimer: number | null = null;
  private settling = false;

  constructor(private ctx: ScreenContext) {
    const hero = el("div", { class: "hero" });
    const h1 = text("h1", COPY.headline);
    h1.setAttribute("aria-label", COPY.headline);
    const sentence = text("p", COPY.heroSentence, { class: "sentence" });
    const open = el("a", { href: "/library", class: "btn primary" });
    open.textContent = "Open your deck";
    hero.append(h1, sentence, open);
    const sections = el("div", { class: "section-list" });
    DEMO_STOPS.forEach((stop) => {
      const section = el("section");
      const h3 = text("h3", stop.title);
      const meta = text("p", `${stop.maker}, ${stop.year} · ${stop.sizeLine}`, { class: "line" });
      const about = text("p", stop.about, { class: "line" });
      section.append(h3, meta, about);
      sections.append(section);
      this.sections.push(section);
    });
    ctx.main.append(hero, sections);

    this.tile = buildTile("Current reference");
    const standIn = text("p", COPY.standInNote, { class: "stand-in-note" });
    this.tile.figure.append(standIn);
    ctx.field.append(this.tile.figure);

    this.fader = buildFader((index) => this.change(index));
    this.fader.root.setAttribute("aria-hidden", "true");
    this.fader.setStops(DEMO_STOPS.length);
    this.fader.setPosition(0, false);
    this.fader.input.setAttribute("aria-label", "Reel position");
    ctx.field.append(this.fader.root);

    this.show(0, false);
    clearAnnouncer();
    this.bindScroll();
    this.bindShortcuts();
  }

  private content(index: number) {
    const stop = DEMO_STOPS[index];
    return { swatch: stop.swatch, photoUrl: stop.photo, name: stop.title, sizeLine: stop.sizeLine };
  }

  private show(index: number, animate: boolean): void {
    const stop = DEMO_STOPS[index];
    const content = this.content(index);
    if (animate) {
      faderPullSwap(this.tile, this.content(this.index), content, index >= this.index ? 1 : -1);
    } else {
      finishSwapAtOnce(this.tile, content);
    }
    this.index = index;
    // The slider's value text is the sentence the announcer speaks.
    this.fader.input.setAttribute(
      "aria-valuetext",
      announcer(index + 1, DEMO_STOPS.length, stop.title, stop.maker, stop.year),
    );
  }

  private change(index: number): void {
    if (index === this.index || this.settling) return;
    // Rapid input: the running swap jumps to its end state at once.
    if (this.swapTimer !== null) {
      window.clearTimeout(this.swapTimer);
      this.swapTimer = null;
      finishSwapAtOnce(this.tile, this.content(this.index));
    }
    const previous = this.index;
    this.show(index, true);
    this.fader.setPosition(index);
    // Scroll binding: the new stop's row top sits at the viewport middle.
    this.scrollToSection(index);
    const stop = DEMO_STOPS[index];
    announce(announcer(index + 1, DEMO_STOPS.length, stop.title, stop.maker, stop.year));
    this.swapTimer = window.setTimeout(() => { this.swapTimer = null; }, 360);
    void previous;
  }

  private scrollToSection(index: number): void {
    const section = this.sections[index];
    if (!section) return;
    const scroller = this.ctx.textCol;
    const target = section.offsetTop - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  }

  private bindScroll(): void {
    let programmatic = false;
    const scroller = this.ctx.textCol;
    const onScroll = () => {
      if (programmatic) { programmatic = false; return; }
      const middle = scroller.clientHeight / 2;
      let current = 0;
      this.sections.forEach((section, i) => {
        if (section.offsetTop - scroller.scrollTop <= middle) current = i;
      });
      if (current !== this.index) {
        this.fader.setPosition(current);
        this.show(current, true);
        const stop = DEMO_STOPS[current];
        announce(announcer(current + 1, DEMO_STOPS.length, stop.title, stop.maker, stop.year));
      }
    };
    scroller.addEventListener("scroll", () => {
      window.requestAnimationFrame(onScroll);
    });
    const originalScroll = this.scrollToSection.bind(this);
    this.scrollToSection = (index: number) => {
      programmatic = true;
      originalScroll(index);
    };
  }

  private bindShortcuts(): void {
    document.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // The shortcuts work whichever control in the field or text column has
    // focus, but never while a text field has focus or a dialog is open.
    if (target?.matches?.("input:not([type='range']), textarea, select")) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === "]") { this.change(Math.min(DEMO_STOPS.length - 1, this.index + 1)); }
    if (e.key === "[") { this.change(Math.max(0, this.index - 1)); }
  };
}
