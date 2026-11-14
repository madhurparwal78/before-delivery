import { moveFocus, trapTab } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import { GALLERY_ADDRESS_KEY } from "./work.js";
import { mediaImage } from "../../shared/render.js";
import type { Project } from "../../shared/types.js";

const SWIPE_PX = 60;

function openViewer(project: Project, start: number, opener: HTMLElement): void {
  const outside = [...document.querySelectorAll<HTMLElement>(".skip-link, .site-header, main, .site-footer")];
  const backdrop = document.createElement("div");
  backdrop.className = "viewer-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "viewer";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Image viewer");
  dialog.innerHTML = `<div class="viewer-top"><p class="viewer-count num"></p><button type="button" class="button quiet close-viewer">Close viewer</button></div>
<div class="viewer-stage"><div class="media-frame viewer-frame"></div></div>
<p class="viewer-caption"></p>
<div class="viewer-bottom">
  <button type="button" class="button quiet previous-image">Previous image</button>
  <button type="button" class="button quiet next-image">Next image</button>
</div>`;
  const frame = dialog.querySelector<HTMLElement>(".viewer-frame");
  const count = dialog.querySelector<HTMLElement>(".viewer-count");
  const caption = dialog.querySelector<HTMLElement>(".viewer-caption");
  if (frame === null || count === null || caption === null) throw new Error("Viewer markup missing");
  let current = start;

  const show = (n: number, from: "left" | "right" | null): void => {
    current = n;
    const text = project.captions[n - 1];
    frame.classList.remove("failed", "slide-from-left", "slide-from-right");
    frame.innerHTML = mediaImage(project, n, text, text);
    if (from !== null) {
      void frame.offsetWidth;
      frame.classList.add(`slide-from-${from}`);
    }
    count.textContent = `Image ${n} of 4`;
    caption.textContent = text;
  };
  const step = (delta: 1 | -1): void => show(((current - 1 + delta + 4) % 4) + 1, delta === 1 ? "right" : "left");

  const close = (): void => {
    dialog.remove();
    backdrop.remove();
    for (const el of outside) el.inert = false;
    moveFocus(opener);
  };

  dialog.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (button?.classList.contains("close-viewer")) close();
    else if (button?.classList.contains("next-image")) step(1);
    else if (button?.classList.contains("previous-image")) step(-1);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else trapTab(dialog, event);
  });
  let touchStart: { x: number; y: number } | null = null;
  frame.addEventListener(
    "touchstart",
    (event) => {
      touchStart = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    },
    { passive: true },
  );
  frame.addEventListener("touchend", (event) => {
    const end = event.changedTouches[0];
    if (touchStart === null || end === undefined) return;
    const dx = end.clientX - touchStart.x;
    const dy = end.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });

  show(start, null);
  for (const el of outside) el.inert = true;
  document.body.append(backdrop, dialog);
  moveFocus(dialog.querySelector<HTMLElement>(".close-viewer"));
}

export function mountProject({ bootstrap, main, url }: PageContext): MountedPage {
  const slug = url.pathname.split("/")[2];
  const project = bootstrap.content.projects.find((p) => decodeURIComponent(slug) === p.slug);
  if (project === undefined) throw new Error("Unknown project");
  const allWork = main.querySelector<HTMLAnchorElement>(".all-work");
  if (allWork !== null) allWork.href = sessionStorage.getItem(GALLERY_ADDRESS_KEY) ?? "/work";
  const listeners = new AbortController();
  main.addEventListener(
    "click",
    (event) => {
      const thumb = event.target instanceof Element ? event.target.closest<HTMLElement>(".thumb") : null;
      if (thumb !== null) openViewer(project, Number(thumb.dataset.image), thumb);
    },
    { signal: listeners.signal },
  );
  return {
    unmount: () => {
      listeners.abort();
      document.querySelector(".viewer")?.remove();
      document.querySelector(".viewer-backdrop")?.remove();
      for (const el of document.querySelectorAll<HTMLElement>("[inert]:not(.menu)")) el.inert = false;
    },
  };
}
