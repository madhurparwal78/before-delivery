import { el, api } from "./dom.js";
import { PARTNERS } from "../shared/constants.js";
import { DURATIONS, animate, prefersReducedMotion } from "./motion.js";

export type SessionUser = {
  id: string;
  name: string;
  role: string;
  home: string;
};

export async function loadSession(): Promise<SessionUser | null> {
  const result = await api<{ user: { id: string; name: string; role: string }; home: string }>("/api/session");
  if (!result.ok) return null;
  return { ...result.data.user, home: result.data.home };
}

/** The public header with the Explore mega menu and scroll-solid state. */
export function publicHeader(session: SessionUser | null): HTMLElement {
  const nav = el("nav", { id: "main-nav", "aria-label": "Main", class: "main-nav" });
  const exploreButton = el("button", {
    type: "button",
    class: "nav-link",
    "aria-expanded": "false",
    "aria-haspopup": "true",
  }, "Explore");
  const explorePanel = el("nav", { class: "mega", "aria-label": "Explore", hidden: "" });
  const tiles: { label: string; href: string; copy: string; glyph: string }[] = [
    { label: "Marker band", href: "/markers", copy: "Read every marker on one band.", glyph: "M3 17 L10 9 L14 13 L21 5" },
    { label: "At-home draws", href: "/plans", copy: "A phlebotomist comes to you.", glyph: "M8 3 v5 a4 4 0 0 0 8 0 V3" },
    { label: "Supplement packets", href: "/plans", copy: "Morning and evening packets, packed.", glyph: "M4 8 h16 v12 h-16 z M4 12 h16" },
    { label: "Plans", href: "/plans", copy: "Free and Plus, your cadence.", glyph: "M4 5 h16 v14 h-16 z" },
  ];
  for (const tile of tiles) {
    const link = el("a", { href: tile.href, class: "mega-tile" });
    link.append(el("span", { class: "mega-glyph" }, tile.glyph));
    link.append(el("span", { class: "mega-copy" }, tile.copy));
    explorePanel.append(link);
  }
  const plansLink = el("a", { href: "/plans", class: "nav-link" }, "Plans");
  const markersLink = el("a", { href: "/markers", class: "nav-link" }, "Marker catalog");
  const signIn = el(
    "a",
    { href: session ? session.home : "/signin", class: "nav-link nav-signin" },
    session ? session.name : "Sign in"
  );
  nav.append(exploreButton, explorePanel, plansLink, markersLink, signIn);
  const brand = el("a", { href: "/", class: "brand" }, "Ocotillo Longevity Club");
  const header = el("header", { class: "public-header", "data-state": "top" }, brand, nav);

  let open = false;
  let hoverOpened = false;
  const setOpen = (value: boolean) => {
    open = value;
    exploreButton.setAttribute("aria-expanded", String(value));
    if (value) {
      explorePanel.hidden = false;
      animate(
        explorePanel,
        [
          { opacity: "0", transform: "translateY(-6px)" },
          { opacity: "1", transform: "translateY(0)" },
        ],
        DURATIONS.short
      );
      const firstTile = explorePanel.querySelector("a") as HTMLElement | null;
      firstTile?.focus();
    } else {
      if (prefersReducedMotion()) {
        explorePanel.hidden = true;
      } else {
        const animation = animate(
          explorePanel,
          [
            { opacity: "1", transform: "translateY(0)" },
            { opacity: "0", transform: "translateY(-6px)" },
          ],
          DURATIONS.short
        );
        animation?.finished.finally(() => {
          if (!open) explorePanel.hidden = true;
        });
      }
      exploreButton.focus();
    }
  };

  exploreButton.addEventListener("click", () => {
    if (open && document.activeElement === exploreButton) {
      setOpen(false);
    } else {
      setOpen(true);
    }
  });
  exploreButton.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(!open);
    }
    if (event.key === "Escape" && open) {
      setOpen(false);
    }
  });
  explorePanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  });
  document.addEventListener("focusin", (event) => {
    if (open && !explorePanel.contains(event.target as Node) && event.target !== exploreButton) {
      setOpen(false);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (open && !explorePanel.contains(event.target as Node) && !exploreButton.contains(event.target as Node)) {
      setOpen(false);
    }
  });
  exploreButton.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      hoverOpened = true;
      setOpen(true);
    }
  });
  exploreButton.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && hoverOpened) {
      hoverOpened = false;
      window.setTimeout(() => {
        if (!explorePanel.matches(":hover")) setOpen(false);
      }, 0);
    }
  });
  explorePanel.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && open) {
      setOpen(false);
    }
  });
  explorePanel.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") hoverOpened = true;
  });

  let lastState = "top";
  const onScroll = () => {
    const state = window.scrollY >= 24 ? "solid" : "top";
    if (state !== lastState) {
      lastState = state;
      header.setAttribute("data-state", state);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return header;
}

export function announcementsRegion(): HTMLElement {
  const live = el("div", {
    id: "announcements",
    role: "status",
    "aria-live": "polite",
    "aria-label": "Announcements",
    class: "announcements",
  });
  return live;
}

/** The looping partner strip: one full pass every 64 seconds, pausing on hover or focus. */
export function partnerStrip(): HTMLElement {
  const names = [...PARTNERS, ...PARTNERS];
  const track = el("div", { class: "partner-track" });
  for (const name of names) {
    track.append(el("span", { class: "partner-name" }, name));
  }
  const region = el("div", {
    class: "partners",
    role: "region",
    "aria-label": "Lab partners",
    tabindex: "0",
  }, track);
  let paused = false;
  let focused = false;
  let animation: Animation | null = null;
  const start = () => {
    if (prefersReducedMotion()) return;
    if (animation) return;
    const duration = 64_000 * (names.length / (PARTNERS.length * 2));
    animation = track.animate(
      [{ transform: "translateX(0)" }, { transform: `translateX(-${track.scrollWidth / 2}px)` }],
      { duration, iterations: Infinity }
    );
  };
  const stop = () => {
    animation?.pause();
  };
  const resume = () => {
    if (!paused && !focused) animation?.play();
  };
  region.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      paused = true;
      stop();
    }
  });
  region.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      paused = false;
      resume();
    }
  });
  region.addEventListener("focusin", () => {
    focused = true;
    stop();
  });
  region.addEventListener("focusout", () => {
    focused = false;
    resume();
  });
  if (prefersReducedMotion()) {
    // Reduced motion: the strip shows its names and does not loop.
  } else {
    start();
  }
  return region;
}

export function glyphDecor(kind: "cloud" | "tube" | "band" | "packet" | "marker"): SVGElement {
  const svgNs = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(svgNs, "svg");
  node.setAttribute("viewBox", "0 0 120 80");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("class", `glyph glyph-${kind}`);
  const paths: Record<string, string[]> = {
    cloud: ["M20 52 a14 14 0 0 1 6 -27 a16 16 0 0 1 30 -4 a14 14 0 0 1 26 8 a12 12 0 0 1 -4 23 z"],
    tube: ["M50 12 h20 v40 a10 10 0 0 1 -20 0 z M50 22 h20"],
    band: ["M12 40 h96 M20 30 a8 8 0 0 0 0 20 M100 30 a8 8 0 0 1 0 20"],
    packet: ["M24 22 h72 v44 h-72 z M24 36 h72 M46 22 v44"],
    marker: ["M60 16 v12 M60 52 v12 M36 40 h12 M72 40 h12"],
  };
  for (const d of paths[kind] ?? []) {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    node.append(path);
  }
  return node;
}
