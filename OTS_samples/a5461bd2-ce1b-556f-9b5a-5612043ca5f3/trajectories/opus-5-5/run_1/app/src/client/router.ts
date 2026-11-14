import { moveFocus } from "./focus.js";
import type { Menu } from "./menu.js";
import { mountContact } from "./pages/contact.js";
import { mountFaq } from "./pages/faq.js";
import { mountPricing } from "./pages/pricing.js";
import { mountProject } from "./pages/project.js";
import { mountServices } from "./pages/services.js";
import { mountWork } from "./pages/work.js";
import { Stage } from "./stage.js";
import { emptyAnswers, renderMain } from "../shared/render.js";
import {
  currentSection,
  pageTitle,
  parseContactQuery,
  parseFaqQuery,
  parseGalleryQuery,
  parsePriceQuery,
  parseRoute,
  type Route,
  type RouteKind,
} from "../shared/routes.js";
import type { Bootstrap } from "../shared/types.js";

export interface PageContext {
  bootstrap: Bootstrap;
  main: HTMLElement;
  url: URL;
}

export interface MountedPage {
  unmount?: () => void;
  /** Overrides where focus goes when the page appears. */
  focus?: HTMLElement | null;
}

type Controller = (context: PageContext) => MountedPage;

type How = "initial" | "push" | "pop";
type Intent = "enter" | "leave" | null;

const FILE_PREFIXES = ["/api/", "/scenes/", "/media/", "/assets/"];

export class Router {
  private readonly bootstrap: Bootstrap;
  private readonly main: HTMLElement;
  private readonly menu: Menu;
  private route: Route | null = null;
  private mounted: MountedPage = {};
  private stage: Stage | null = null;
  private readonly controllers: Partial<Record<RouteKind, Controller>>;

  constructor(bootstrap: Bootstrap, main: HTMLElement, menu: Menu) {
    this.bootstrap = bootstrap;
    this.main = main;
    this.menu = menu;
    this.controllers = {
      world: (context) => this.mountWorld(context),
      work: mountWork,
      project: mountProject,
      services: mountServices,
      pricing: mountPricing,
      faq: mountFaq,
      contact: mountContact,
    };
  }

  start(): void {
    history.scrollRestoration = "manual";
    document.addEventListener("click", (event) => this.onLinkClick(event));
    window.addEventListener("popstate", () => this.show(new URL(location.href), "pop", null));
    this.show(new URL(location.href), "initial", null);
  }

  navigate(href: string): void {
    const url = new URL(href, location.href);
    history.pushState(null, "", url);
    this.show(url, "push", null);
  }

  enterWorld(slug: string): void {
    const url = new URL(`/worlds/${slug}`, location.href);
    history.pushState(null, "", url);
    this.show(url, "push", "enter");
  }

  leaveWorld(): void {
    const url = new URL("/", location.href);
    history.pushState(null, "", url);
    this.show(url, "push", "leave");
  }

  private onLinkClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (link === null || link.target !== "" || link.hasAttribute("download")) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || FILE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
    event.preventDefault();
    if (link.classList.contains("skip-link")) {
      moveFocus(this.main.querySelector<HTMLElement>("h1"));
      return;
    }
    this.navigate(url.href);
  }

  private show(url: URL, how: How, intent: Intent): void {
    const { content, settings } = this.bootstrap;
    const from = this.route;
    const to = parseRoute(url.pathname, content);
    this.route = to;
    document.title = pageTitle(to, content);
    this.mounted.unmount?.();
    this.menu.close(false);
    if (how === "initial") {
      for (const image of this.main.querySelectorAll<HTMLImageElement>(".media-img")) {
        if (image.complete && image.naturalWidth === 0) image.closest(".media-frame")?.classList.add("failed");
      }
    } else {
      const prefill = parseContactQuery(url.searchParams, content);
      this.main.className = `route-${to.kind}`;
      this.main.innerHTML = renderMain(to, content, {
        gallery: parseGalleryQuery(url.searchParams, content),
        workPageSize: settings.workPageSize,
        prices: parsePriceQuery(url.searchParams, content),
        faqOpen: parseFaqQuery(url.searchParams, content),
        contact: { ...emptyAnswers(), service: prefill.service, item: prefill.item },
      });
      this.markCurrent(to);
    }

    const slot = this.main.querySelector(".stage-slot");
    let leaving = false;
    if (to.kind === "home" || to.kind === "world") {
      this.stage ??= new Stage(content, (slug) => this.enterWorld(slug));
      if (slot === null) throw new Error("Stage slot missing");
      if (to.kind === "home") {
        leaving = from?.kind === "world" && (intent === "leave" || how === "pop");
        const section = this.main.querySelector<HTMLElement>('[data-section="worlds"]');
        if (section === null) throw new Error("Worlds section missing");
        this.stage.showHome(slot, section, leaving ? "leave" : "fresh");
      } else {
        const kind = from?.kind === "world" ? "between" : from?.kind === "home" ? "enter" : "direct";
        this.stage.showWorld(slot, to.slug, how === "initial" ? "direct" : kind);
      }
    } else {
      this.stage?.hide();
    }

    const controller = this.controllers[to.kind];
    this.mounted = controller?.({ bootstrap: this.bootstrap, main: this.main, url }) ?? {};

    if (this.mounted.focus !== undefined) {
      if (how !== "initial") window.scrollTo(0, 0);
      moveFocus(this.mounted.focus);
      return;
    }
    if (how === "initial" || leaving) return;
    if (to.kind === "work" && from?.kind === "project") {
      const tile = this.main.querySelector<HTMLElement>(`a[data-project="${from.slug}"]`);
      if (tile !== null) {
        moveFocus(tile);
        return;
      }
    }
    window.scrollTo(0, 0);
    moveFocus(this.main.querySelector<HTMLElement>("h1"));
  }

  private markCurrent(route: Route): void {
    const section = currentSection(route);
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-nav]")) {
      if (link.dataset.nav === section) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  private mountWorld({ main }: PageContext): MountedPage {
    const listeners = new AbortController();
    main
      .querySelector(".back-to-worlds")
      ?.addEventListener("click", () => this.leaveWorld(), { signal: listeners.signal });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || this.menu.isOpen()) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
        if (active instanceof HTMLElement && active.isContentEditable) return;
        event.preventDefault();
        this.leaveWorld();
      },
      { signal: listeners.signal },
    );
    return { unmount: () => listeners.abort() };
  }
}
