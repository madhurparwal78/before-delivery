// Screen builders: the level-one heading, the signed-in frame, the published
// regions and the controls. Everything the screens share lives here.

import type { Router } from "./router";
import type { Announcer } from "./announce";
import type { ClientStore, Json } from "./state";
import { Api } from "./state";
import type { Session } from "./session";

export type ScreenContext = {
  router: Router;
  announcer: Announcer;
  store: ClientStore;
  session: Session;
  reload: () => Promise<void>;
};

export type Screen = {
  title: string;
  heading: HTMLElement;
  doc: HTMLElement;
  refresh: (() => Promise<void>) | null;
};

export type Build = {
  heading: HTMLElement;
  body: HTMLElement;
  frame?: HTMLElement | null;
  refresh?: (() => Promise<void>) | null;
};

export type ScreenBuilder = (ctx: ScreenContext, path: string, query: URLSearchParams) => Promise<Build>;

export function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

// The page title: `<heading> — Clapstick`.
export function titleOf(heading: string): string {
  return `${heading} — Clapstick`;
}

// The level-one heading, revealed line by line with one whole accessible
// name.
export function heading(lines: string[], announcer: Announcer): HTMLElement {
  const node = el("h1", { "data-part": "heading" });
  for (const line of lines) {
    const span = el("span", { "data-part": "heading-line" }, line);
    node.append(span);
  }
  void announcer;
  return node;
}

export function link(href: string, label: string, attrs: Record<string, string> = {}): HTMLElement {
  return el("a", { href, ...attrs }, label);
}

export function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLElement {
  const node = el("button", { type: "button", ...attrs }, label);
  node.addEventListener("click", () => onClick());
  return node;
}

export function labelled(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = el("div", { class: "field" });
  const id = control.getAttribute("id") ?? `f${Math.random().toString(36).slice(2)}`;
  control.setAttribute("id", id);
  const label = el("label", { for: id }, labelText);
  wrap.append(label, control);
  return wrap;
}

export function problems(): { region: HTMLElement; show: (messages: { field: string; text: string }[]) => void; clear: () => void } {
  const region = el("div", { role: "region", "aria-label": "Problems", class: "problems", hidden: "" });
  return {
    region,
    show(messages) {
      region.replaceChildren();
      for (const message of messages) {
        region.append(el("p", { class: "problem" }, message.text));
      }
      region.hidden = messages.length === 0;
    },
    clear() {
      region.replaceChildren();
      region.hidden = true;
    },
  };
}

export const api = new Api();

// An input, select or textarea with its value readable and writable.
export function field(tag: string, attrs: Record<string, string> = {}): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el(tag, attrs) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

// A file input, with its chosen files readable.
export function fileField(attrs: Record<string, string> = {}): HTMLInputElement {
  return el("input", { type: "file", ...attrs }) as HTMLInputElement;
}

export async function announce(ctx: ScreenContext, message: string): Promise<void> {
  ctx.announcer.announce(message);
}

export function workingButton(
  label: string,
  run: () => Promise<void>,
  workingText: string,
): HTMLElement {
  const node = el("button", { type: "button" }, label);
  node.addEventListener("click", async () => {
    if (node.getAttribute("aria-disabled") === "true") return;
    const original = node.textContent ?? "";
    node.textContent = workingText;
    node.setAttribute("aria-disabled", "true");
    try {
      await run();
    } finally {
      node.textContent = original;
      node.removeAttribute("aria-disabled");
    }
  });
  return node;
}

export function valueOf(json: Json, key: string): string {
  const v = json[key];
  return v === null || v === undefined ? "" : String(v);
}
