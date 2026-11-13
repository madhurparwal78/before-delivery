export function init() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;

  const select = (tab) => {
    tabs.forEach((other) => {
      const chosen = other === tab;
      other.setAttribute("aria-selected", String(chosen));
      other.tabIndex = chosen ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !chosen;
    });
    tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      if (event.key in moves) {
        event.preventDefault();
        select(tabs[(index + moves[event.key] + tabs.length) % tabs.length]);
      } else if (event.key === "Home") {
        event.preventDefault();
        select(tabs[0]);
      } else if (event.key === "End") {
        event.preventDefault();
        select(tabs[tabs.length - 1]);
      }
    });
  });
}
