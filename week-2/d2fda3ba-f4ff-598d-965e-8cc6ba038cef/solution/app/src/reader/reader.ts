// Dossier reader: link-preview tooltips for internal links, from the dossier's previews.json.
// Pages work without it; this is the only script a public or preview page loads.

interface LinkPreview {
  title: string;
  excerpt: string;
}

const SHOW_DELAY_MS = 330;
const script = document.currentScript as HTMLScriptElement;
const base = new URL("../", script.src);
const sheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

function pageKey(link: HTMLAnchorElement): string | null {
  const target = new URL(link.href);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return null;
  return decodeURIComponent(target.pathname.slice(base.pathname.length));
}

function start(previews: Record<string, LinkPreview>): void {
  const tip = document.createElement("div");
  tip.id = "link-preview";
  tip.className = "link-preview";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const title = document.createElement("strong");
  const excerpt = document.createElement("p");
  tip.append(title, excerpt);
  document.body.append(tip);

  let timer = 0;
  let owner: HTMLAnchorElement | null = null;

  const hide = () => {
    window.clearTimeout(timer);
    tip.hidden = true;
    owner?.removeAttribute("aria-describedby");
    owner = null;
  };

  const show = (link: HTMLAnchorElement) => {
    const key = pageKey(link);
    const preview = key === null ? undefined : previews[key];
    if (!preview) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      owner = link;
      title.textContent = preview.title;
      excerpt.textContent = preview.excerpt;
      const box = link.getBoundingClientRect();
      const left = Math.max(8, Math.min(box.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 328));
      sheet.replaceSync(`.link-preview{left:${left}px;top:${box.bottom + window.scrollY + 8}px}`);
      tip.hidden = false;
      link.setAttribute("aria-describedby", tip.id);
    }, SHOW_DELAY_MS);
  };

  const linkOf = (event: Event) => (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
  document.addEventListener("pointerover", (event) => {
    const link = linkOf(event);
    if (link && (event as PointerEvent).pointerType === "mouse") show(link);
  });
  document.addEventListener("pointerout", (event) => {
    if (linkOf(event)) hide();
  });
  document.addEventListener("focusin", (event) => {
    const link = linkOf(event);
    if (link) show(link);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  fetch(new URL("previews.json", base))
    .then((response) => (response.ok ? response.json() as Promise<Record<string, LinkPreview>> : null))
    .then((previews) => {
      if (previews) start(previews);
    })
    .catch(() => undefined);
});
