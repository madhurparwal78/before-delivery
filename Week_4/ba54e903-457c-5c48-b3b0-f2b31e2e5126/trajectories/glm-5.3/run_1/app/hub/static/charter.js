/* Teen charter flip cards (DP-50). */
"use strict";
(() => {
  const cards = document.querySelectorAll(".flip-card");
  for (const card of cards) {
    const faces = ["Kind rooms", "Everyone speaks with care."];
    let i = 0;
    const inner = card.querySelector(".flip-inner");
    card.addEventListener("click", () => {
      i = 1 - i;
      card.setAttribute("aria-pressed", String(i === 1));
      if (inner) inner.textContent = faces[i];
    });
  }
})();
