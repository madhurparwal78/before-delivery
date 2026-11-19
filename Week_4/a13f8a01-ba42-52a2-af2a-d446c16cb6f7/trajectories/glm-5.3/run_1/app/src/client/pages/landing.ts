import { el, link, button, navigate } from "../lib/dom.js";
import { buildHeader, meSync } from "../lib/header.js";

const STARTER_KEYS = ["starter-courses", "starter-grid", "starter-type", "starter-physics"];

export async function landingPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  buildHeader(root);

  const landing = el("div", { class: "landing" });
  const hero = el("div", { class: "hero" });

  const inset = el("div", { class: "hero-inset", role: "region", "aria-label": "Starter pen", "data-starter": "1" });
  const iframe = el("iframe", { title: "Pen preview", sandbox: "allow-scripts" });
  const setStarter = async (n: number) => {
    const res = await fetch("/api/renders", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ pen_id: STARTER_KEYS[n - 1] }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { url: string };
    iframe.src = data.url;
  };
  void setStarter(1);
  inset.appendChild(iframe);

  const copy = el("div", { class: "hero-copy" });
  copy.appendChild(el("p", { text: "Write a little HTML, CSS and JavaScript. Watch it run. Keep every version.", class: "support" }));

  const sections: Array<[string, string]> = [
    ["Pinned libraries", "Pens load libraries only from the app's pinned shelf, so they never break when a public CDN moves."],
    ["Every save is a version", "Each save is stored byte for byte. Compare any two versions and restore the one that worked."],
    ["Embeds that keep working", "Embeds open on the tab the author chose and keep working, because they point here."],
  ];
  const heads: HTMLElement[] = [];
  for (const [h, p] of sections) {
    const section = el("section", {});
    const head = el("h2", { text: h });
    section.appendChild(head);
    section.appendChild(el("p", { text: p }));
    copy.appendChild(section);
    heads.push(head);
  }

  const wordmark = el("div", { class: "wordmark" });
  wordmark.appendChild(el("span", { text: "ashlar", "aria-hidden": "true" }));

  hero.appendChild(inset);
  hero.appendChild(copy);
  hero.appendChild(wordmark);
  landing.appendChild(hero);
  root.appendChild(landing);

  // The inset crossfades between starters as the sections cross the middle.
  let current = 1;
  const show = (n: number) => {
    if (n === current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      void setStarter(n);
      inset.setAttribute("data-starter", String(n));
      current = n;
    } else {
      iframe.style.opacity = "0";
      setTimeout(() => {
        void setStarter(n);
        inset.setAttribute("data-starter", String(n));
        current = n;
        iframe.style.opacity = "1";
      }, 600);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = heads.indexOf(entry.target as HTMLElement);
        if (idx >= 0) show(idx + 2);
      }
    },
    { rootMargin: "-50% 0px -50% 0px" },
  );
  heads.forEach((h) => observer.observe(h));
}
