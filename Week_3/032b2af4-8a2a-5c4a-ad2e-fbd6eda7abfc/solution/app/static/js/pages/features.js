import { $, $$ } from "../core/dom.js";

const tabs = $$("[role=tab]", $("[data-tablist]"));

function select(tab, focus) {
  for (const other of tabs) {
    const active = other === tab;
    other.setAttribute("aria-selected", String(active));
    other.tabIndex = active ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !active;
  }
  if (focus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => select(tab, false));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length], true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      select(event.key === "Home" ? tabs[0] : tabs[tabs.length - 1], true);
    }
  });
});
