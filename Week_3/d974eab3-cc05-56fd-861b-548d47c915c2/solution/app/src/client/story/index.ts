import type { Content } from "../../shared/content.js";
import type { Chrome } from "../chrome.js";
import { h } from "../dom.js";
import { headingReveal } from "../reveal.js";
import { createAbout } from "./about.js";
import { ChapterWatcher, chapterFromHash, type ChapterId } from "./chapters.js";
import { createInterviews } from "./interviews.js";
import { createLifestyle } from "./lifestyle.js";
import { createOpening } from "./opening.js";
import { createOxygen } from "./oxygen.js";
import { createProduct } from "./product.js";
import { createScience } from "./science.js";
import { contentAlert } from "../pages/alerts.js";

let watcher: ChapterWatcher | null = null;

/** Moves to a chapter of the story on screen; false when the story is not on screen. */
export function jumpToChapter(id: ChapterId): boolean {
  if (!watcher) return false;
  watcher.jump(id, false);
  return true;
}

/**
 * The story page. The Opening needs nothing from the API and appears at once; the other six chapters
 * are drawn when the content read returns.
 */
export async function renderStory(chrome: Chrome, readContent: () => Promise<Content>, signal: AbortSignal): Promise<void> {
  const { main } = chrome;
  const requested = chapterFromHash(location.hash);
  if (!requested) history.replaceState(null, "", `${location.pathname}${location.search}#opening`);
  chrome.showRail(true);
  chrome.footer.hidden = true;
  signal.addEventListener("abort", () => { watcher = null; });

  const opening = createOpening();
  const pending = h("div", { class: "chapters-pending", "aria-hidden": "true" });
  main.replaceChildren(opening, pending);

  let content: Content;
  try {
    content = await readContent();
  } catch {
    if (signal.aborted) return;
    pending.replaceWith(contentAlert());
    chrome.footer.hidden = false;
    return;
  }
  if (signal.aborted) return;

  const reveal = headingReveal(signal);
  const about = createAbout(reveal, signal);
  const oxygen = createOxygen(reveal, signal);
  const lifestyle = createLifestyle(content, reveal, signal);
  const regions = new Map<ChapterId, HTMLElement>([
    ["opening", opening],
    ["about", about.element],
    ["oxygen", oxygen.element],
    ["science", createScience(content.product, reveal)],
    ["product", createProduct(content, reveal)],
    ["interviews", createInterviews(content.interviews, reveal)],
    ["lifestyle", lifestyle.element],
  ]);
  pending.replaceWith(...[...regions.values()].slice(1));
  chrome.footer.hidden = false;
  about.mount();
  oxygen.mount();
  lifestyle.mount();

  watcher = new ChapterWatcher(regions, (id) => chrome.markCurrent(id), signal);
  if (requested) watcher.jump(requested, true);
  else watcher.sync();
}
