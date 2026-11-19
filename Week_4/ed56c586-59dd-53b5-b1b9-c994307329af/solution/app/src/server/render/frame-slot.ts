import { FRAME_SIZE, mediaPath } from "../../shared/media-manifest.js";
import { flag, html, type Markup } from "./html.js";

/** One preview frame's slot. The case study renders six; the quick look clones a blank one from a template. */

interface FrameSlotContent {
  readonly key: string;
  readonly label: string;
  readonly frame: number;
  readonly hidden: boolean;
}

export function renderFrameSlot(slot: FrameSlotContent): Markup {
  return html`<div class="frame-slot" data-frame-slot="${slot.frame}" data-media-slot="frame" data-media-key="${slot.key}" data-state="loading"${flag(slot.hidden, "hidden")}><img src="${mediaPath(slot.key)}" alt="${slot.label}" width="${FRAME_SIZE.width}" height="${FRAME_SIZE.height}" decoding="async"></div>`;
}
