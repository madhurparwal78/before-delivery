/**
 * Media slots: cover and frame images arrive only through GET /media/<key>,
 * with the published loading, shown and unavailable states and the recovery
 * paths for a missing object and a missing library.
 */
import { ANNOUNCEMENTS } from "../shared/domain.js";
import { announce, qs, qsa } from "./core.js";

type SlotKind = "cover" | "frame";

type SlotState = "loading" | "shown" | "unavailable";

type Slot = {
  element: HTMLElement;
  kind: SlotKind;
  key: string;
  name: string;
  img: HTMLImageElement | null;
  state: SlotState;
  retryButton: HTMLButtonElement | null;
};

let slots: Slot[] = [];
let libraryUnavailable = false;
let recheckHandle = 0;
let noticeShown = false;

/** Wires a slot's img to the loading and failure rules, whenever it appears. */
function watchSlot(slot: Slot): void {
  const img = slot.element.querySelector<HTMLImageElement>("img[data-media-img]");
  if (!img || slot.img === img) return;
  slot.img = img;
  img.addEventListener("load", () => {
    if (img.dataset.state !== "fallback") {
      img.dataset.state = "shown";
      slot.state = "shown";
    }
  });
  img.addEventListener("error", () => {
    img.dataset.state = "fallback";
    // the slot's key follows whichever frame is shown, so read it fresh
    slot.key = slot.element.dataset.mediaSlot ?? slot.key;
    slot.name = slot.element.dataset.mediaName ?? slot.name;
    const kind = slot.element.dataset.mediaKind;
    if (kind === "frame" || kind === "cover") slot.kind = kind;
    void slotFailed(slot);
  });
}

export function initMedia(): void {
  slots = qsa<HTMLElement>("[data-media-slot]").map((element) => {
    const kind = (element.dataset.mediaKind ?? "cover") as SlotKind;
    const key = element.dataset.mediaSlot ?? "";
    const name = element.dataset.mediaName ?? "";
    const slot: Slot = { element, kind, key, name, img: null, state: "loading", retryButton: null };
    watchSlot(slot);
    return slot;
  });
  // the quick-look dialog creates its img only when opened, so watch again then
  document.addEventListener("quicklook-frame", () => {
    for (const slot of slots) watchSlot(slot);
  });
  void checkLibrary();
}

async function checkLibrary(): Promise<void> {
  try {
    const response = await fetch("/api/media");
    if (!response.ok) return;
    const report = (await response.json()) as {
      status: "available" | "unavailable";
      objects: { key: string; available: boolean }[];
    };
    if (report.status === "unavailable") {
      libraryUnavailable = true;
      markNotice();
      for (const slot of slots) showPlate(slot, "Cover unavailable", false);
      scheduleRecheck();
    } else {
      const available = new Map(report.objects.map((entry) => [entry.key, entry.available]));
      if (libraryUnavailable) {
        libraryUnavailable = false;
        hideNotice();
        announce(ANNOUNCEMENTS.mediaBack);
        for (const slot of slots) loadSlot(slot, available.get(slot.key) ?? true);
      } else {
        for (const slot of slots) {
          if (slot.state === "unavailable" && !(available.get(slot.key) ?? true)) continue;
          if (slot.state === "loading" || slot.state === "unavailable") {
            if (!(available.get(slot.key) ?? true)) continue;
            loadSlot(slot, true);
          }
        }
      }
    }
  } catch {
    /* the page keeps working; the next re-check will try again */
  }
}

function scheduleRecheck(): void {
  if (recheckHandle) return;
  recheckHandle = window.setInterval(() => {
    void checkLibrary();
  }, 5000);
}

function stopRecheck(): void {
  if (!recheckHandle) return;
  window.clearInterval(recheckHandle);
  recheckHandle = 0;
}

function markNotice(): void {
  if (noticeShown) return;
  noticeShown = true;
  const notice = qs<HTMLElement>("[data-media-notice]");
  if (notice) {
    notice.textContent = ANNOUNCEMENTS.mediaNotice;
    notice.hidden = false;
  }
}

function hideNotice(): void {
  noticeShown = false;
  const notice = qs<HTMLElement>("[data-media-notice]");
  if (notice) {
    notice.textContent = "";
    notice.hidden = true;
  }
  stopRecheck();
}

async function slotFailed(slot: Slot): Promise<void> {
  slot.state = "unavailable";
  try {
    const response = await fetch("/api/media");
    if (response.ok) {
      const report = (await response.json()) as {
        status: "available" | "unavailable";
        objects: { key: string; available: boolean }[];
      };
      if (report.status === "unavailable") {
        libraryUnavailable = true;
        markNotice();
        scheduleRecheck();
        for (const other of slots) showPlate(other, "Cover unavailable", false);
        return;
      }
      const entry = report.objects.find((candidate) => candidate.key === slot.key);
      if (entry && !entry.available) {
        showPlate(slot, slot.kind === "frame" ? "Preview frame unavailable" : "Cover unavailable", slot.kind === "frame");
        return;
      }
    }
  } catch {
    /* fall through to the plate */
  }
  showPlate(slot, slot.kind === "frame" ? "Preview frame unavailable" : "Cover unavailable", slot.kind === "frame");
}

function showPlate(slot: Slot, caption: string, withRetry: boolean): void {
  slot.state = "unavailable";
  slot.element.dataset.fallback = "true";
  if (slot.img) {
    slot.img.dataset.state = "fallback";
    slot.img.setAttribute("aria-hidden", "true");
    slot.img.removeAttribute("src");
    slot.img.hidden = true;
  }
  let plate = slot.element.querySelector<HTMLElement>(".fallback-plate");
  if (!plate) {
    plate = document.createElement("div");
    plate.className = "fallback-plate";
    plate.setAttribute("role", "img");
    plate.setAttribute("aria-label", slot.name);
    slot.element.appendChild(plate);
  }
  plate.textContent = "";
  const captionElement = document.createElement("p");
  captionElement.className = "fallback-caption";
  captionElement.textContent = caption;
  plate.appendChild(captionElement);
  if (withRetry && !plate.querySelector("button")) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "fallback-try";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => void retrySlot(slot));
    plate.appendChild(retry);
    slot.retryButton = retry;
  }
}

async function retrySlot(slot: Slot): Promise<void> {
  const img = slot.img;
  if (!img) return;
  slot.state = "loading";
  img.hidden = false;
  img.removeAttribute("aria-hidden");
  img.dataset.state = "loading";
  img.src = `/media/${slot.key}?retry=${Date.now()}`;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", failed);
      resolve();
    };
    const failed = (): void => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", failed);
      resolve();
    };
    img.addEventListener("load", done);
    img.addEventListener("error", failed);
  });
  if (img.dataset.state === "shown") {
    slot.state = "shown";
    slot.element.removeAttribute("data-fallback");
    plateRemove(slot);
    announce(ANNOUNCEMENTS.retryOk);
    focusPreviewFigure(slot);
  } else {
    showPlate(slot, "Preview frame unavailable", true);
    announce(ANNOUNCEMENTS.retryFail);
  }
}

function plateRemove(slot: Slot): void {
  const plate = slot.element.querySelector(".fallback-plate");
  if (plate) plate.remove();
  slot.retryButton = null;
}

function focusPreviewFigure(slot: Slot): void {
  const inDialog = slot.element.closest("[data-quick-look-frame-slot]");
  const target = inDialog ? slot.element : slot.element.closest<HTMLElement>("[data-preview]");
  if (target) {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
}

function loadSlot(slot: Slot, available: boolean): void {
  if (!available) return;
  if (slot.state === "shown") return;
  if (!slot.img) return;
  slot.state = "loading";
  slot.element.removeAttribute("data-fallback");
  plateRemove(slot);
  slot.img.hidden = false;
  slot.img.removeAttribute("aria-hidden");
  slot.img.dataset.state = "loading";
  slot.img.src = `/media/${slot.key}?recover=${Date.now()}`;
}
