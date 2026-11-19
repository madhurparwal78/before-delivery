// The one address combobox: asks after a pause, reuses what the page has, ignores older replies.
import { announce, call, safely } from "./core.js";

const DEBOUNCE_MS = 300;
const ADDRESS_DOWN = "We could not check this address. You can carry on and type it in full.";
const known = new Map<string, { id: string; text: string }[]>();
let timer = 0;
let asked = 0;
let current: HTMLInputElement | null = null;
let activeIndex = -1;

const list = (): HTMLElement => {
  let box = document.getElementById("address-list");
  if (!box) {
    box = document.createElement("ul");
    box.id = "address-list";
    box.className = "address-list";
    box.setAttribute("role", "listbox");
    box.setAttribute("aria-label", "Addresses");
    box.setAttribute("data-client-owned", "");
    box.hidden = true;
    document.getElementById("overlays")?.append(box);
  }
  return box;
};
const isListOpen = (): boolean => !list().hidden;
export const closeList = (): void => {
  const box = list();
  box.hidden = true;
  box.replaceChildren();
  activeIndex = -1;
  if (current) {
    current.setAttribute("aria-expanded", "false");
    current.removeAttribute("aria-activedescendant");
  }
};
const place = (box: HTMLElement, input: HTMLInputElement): void => {
  const rect = input.getBoundingClientRect();
  box.style.left = `${Math.max(rect.left, 4)}px`;
  box.style.width = `${Math.min(rect.width, innerWidth - 8)}px`;
  box.style.top = "0";
  box.style.maxHeight = "none";
  const height = box.offsetHeight;
  const below = innerHeight - rect.bottom;
  const top = below >= height || below >= rect.top ? rect.bottom : Math.max(rect.top - height, 4);
  box.style.top = `${Math.min(top, Math.max(innerHeight - height - 4, 4))}px`;
};
const show = (input: HTMLInputElement, suggestions: { id: string; text: string }[]): void => {
  const box = list();
  current = input;
  box.replaceChildren(...suggestions.map((s, i) => {
    const option = document.createElement("li");
    option.id = `address-option-${i}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.id = s.id;
    option.textContent = s.text;
    return option;
  }));
  box.hidden = suggestions.length === 0;
  activeIndex = -1;
  input.setAttribute("aria-controls", box.id);
  input.setAttribute("aria-expanded", String(suggestions.length > 0));
  input.removeAttribute("aria-activedescendant");
  if (suggestions.length) place(box, input);
  announce(`${suggestions.length} suggestions.`, false);
};
const ask = async (input: HTMLInputElement, text: string): Promise<void> => {
  const mine = (asked += 1);
  const have = known.get(text);
  if (have) return show(input, have);
  const reply = await safely(() => call("GET", `/api/public/address/find?q=${encodeURIComponent(text)}`));
  if (reply.ok) known.set(text, reply.json.suggestions);
  if (mine !== asked || document.activeElement !== input) return;
  if (!reply.ok) {
    closeList();
    return announce(ADDRESS_DOWN, false);
  }
  show(input, reply.json.suggestions);
};
const choose = async (input: HTMLInputElement, option: HTMLElement): Promise<void> => {
  const text = option.textContent ?? "";
  closeList();
  asked += 1;
  input.value = text;
  const reply = await safely(() => call("GET", `/api/public/address/get/${encodeURIComponent(option.dataset.id ?? "")}`));
  if (reply.ok) {
    input.value = reply.json.text;
    input.dataset.checked = "true";
  } else {
    input.dataset.checked = "false";
    announce(ADDRESS_DOWN, false);
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const moveActive = (input: HTMLInputElement, by: number): void => {
  const options = [...list().children] as HTMLElement[];
  if (!options.length) return;
  options[activeIndex]?.setAttribute("aria-selected", "false");
  activeIndex = (activeIndex + by + options.length) % options.length;
  options[activeIndex].setAttribute("aria-selected", "true");
  input.setAttribute("aria-activedescendant", options[activeIndex].id);
  options[activeIndex].scrollIntoView({ block: "nearest" });
};

export const initAddress = (): void => {
  document.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches?.("[data-address]")) return;
    input.dataset.checked = "false";
    clearTimeout(timer);
    current = input;
    const text = input.value;
    if (Array.from(text.trim()).length < 3) {
      asked += 1;
      return closeList();
    }
    timer = window.setTimeout(() => void ask(input, text), DEBOUNCE_MS);
  });
  document.addEventListener("keydown", (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches?.("[data-address]") || !isListOpen()) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(input, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      closeList();
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void choose(input, list().children[activeIndex] as HTMLElement);
    } else if (event.key === "Tab") closeList();
  }, true);
  document.addEventListener("focusout", (event) => {
    if ((event.target as HTMLElement).matches?.("[data-address]")) {
      clearTimeout(timer);
      asked += 1;
      closeList();
    }
  });
  document.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest?.("#address-list")) event.preventDefault();
  });
  document.addEventListener("click", (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>("#address-list [role=option]");
    if (option && current) void choose(current, option);
  });
  addEventListener("resize", () => closeList());
};
