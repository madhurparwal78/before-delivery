import { h } from "./dom.js";

interface TabsConfig {
  label: string;
  id: string;
  names: readonly string[];
  panels: readonly HTMLElement[];
  /** The visitor chose a tab by click, tap or key. */
  onChoose?(index: number): void;
}

/**
 * A tablist with one Tab stop, arrow, Home and End keys, and automatic selection. `show` selects a tab and its panel
 * without announcing anything (scrolling, or a rebuilt page).
 */
export function createTabs({ label, id, names, panels, onChoose }: TabsConfig) {
  let selected = 0;
  const tabs = names.map((name, index) =>
    h("button", { type: "button", role: "tab", id: `${id}-tab-${index}`, "aria-controls": `${id}-panel-${index}`, class: "tab" }, name),
  );
  panels.forEach((panel, index) => {
    panel.setAttribute("role", "tabpanel");
    panel.id = `${id}-panel-${index}`;
    panel.setAttribute("aria-labelledby", `${id}-tab-${index}`);
    panel.tabIndex = 0;
  });

  const show = (index: number): void => {
    selected = index;
    tabs.forEach((tab, position) => {
      tab.setAttribute("aria-selected", String(position === index));
      tab.tabIndex = position === index ? 0 : -1;
    });
    panels.forEach((panel, position) => {
      panel.hidden = position !== index;
    });
  };

  const choose = (index: number, focus: boolean): void => {
    show(index);
    if (focus) tabs[index].focus({ preventScroll: true });
    onChoose?.(index);
  };

  const element = h("div", { class: "tablist", role: "tablist", "aria-label": label }, ...tabs);
  tabs.forEach((tab, index) => tab.addEventListener("click", () => choose(index, false)));
  element.addEventListener("keydown", (event) => {
    const last = tabs.length - 1;
    const target: Record<string, number> = { ArrowRight: selected === last ? 0 : selected + 1, ArrowLeft: selected === 0 ? last : selected - 1, Home: 0, End: last };
    const index = target[event.key];
    if (index === undefined) return;
    event.preventDefault();
    choose(index, true);
  });
  show(0);
  return { element, show };
}
