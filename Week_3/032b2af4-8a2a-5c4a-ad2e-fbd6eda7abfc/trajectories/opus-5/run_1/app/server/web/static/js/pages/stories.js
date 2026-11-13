export function init() {
  const form = document.querySelector("[data-story-search]");
  const field = document.querySelector("#story-search");
  const cards = [...document.querySelectorAll("[data-story]")];
  const empty = document.querySelector("[data-story-empty]");
  if (!form) return;

  const filter = () => {
    const text = field.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const match = card.dataset.title.includes(text);
      card.hidden = !match;
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    filter();
  });
  field.addEventListener("input", filter);

  document.querySelectorAll("[data-story-page]").forEach((button) =>
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-story-page]")
        .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    })
  );
}
