// Lucide icons, inlined as SVG wherever an element carries data-icon="<name>".

import {
  ArrowLeft, Check, CircleAlert, Copy, createElement, FileAudio, Inbox, Lock, Search, Send, Upload, Volume2, VolumeX, X,
  type IconNode,
} from "lucide";

const ICONS: Record<string, IconNode> = {
  "arrow-left": ArrowLeft,
  check: Check,
  "circle-alert": CircleAlert,
  copy: Copy,
  "file-audio": FileAudio,
  inbox: Inbox,
  lock: Lock,
  search: Search,
  send: Send,
  upload: Upload,
  "volume-2": Volume2,
  "volume-x": VolumeX,
  x: X,
};

export function icon(name: keyof typeof ICONS & string): SVGElement {
  const svg = createElement(ICONS[name] ?? X);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

export function hydrateIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    if (!slot.firstElementChild) slot.append(icon(slot.dataset.icon ?? "x"));
  }
}
