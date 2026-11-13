import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, QueueSegment, hhmm, statusWord } from "../api";
import { emptyIllustration } from "../illustrations";

export async function renderReviewPage(ctx: PageCtx): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  const isOwner = ctx.user.role === "owner";
  const params = new URLSearchParams(location.search);
  const lang = params.get("lang");

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, "Review queue"),
      h("p", { class: "sub" }, "Shortcuts: J next, K previous, A approve, C correct.")),
  ));

  const region = h("section", { role: "region", "aria-label": "Review queue" });
  container.appendChild(region);
  const refreshBtnHolder = h("div", { class: "mt-16", style: "display:flex;justify-content:center" });
  container.appendChild(refreshBtnHolder);
  main.appendChild(container);

  let segments: QueueSegment[] = [];
  let currentId: string | null = null;
  const articles = new Map<string, HTMLElement>();

  async function loadQueue(): Promise<void> {
    const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
    const hadFocusInside = region.contains(document.activeElement);
    try {
      const res = await api<{ segments: QueueSegment[] }>(`/api/review-queue${query}`);
      const fresh = res.segments;
      const stillThere = new Set(fresh.map((s) => s.segment_id));
      if (currentId && !stillThere.has(currentId)) currentId = null;
      segments = fresh;
      renderQueue();
      if (hadFocusInside && !region.contains(document.activeElement)) {
        const card = articles.get(currentId || "");
        if (card) {
          const btn = card.querySelector<HTMLElement>(".btn-primary") || card;
          btn.focus();
        }
      }
    } catch (e: any) {
      ctx.fb.setProblem(e.message);
    }
  }

  function renderQueue(): void {
    clearEl(region);
    articles.clear();
    if (segments.length === 0) {
      const empty = h("div", { class: "empty" });
      empty.innerHTML = emptyIllustration();
      empty.appendChild(h("h3", {}, "Nothing to review right now"));
      empty.appendChild(h("p", { class: "muted" }, isOwner
        ? "Segments that score below a project's MQM threshold land here."
        : "When the engineer assigns segments to you, they'll show up here."));
      const refresh = h("button", { class: "btn btn-primary", onclick: () => void loadQueue() }, "Refresh queue");
      empty.appendChild(refresh);
      region.appendChild(empty);
      return;
    }
    if (!currentId) currentId = segments[0].segment_id;
    for (const s of segments) {
      const card = buildCard(s);
      articles.set(s.segment_id, card);
      region.appendChild(card);
    }
    updateCurrent();
  }

  function buildCard(s: QueueSegment): HTMLElement {
    const art = h("article", { class: "q-card", "aria-label": `${s.key} (${s.language})`, "aria-current": "false", tabindex: "-1" });
    const head = h("div", { class: "spread" },
      h("div", null,
        h("h3", { class: "mono", style: "font-size:1.02em" }, s.key),
        h("p", { class: "muted small", style: "margin-top:4px" }, `${s.project} · ${s.branch} · ${s.language}`)),
      h("span", { class: "pill" }, h("i", { class: `sq ${s.status === "approved" ? "on" : ""}` }), statusWord(s.status)),
    );
    art.appendChild(head);
    const sourceP = h("p", { style: "margin-top:10px;font-weight:600" }, s.removed ? `This key was removed on ${s.branch}.` : (s.source || ""));
    art.appendChild(sourceP);
    const valueP = h("p", { class: "muted", style: "margin-top:6px" }, s.value || "");
    art.appendChild(valueP);
    const meta = h("p", { class: "small muted", style: "margin-top:8px" },
      `${s.score === null ? "Not scored" : `MQM ${s.score}`}${s.expires_at ? ` · until ${hhmm(s.expires_at)}` : ""}`);
    art.appendChild(meta);
    if (s.issues.length) {
      const ul = h("ul", { class: "info-list", style: "margin-top:8px" });
      for (const i of s.issues) ul.appendChild(h("li", null, h("span", null, `${i.category} · ${i.severity}`), h("span", { class: "muted small" }, i.note || "")));
      art.appendChild(ul);
    }
    const approve = h("button", { class: "btn btn-primary btn-sm", onclick: () => approveSeg(s), disabled: s.removed ? true : undefined }, "Approve");
    const correct = h("button", { class: "btn btn-outline btn-sm", onclick: () => openCorrect(s, correct), disabled: s.removed ? true : undefined }, "Correct");
    art.appendChild(h("div", { class: "q-grid mt-16" },
      h("div", { class: "btns" }, approve, correct),
    ));
    return art;
  }

  function updateCurrent(): void {
    for (const [id, el] of articles) el.setAttribute("aria-current", id === currentId ? "true" : "false");
  }

  function move(dir: 1 | -1): void {
    const idx = segments.findIndex((s) => s.segment_id === currentId);
    if (idx === -1) return;
    const next = segments[(idx + dir + segments.length) % segments.length];
    currentId = next.segment_id;
    updateCurrent();
    const el = articles.get(next.segment_id);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      const btn = el.querySelector<HTMLElement>(".btn-primary");
      if (btn) btn.focus();
    }
  }

  async function approveSeg(s: QueueSegment): Promise<void> {
    ctx.fb.setStatus("Approving.");
    try {
      await api(`/api/segments/${s.segment_id}/approve`, { method: "POST", json: {} });
      ctx.fb.setStatus("Approved.");
      await loadQueue();
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    }
  }

  function openCorrect(s: QueueSegment, opener: HTMLElement): void {
    const valueBox = h("textarea", { class: "control", "aria-label": "Corrected translation", rows: "4" }) as HTMLTextAreaElement;
    valueBox.value = s.value || "";
    const commentBox = h("input", { class: "control", "aria-label": "Comment" }) as HTMLInputElement;
    const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Correct segment" });
    dlg.appendChild(h("h2", {}, "Correct segment"));
    dlg.appendChild(h("p", { class: "sub" }, `${s.key} (${s.language})`));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Corrected translation"), valueBox));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Comment"), commentBox));
    const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
    const save = h("button", { class: "btn btn-primary" }, "Save correction");
    dlg.appendChild(h("div", { class: "actions-row" }, cancel, save));
    const dialog = new Dialog(dlg, opener);
    dialog.open();
    cancel.addEventListener("click", () => dialog.close(false));
    save.addEventListener("click", async () => {
      save.disabled = true;
      ctx.fb.setStatus("Saving correction.");
      try {
        await api(`/api/segments/${s.segment_id}/correct`, { method: "POST", json: { value: valueBox.value, comment: commentBox.value.trim() || undefined } });
        ctx.fb.setStatus("Correction saved and approved.");
        dialog.close(true);
        await loadQueue();
        // focus returns to the current card's Correct button
        const card = articles.get(currentId || "");
        if (card) {
          const btn = card.querySelector<HTMLElement>("button.btn-outline");
          if (btn) btn.focus();
        }
      } catch (e: any) {
        save.disabled = false;
        ctx.fb.clearStatus();
        ctx.fb.setProblem(e.message);
        valueBox.focus();
      }
    });
  }

  // keyboard shortcuts inside the region
  region.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    const k = ev.key.toLowerCase();
    if (k === "j") { ev.preventDefault(); move(1); }
    else if (k === "k") { ev.preventDefault(); move(-1); }
    else if (k === "a") { ev.preventDefault(); const s = segments.find((x) => x.segment_id === currentId); if (s && !s.removed) void approveSeg(s); }
    else if (k === "c") {
      ev.preventDefault();
      const s = segments.find((x) => x.segment_id === currentId);
      if (s && !s.removed) {
        const card = articles.get(s.segment_id);
        const btn = card ? card.querySelector<HTMLElement>("button.btn-outline") : null;
        openCorrect(s, btn || (card as HTMLElement));
      }
    }
  });

  const refreshBtn = h("button", { class: "btn btn-outline", onclick: () => void loadQueue() }, "Refresh queue");
  refreshBtnHolder.appendChild(refreshBtn);
  await loadQueue();
  const timer = setInterval(() => void loadQueue(), 15000);
  window.addEventListener("popstate", () => clearInterval(timer), { once: true });
}
