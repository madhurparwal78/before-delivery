import { FRAMES_PER_PROJECT, knownProject } from "../shared/catalog.js";
import { caseStudyHref } from "../shared/filter.js";
import { frameKey, frameStatus } from "../shared/media-manifest.js";
import { all, must } from "./dom.js";
import { FramePlayer } from "./frames.js";
import { type Gallery } from "./gallery.js";
import { adoptSlot, createFrameSlot } from "./media.js";
import { Modal } from "./modal.js";

/** The quick look: `Preview <title>` opens a modal on frame 1 with focus on `Next frame`. Frames step without wrapping. */

export function initQuickLook(siteRoot: HTMLElement, gallery: Gallery): void {
  const layer = must<HTMLElement>(document, '[data-modal-layer="quick-look"]');
  const dialog = must<HTMLElement>(layer, "[data-dialog]");
  const frameBox = must<HTMLElement>(dialog, "[data-preview-frame]");
  const status = must<HTMLElement>(dialog, "[data-frame-status]");
  const previous = must<HTMLButtonElement>(dialog, "[data-frame-previous]");
  const next = must<HTMLButtonElement>(dialog, "[data-frame-next]");
  const openCaseStudy = must<HTMLAnchorElement>(dialog, "[data-open-case-study]");
  let player: FramePlayer | undefined;

  const modal = new Modal(layer, dialog, siteRoot, {
    enter: [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
    exit: [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(12px)" }],
    durationMs: 200,
  }, () => undefined);

  const showFrame = (frame: number): void => {
    if (player === undefined) return;
    const hadPrevious = document.activeElement === previous;
    const hadNext = document.activeElement === next;
    player.show(frame);
    status.textContent = frameStatus(player.frame);
    previous.disabled = player.frame === 1;
    next.disabled = player.frame === FRAMES_PER_PROJECT;
    if (hadPrevious && previous.disabled) next.focus();
    if (hadNext && next.disabled) previous.focus();
  };

  dialog.addEventListener("keydown", (event) => {
    if (player === undefined || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    showFrame(player.frame + (event.key === "ArrowRight" ? 1 : -1));
  });
  previous.addEventListener("click", () => player !== undefined && showFrame(player.frame - 1));
  next.addEventListener("click", () => player !== undefined && showFrame(player.frame + 1));
  must<HTMLElement>(dialog, "[data-modal-close]").addEventListener("click", () => modal.close(true));

  for (const opener of all<HTMLButtonElement>(document, "[data-preview-open]")) {
    opener.addEventListener("click", () => {
      const project = knownProject(opener.dataset["previewOpen"] ?? "");
      frameBox.replaceChildren(...Array.from({ length: FRAMES_PER_PROJECT }, (_, index) => createFrameSlot(project.title, frameKey(project.slug, index + 1), index + 1)));
      frameBox.dataset["frame"] = "1";
      dialog.setAttribute("aria-label", `${project.title} preview`);
      openCaseStudy.href = caseStudyHref(project.slug, gallery.categories());
      player = new FramePlayer(frameBox);
      for (const slot of player.slots()) adoptSlot(slot);
      must<HTMLElement>(frameBox, '[data-frame-slot="1"]').hidden = false;
      status.textContent = frameStatus(1);
      previous.disabled = true;
      next.disabled = false;
      modal.open(opener, () => next);
    });
  }
}
