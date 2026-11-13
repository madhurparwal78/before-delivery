import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, ProjectDetail, KeyRow, Segment, statusWord, Issue } from "../api";
import { icon } from "../illustrations";

const CATS = ["accuracy", "fluency", "terminology", "style", "locale-convention"];
const SEVS = ["minor", "major", "critical"];

export async function renderEditorPage(ctx: PageCtx, slug: string): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = slug;
  const params = new URLSearchParams(location.search);
  const branch = params.get("branch") || "main";
  const lang = params.get("lang");
  let language = lang;

  const detail = await api<ProjectDetail>(`/api/projects/${slug}`);
  if (!language) language = detail.target_languages[0];
  window.__deskCurrentLang = language;

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, `Segment editor`), h("p", { class: "sub" }, `${detail.name} · ${branch} · ${language}`)),
    h("div", { class: "row" },
      h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}` }, "Back to project"),
      h("button", { class: "btn btn-outline btn-sm", onclick: () => openIssueDialog(ctx) }, "Record MQM issue"),
    ),
  ));

  const grid = h("div", { class: "editor-grid", style: "margin-top:20px" });
  const segCol = h("div", { class: "col-seg", role: "region", "aria-label": "Segments" });
  const edCol = h("div", { class: "col-ed", role: "region", "aria-label": "Segment editor" });
  const qCol = h("div", { class: "col-quality", role: "region", "aria-label": "Quality and history" });
  grid.appendChild(segCol);
  grid.appendChild(edCol);
  grid.appendChild(qCol);
  container.appendChild(grid);
  main.appendChild(container);

  let keys: KeyRow[] = [];
  let currentKey: KeyRow | null = null;
  let currentSegment: Segment | null = null;

  async function loadKeys(): Promise<void> {
    const res = await api<{ keys: KeyRow[] }>(`/api/projects/${slug}/branches/${encodeURIComponent(branch)}/keys?lang=${language}`);
    keys = res.keys;
    renderKeyList();
    const wanted = params.get("segment");
    const initial = keys.find((k) => k.translations[language!]?.segment_id === wanted) || keys.find((k) => k.translations[language!]?.status !== "approved") || keys[0];
    if (initial) selectKey(initial, false);
  }

  function renderKeyList(): void {
    clearEl(segCol);
    const list = h("div", { class: "seg-list" });
    for (const k of keys) {
      const seg = k.translations[language!];
      const btn = h("button", { class: "seg-item", "aria-current": k === currentKey ? "true" : "false", onclick: () => selectKey(k, true) },
        h("span", { class: "key" }, k.name),
        h("span", { class: "st" }, seg ? statusWord(seg.status) : "—"),
      );
      list.appendChild(btn);
    }
    segCol.appendChild(list);
  }

  async function selectKey(k: KeyRow, updateUrl: boolean): Promise<void> {
    currentKey = k;
    const segSummary = k.translations[language!];
    if (updateUrl) {
      const sid = segSummary ? segSummary.segment_id : "";
      history.replaceState(null, "", `/projects/${slug}/editor?branch=${encodeURIComponent(branch)}&lang=${language}&segment=${sid}`);
    }
    renderKeyList();
    if (!segSummary) { renderNoSegment(); return; }
    try {
      const seg = await api<Segment>(`/api/segments/${segSummary.segment_id}`);
      currentSegment = seg;
      renderEditor(seg);
      renderQuality(seg);
    } catch (e: any) {
      ctx.fb.setProblem(e.message);
    }
  }

  function renderNoSegment(): void {
    clearEl(edCol);
    edCol.appendChild(h("div", { class: "card" }, h("h3", {}, "No segment"), h("p", { class: "muted" }, "This key has no segment in this language.")));
    clearEl(qCol);
  }

  const translationBox = h("textarea", { class: "control", "aria-label": `Translation (${language})`, rows: "5" }) as HTMLTextAreaElement;
  const saveBtn = h("button", { class: "btn btn-primary", onclick: saveTranslation, "data-ctrl-enter": "" }, "Save translation");
  const issueBtn = h("button", { class: "btn btn-outline", onclick: () => openIssueDialog(ctx) }, "Record MQM issue");
  const scoreBtn = h("button", { class: "btn btn-outline", onclick: scoreSegment }, "Score");
  const approveBtn = h("button", { class: "btn btn-outline", onclick: approveSegment }, "Approve");

  function renderEditor(seg: Segment): void {
    clearEl(edCol);
    const card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "pill", style: "margin-bottom:14px" }, h("i", { class: `sq ${seg.status === "approved" ? "on" : ""}` }), statusWord(seg.status)));
    card.appendChild(h("h3", { class: "mono", style: "font-size:1.05em" }, seg.key));
    card.appendChild(h("p", { class: "muted", style: "margin-top:6px" }, seg.source || ""));
    const tb = translationBox;
    tb.value = seg.value || "";
    tb.setAttribute("aria-label", `Translation (${language})`);
    card.appendChild(h("label", { class: "field", style: "margin-top:16px" }, h("span", { class: "label" }, `Translation (${language})`), tb));
    const row = h("div", { class: "row" }, saveBtn, issueBtn, scoreBtn, approveBtn);
    card.appendChild(row);
    card.appendChild(h("p", { class: "small muted", style: "margin-top:12px" }, "Ctrl+Enter (Cmd+Enter on macOS) saves."));
    approveBtn.disabled = !(seg.status === "scored" || seg.status === "needs_review");
    edCol.appendChild(card);
  }

  function renderQuality(seg: Segment): void {
    clearEl(qCol);
    const card = h("div", { class: "card" });
    card.appendChild(h("h3", { style: "font-size:1.15em" }, "Quality and history"));
    card.appendChild(h("p", { style: "margin-top:12px" }, seg.score === null ? "Not scored" : `MQM ${seg.score}`));
    const issues = h("ul", { class: "info-list" });
    if (seg.issues.length === 0) issues.appendChild(h("li", null, h("span", { class: "muted" }, "No issues recorded.")));
    for (const i of seg.issues) issues.appendChild(h("li", null, h("span", null, `${i.category} · ${i.severity}`), h("span", { class: "muted small" }, i.note || "")));
    card.appendChild(issues);

    const tmBox = h("div", { class: "card", style: "background:var(--band);border:none;margin-top:16px" });
    tmBox.appendChild(h("h4", { style: "font-size:1em" }, "Exact match from translation memory"));
    card.appendChild(h("div", { style: "margin-top:16px" }, tmBox));
    api<{ match: any }>(`/api/projects/${slug}/tm/match`, { method: "POST", json: { source: seg.source, language } }).then((res) => {
      clearEl(tmBox);
      if (res.match) {
        tmBox.appendChild(h("h4", { style: "font-size:1em" }, "Exact match from translation memory"));
        tmBox.appendChild(h("p", { class: "mono", style: "margin-top:6px" }, res.match.reused_value));
      } else {
        tmBox.appendChild(h("p", { class: "muted" }, "No exact match."));
      }
    }).catch(() => {
      clearEl(tmBox);
      tmBox.appendChild(h("p", { class: "muted" }, "No exact match."));
    });

    const comments = h("div", { style: "margin-top:16px" });
    comments.appendChild(h("h4", { style: "font-size:1em" }, "Comments"));
    const cList = h("ul", { class: "info-list" });
    if (seg.comments.length === 0) cList.appendChild(h("li", null, h("span", { class: "muted" }, "No comments.")));
    for (const c of seg.comments) cList.appendChild(h("li", null, h("span", null, c.body), h("span", { class: "muted small" }, `${c.author}`)));
    comments.appendChild(cList);
    const commentBox = h("input", { class: "control", placeholder: "Add a comment", "aria-label": "Comment" }) as HTMLInputElement;
    const addComment = h("button", { class: "btn btn-outline btn-sm", onclick: async () => {
      if (!currentSegment || !commentBox.value.trim()) return;
      try {
        await api(`/api/segments/${currentSegment.id}/comments`, { method: "POST", json: { body: commentBox.value.trim() } });
        commentBox.value = "";
        await selectKey(currentKey!, false);
      } catch (e: any) { ctx.fb.setProblem(e.message); }
    } }, "Comment");
    comments.appendChild(h("div", { class: "row mt-12" }, commentBox, addComment));
    card.appendChild(comments);

    const hist = h("div", { style: "margin-top:16px" });
    hist.appendChild(h("h4", { style: "font-size:1em" }, "Status history"));
    const hList = h("ul", { class: "info-list" });
    if (seg.history.length === 0) hList.appendChild(h("li", null, h("span", { class: "muted" }, "No history.")));
    for (const item of seg.history) hList.appendChild(h("li", null, h("span", null, `${item.from || "—"} → ${item.to}`), h("span", { class: "muted small" }, item.at)));
    hist.appendChild(hList);
    card.appendChild(hist);
    qCol.appendChild(card);
  }

  async function saveTranslation(): Promise<void> {
    if (!currentSegment) return;
    saveBtn.disabled = true;
    ctx.fb.setStatus("Saving.");
    try {
      await api(`/api/segments/${currentSegment.id}/value`, { method: "PUT", json: { value: translationBox.value } });
      ctx.fb.setStatus(`Saved ${currentSegment.key}.`);
      await selectKey(currentKey!, false);
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    } finally { saveBtn.disabled = false; }
  }

  async function scoreSegment(): Promise<void> {
    if (!currentSegment) return;
    scoreBtn.disabled = true;
    ctx.fb.setStatus("Recording MQM issues.");
    try {
      const seg = await api<Segment>(`/api/segments/${currentSegment.id}/score`, { method: "POST", json: { issues: [] } });
      ctx.fb.setStatus(seg.score !== null && seg.score < threshold(detail) ? `Scored MQM ${seg.score}. Sent to review.` : `Scored MQM ${seg.score}.`);
      await selectKey(currentKey!, false);
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    } finally { scoreBtn.disabled = false; }
  }

  async function approveSegment(): Promise<void> {
    if (!currentSegment) return;
    approveBtn.disabled = true;
    ctx.fb.setStatus("Approving.");
    try {
      await api(`/api/segments/${currentSegment.id}/approve`, { method: "POST", json: {} });
      ctx.fb.setStatus("Approved.");
      await selectKey(currentKey!, false);
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    } finally { approveBtn.disabled = false; }
  }

  function threshold(d: ProjectDetail): number { return d.mqm_threshold; }

  function openIssueDialog(ctx2: PageCtx): void {
    if (!currentSegment) return;
    const catSel = h("select", { class: "control", "aria-label": "Category" }) as HTMLSelectElement;
    for (const c of CATS) catSel.appendChild(h("option", { value: c }, c));
    const sevSel = h("select", { class: "control", "aria-label": "Severity" }) as HTMLSelectElement;
    for (const s of SEVS) sevSel.appendChild(h("option", { value: s }, s));
    const note = h("input", { class: "control", "aria-label": "Note" }) as HTMLInputElement;
    const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Record MQM issue" });
    dlg.appendChild(h("h2", {}, "Record MQM issue"));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Category"), catSel));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Severity"), sevSel));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Note"), note));
    const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
    const add = h("button", { class: "btn btn-primary" }, "Add issue");
    dlg.appendChild(h("div", { class: "actions-row" }, cancel, add));
    const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
    dialog.open();
    cancel.addEventListener("click", () => dialog.close(false));
    add.addEventListener("click", async () => {
      add.disabled = true;
      ctx2.fb.setStatus("Recording MQM issues.");
      try {
        const seg = await api<Segment>(`/api/segments/${currentSegment!.id}/issues`, { method: "POST", json: { category: catSel.value, severity: sevSel.value, note: note.value.trim() } });
        ctx2.fb.setStatus(seg.score !== null && seg.score < detail.mqm_threshold ? `Scored MQM ${seg.score}. Sent to review.` : `Scored MQM ${seg.score}.`);
        dialog.close(true);
        await selectKey(currentKey!, false);
      } catch (e: any) {
        add.disabled = false;
        ctx2.fb.clearStatus();
        ctx2.fb.setProblem(e.message);
      }
    });
  }

  await loadKeys();
}
