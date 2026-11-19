import { FRAME_BACK, FRAME_STILL_UNAVAILABLE, IMAGES_BACK, MEDIA_NOTICE } from "../shared/announcements.js";
import { MEDIA_RECHECK_MS, frameLabel, mediaPath, type MediaReport } from "../shared/media-manifest.js";
import { announce } from "./announce.js";
import { all, must } from "./dom.js";

/** Media slots. A slot is `loading` (a paper box at its final size), `shown`, or `unavailable` (a fallback plate with
 * its own accessible name). The browser names media only by `/media/<key>` paths. While `GET /api/media` says the whole
 * library is unavailable, `Media notice` shows and the page asks again every 5 seconds of page time. */

const PLATE_CAPTIONS = { cover: "Cover unavailable", frame: "Preview frame unavailable" } as const;
type SlotKind = keyof typeof PLATE_CAPTIONS;

const slots = new Set<HTMLElement>();
let notice: HTMLElement | undefined;
let recheckTimer = 0;
let libraryDown = false;

function kindOf(slot: HTMLElement): SlotKind {
  return slot.dataset["mediaSlot"] === "frame" ? "frame" : "cover";
}

function imageOf(slot: HTMLElement): HTMLImageElement {
  return must<HTMLImageElement>(slot, "img");
}

function plateArt(label: string): HTMLElement {
  const art = document.createElement("div");
  art.className = "plate-art";
  art.setAttribute("role", "img");
  art.setAttribute("aria-label", label);
  art.innerHTML =
    '<svg viewBox="0 0 160 100" preserveAspectRatio="none" focusable="false" aria-hidden="true"><line x1="0" y1="0" x2="160" y2="100"/><line x1="160" y1="0" x2="0" y2="100"/><circle cx="80" cy="50" r="28"/></svg>';
  return art;
}

function showShown(slot: HTMLElement): void {
  slot.querySelector("[data-plate]")?.remove();
  delete slot.dataset["fallback"];
  imageOf(slot).hidden = false;
  slot.dataset["state"] = "shown";
}

function showPlate(slot: HTMLElement): void {
  if (slot.dataset["fallback"] === "true") return;
  const image = imageOf(slot);
  image.hidden = true;
  slot.dataset["state"] = "unavailable";
  slot.dataset["fallback"] = "true";
  const plate = document.createElement("div");
  plate.className = "plate";
  plate.dataset["plate"] = "";
  const caption = document.createElement("p");
  caption.className = "plate-caption";
  caption.textContent = PLATE_CAPTIONS[kindOf(slot)];
  plate.append(plateArt(image.alt), caption);
  if (kindOf(slot) === "frame") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => void retryFrame(slot));
    plate.append(retry);
  }
  slot.append(plate);
}

async function fetchReport(): Promise<MediaReport | undefined> {
  try {
    const response = await fetch("/api/media");
    return response.ok ? ((await response.json()) as MediaReport) : undefined;
  } catch {
    return undefined;
  }
}

function showNotice(): void {
  if (notice === undefined) return;
  notice.textContent = MEDIA_NOTICE;
  notice.hidden = false;
}

function reload(slot: HTMLElement): Promise<boolean> {
  const image = imageOf(slot);
  return new Promise((resolve) => {
    const probe = new Image();
    probe.addEventListener("load", () => {
      image.src = probe.src;
      showShown(slot);
      resolve(true);
    }, { once: true });
    probe.addEventListener("error", () => resolve(false), { once: true });
    probe.src = mediaPath(slot.dataset["mediaKey"] ?? "");
  });
}

function recheck(): void {
  window.clearTimeout(recheckTimer);
  recheckTimer = window.setTimeout(async () => {
    const report = await fetchReport();
    if (report?.status !== "unavailable") {
      libraryDown = false;
      if (notice !== undefined) {
        notice.hidden = true;
        notice.textContent = "";
      }
      announce(IMAGES_BACK);
      await Promise.all([...slots].filter((slot) => slot.dataset["fallback"] === "true").map(reload));
      return;
    }
    recheck();
  }, MEDIA_RECHECK_MS);
}

/** Applies what `GET /api/media` says: the plates of unavailable objects, and the notice and re-check when the whole library is down. */
function applyReport(report: MediaReport): void {
  const unavailable = new Set(report.objects.filter((object) => !object.available).map((object) => object.key));
  for (const slot of slots) {
    if (unavailable.has(slot.dataset["mediaKey"] ?? "")) showPlate(slot);
  }
  if (report.status === "unavailable" && !libraryDown) {
    libraryDown = true;
    showNotice();
    recheck();
  }
}

async function askLibrary(): Promise<void> {
  const report = await fetchReport();
  if (report !== undefined) applyReport(report);
}

async function retryFrame(slot: HTMLElement): Promise<void> {
  const back = await reload(slot);
  if (back) {
    announce(FRAME_BACK);
    (slot.closest<HTMLElement>("[data-preview]") ?? slot.closest<HTMLElement>("[data-preview-frame]"))?.focus();
    return;
  }
  announce(FRAME_STILL_UNAVAILABLE);
  await askLibrary();
}

/** Takes a slot under management: its image either arrives or fails, and a failure shows the plate and asks the library. */
export function adoptSlot(slot: HTMLElement): void {
  slots.add(slot);
  const image = imageOf(slot);
  const failed = (): void => {
    showPlate(slot);
    void askLibrary();
  };
  if (image.complete) {
    if (image.naturalWidth > 0) showShown(slot);
    else failed();
    return;
  }
  image.addEventListener("load", () => showShown(slot), { once: true });
  image.addEventListener("error", failed, { once: true });
}

/** A frame slot cloned from the template the page carries, so its markup is decided in one place (the server render). */
export function createFrameSlot(title: string, key: string, frame: number): HTMLElement {
  const template = must<HTMLTemplateElement>(document, "[data-frame-slot-template]");
  const slot = must<HTMLElement>(template.content, "[data-frame-slot]").cloneNode(true) as HTMLElement;
  slot.dataset["frameSlot"] = String(frame);
  slot.dataset["mediaKey"] = key;
  const image = imageOf(slot);
  image.alt = frameLabel(title, frame);
  image.src = mediaPath(key);
  return slot;
}

export function initMedia(): void {
  notice = must<HTMLElement>(document, "[data-media-notice]");
  for (const slot of all<HTMLElement>(document, "[data-media-slot]")) adoptSlot(slot);
  void askLibrary();
}
