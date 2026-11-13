const NS = "http://www.w3.org/2000/svg";

const SHAPES = {
  crown: '<path d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4z" fill="currentColor"></path>',
  medal:
    '<path d="M8 2l2 7h4l2-7" stroke="currentColor" stroke-width="2" fill="none"></path>' +
    '<circle cx="12" cy="16" r="5.5" fill="currentColor"></circle>',
};

export function award(kind, text, tone) {
  const wrapper = document.createElement("span");
  wrapper.className = `medal ${tone}`;
  const glyph = document.createElementNS(NS, "svg");
  glyph.setAttribute("viewBox", "0 0 24 24");
  glyph.setAttribute("width", "18");
  glyph.setAttribute("height", "18");
  glyph.setAttribute("aria-hidden", "true");
  glyph.setAttribute("focusable", "false");
  glyph.innerHTML = SHAPES[kind];
  wrapper.append(glyph, document.createTextNode(` ${text}`));
  return wrapper;
}
