import { el, link, heading } from "../lib/dom.js";

export async function notFoundPage(root: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
  void params;
  void path;
  root.innerHTML = "";
  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset" });
  stage.setAttribute("aria-hidden", "true");
  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });
  body.appendChild(heading(1, "Nothing here"));
  const line = el("p", { text: "This pen does not exist, or it is not shared with you." });
  body.appendChild(line);
  body.appendChild(el("p", {}, link("/explore", "Go to Explore")));
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}
