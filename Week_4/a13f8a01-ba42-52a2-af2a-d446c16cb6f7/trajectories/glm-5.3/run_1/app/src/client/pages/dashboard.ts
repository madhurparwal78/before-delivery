import { el, button, link, navigate } from "../lib/dom.js";
import { Api, formatDateTime, type PenSummary } from "../lib/api.js";
import { buildHeader, meSync } from "../lib/header.js";
import { buildVerifyBanner, type VerifyBanner } from "../lib/verify.js";
import { PreviewStage } from "../lib/preview.js";

export async function dashboardPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  buildHeader(root);

  const user = meSync();
  const banner: VerifyBanner | null = user && !user.verified ? buildVerifyBanner(user) : null;

  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset" });
  const stageInner = el("div", { class: "stage-inner" });
  stage.appendChild(stageInner);
  const preview = new PreviewStage(stageInner);

  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });
  if (banner) body.appendChild(banner.node);

  const dashboardStatus = el("div", { role: "status", "aria-label": "Dashboard status", class: "status" });
  const start = button("Start a pen", { class: "primary" }, async () => {
    const pen = await Api.post<{ id: string }>("/api/pens", {});
    navigate(`/pen/${pen.id}`);
  });
  body.appendChild(start);
  body.appendChild(dashboardStatus);

  const list = el("ul", { "aria-label": "Your pens", class: "list", role: "list" });
  body.appendChild(list);

  const pens = await Api.get<{ pens: PenSummary[] }>("/api/pens");
  if (pens.pens.length === 0) {
    const empty = el("div", { class: "panel", role: "region" });
    empty.textContent = "You have no pens yet. Start one, and every save becomes a version you can go back to.";
    body.appendChild(empty);
  } else {
    for (const pen of pens.pens) {
      const row = penRow(pen, () => {
        void preview.renderPen(pen.id, pen.head, []);
      });
      list.appendChild(row);
    }
    // The first pen renders right away.
    void preview.renderPen(pens.pens[0]!.id, pens.pens[0]!.head, []);
  }

  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}

export function penRow(pen: PenSummary, onFocus: () => void, options: { withOwner?: boolean } = {}): HTMLLIElement {
  const li = el("li", { class: "listitem-row", role: "listitem", tabindex: "-1" });
  const top = el("div", { class: "row-top" });
  const title = link(`/pen/${pen.id}`, pen.title, { class: "row-title" });
  top.appendChild(title);
  const meta = el("span", { class: "row-meta" });
  meta.textContent = `Version ${pen.head} · Updated ${formatDateTime(pen.updated_at)} · ${pen.likes === 1 ? "1 like" : `${pen.likes} likes`}`;
  top.appendChild(meta);
  li.appendChild(top);
  if (pen.tags.length > 0) {
    const tags = el("div", { class: "row-tags" });
    tags.textContent = pen.tags.join(" ");
    li.appendChild(tags);
  }
  if (options.withOwner) {
    const owner = el("div", { class: "row-tags" });
    owner.textContent = `by ${pen.owner}`;
    li.appendChild(owner);
  }
  li.addEventListener("focusin", onFocus);
  li.addEventListener("mouseenter", onFocus);
  return li;
}
