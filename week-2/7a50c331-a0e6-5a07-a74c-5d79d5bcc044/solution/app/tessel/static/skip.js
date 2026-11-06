// The skip link is the first stop of the keyboard: Tab with nothing focused lands on it, wherever the page scrolled.
(() => {
  "use strict";
  const skip = document.querySelector(".skip-link");
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || !skip) return;
    if (document.activeElement === document.body || document.activeElement === document.documentElement) {
      e.preventDefault();
      skip.focus();
    }
  });
})();
