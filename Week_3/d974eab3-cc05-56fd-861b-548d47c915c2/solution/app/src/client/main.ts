import type { Content } from "../shared/content.js";
import { PAGE_PATHS, PAGE_TITLES, interviewSlugOf } from "../shared/titles.js";
import { loadContent } from "./api.js";
import { buildChrome } from "./chrome.js";
import { NOT_FOUND_TITLE } from "./copy.js";
import { find } from "./dom.js";
import { contentAlert } from "./pages/alerts.js";
import { renderInfo } from "./pages/info.js";
import { renderInterview } from "./pages/interview.js";
import { notFound } from "./pages/not-found.js";
import { renderStore } from "./pages/store.js";
import { chapterFromHash } from "./story/chapters.js";
import { jumpToChapter, renderStory } from "./story/index.js";

history.scrollRestoration = "manual";

const chrome = buildChrome(find(document, "#root", HTMLElement));
let content: Promise<Content> | null = null;
let current: AbortController | null = null;

/** The content record is read once per page load; a failed read is tried again on the next page. */
function readContent(): Promise<Content> {
  content ??= loadContent().catch((error: unknown) => {
    content = null;
    throw error;
  });
  return content;
}

function setTitle(title: string): void {
  document.title = title;
}

async function render(moved: boolean): Promise<void> {
  current?.abort();
  current = new AbortController();
  const { signal } = current;
  const { pathname } = location;
  const slug = interviewSlugOf(pathname);
  const page = pathname in PAGE_PATHS ? PAGE_PATHS[pathname as keyof typeof PAGE_PATHS] : null;
  if (slug === null) setTitle(page === null ? PAGE_TITLES.notFound : PAGE_TITLES[page]);
  if (moved) scrollTo({ top: 0, behavior: "instant" });

  if (page === "story") {
    await renderStory(chrome, readContent, signal);
    return;
  }
  chrome.showRail(false);
  chrome.footer.hidden = false;
  if (slug !== null) {
    await renderInterview(chrome.main, slug, navigate, setTitle, signal);
  } else if (page === "store") {
    try {
      const record = await readContent();
      if (!signal.aborted) chrome.main.replaceChildren(renderStore(record));
    } catch {
      if (!signal.aborted) chrome.main.replaceChildren(contentAlert());
    }
  } else if (page === "contact" || page === "privacy" || page === "legal") {
    chrome.main.replaceChildren(renderInfo(page));
  } else {
    chrome.main.replaceChildren(notFound(NOT_FOUND_TITLE, "Back to the story", "/"));
  }
  if (moved && !signal.aborted) chrome.main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

function navigate(path: string): void {
  history.pushState(null, "", path);
  void render(true);
}

addEventListener("popstate", () => void render(false));

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  const chapter = chapterFromHash(url.hash);
  if (url.pathname === "/" && location.pathname === "/" && chapter && jumpToChapter(chapter)) return;
  navigate(`${url.pathname}${url.search}${url.hash}`);
});

void render(false);
