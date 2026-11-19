// The group lead's page: site tree, group totals, every window's four scores, policy and verifier assignment.
import { h, commas, pct, targetWord, link, loadingFigure } from "../dom.js";
import { get, put, ApiError, SessionCancelled } from "../api.js";
import { announce } from "../announce.js";
import { problems } from "../problems.js";
import { poll } from "../poll.js";
import { table, row } from "../table.js";

const ASSIGNABLE = ["Awaiting meters", "Reconciling", "Returned"];
const SIGNED = ["Signed", "Sealed", "Restated"];
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;
const POLICY_MESSAGE = "Enter a percent from 0.00 to 100.00 with at most two decimals.";

// A typed percent of up to two decimals as basis points, converted digit by digit; null when it is not one.
export function percentToBp(text) {
  const found = PERCENT.exec(text.trim());
  if (!found) return null;
  const bp = parseInt(found[1], 10) * 100 + parseInt((found[2] || "").padEnd(2, "0"), 10);
  return bp <= 10000 ? bp : null;
}

export function mount({ container, query, shell, navigate }) {
  let groupReply = null;
  let firms = [];
  let siteFilter = query.get("site");
  const open = new Set(siteFilter ? [siteFilter] : []);
  let focusId = null;
  let last = "";
  const status = h("div", { role: "status", "aria-label": "Group status", "aria-live": "polite", class: "sr-only" });
  const tree = h("ul", { role: "tree", "aria-label": "Sites", class: "tree" });
  const showAll = h("button", { type: "button", text: "Show every site" });
  const totals = table("Group totals", ["Month", "Windows", "Consumed", "Month %", "Week %", "Day %", "Hour %", "Residual"], "auto auto minmax(190px, 1.6fr) repeat(4, auto) minmax(150px, 1fr)");
  const scores = table("Site scores", ["Window", "State", "Month", "Week", "Day", "Hour", "Target", "Residual", "Verifier"], "minmax(150px, 1.6fr) minmax(100px, 1fr) repeat(4, auto) minmax(90px, .8fr) minmax(110px, 1fr) minmax(200px, 2fr)");
  const policies = h("div", { class: "policies" });
  const loading = loadingFigure();
  const content = h("div", { class: "group-grid", hidden: true }, h("div", { class: "tree-wrap" }, tree, showAll),
    h("div", { class: "group-tables" }, totals.el, scores.el, policies));
  container.replaceChildren(h("section", { class: "page field-yellow" }, h("h1", { text: "EVERY SITE. EVERY GRAIN." }), status, loading, content));

  const sites = () => {
    const found = new Map();
    for (const w of groupReply.windows) if (!found.has(w.site.id)) found.set(w.site.id, w.site);
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const known = (id) => sites().some((site) => site.id === id);
  const visibleWindows = () => groupReply.windows.filter((w) => !siteFilter || w.site.id === siteFilter);

  // ---- tree ------------------------------------------------------------------------------------------------
  function visibleItems() {
    return [...tree.querySelectorAll('[role="treeitem"]')];
  }

  function renderTree() {
    const wasFocused = tree.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const items = [];
    for (const site of sites()) {
      const isOpen = open.has(site.id);
      const labelId = `tree-${site.id}`;
      const children = groupReply.windows.filter((w) => w.site.id === site.id);
      const groupId = `tree-group-${site.id}`;
      // The windows sit in a sibling group the site item owns: the site item's own visible text stays its name.
      const li = h("li", { role: "treeitem", "aria-expanded": String(isOpen), "aria-labelledby": labelId, tabindex: "-1",
        "aria-owns": isOpen ? groupId : null, "data-id": site.id, "data-kind": "site", class: "tree-site" },
      h("span", { id: labelId, class: "tree-label", text: site.name }));
      items.push(li);
      if (isOpen) {
        items.push(h("ul", { role: "group", id: groupId }, children.map((w) => {
          const wid = `tree-${w.id}`;
          return h("li", { role: "treeitem", "aria-labelledby": wid, tabindex: "-1", "data-id": w.id, "data-parent": site.id, "data-kind": "window", class: "tree-window" },
            h("span", { id: wid, class: "tree-label", text: `${site.name} ${w.month}` }));
        })));
      }
    }
    tree.replaceChildren(...items);
    const all = visibleItems();
    const target = all.find((el) => el.dataset.id === (wasFocused || focusId)) || all[0];
    for (const el of all) el.tabIndex = el === target ? 0 : -1;
    if (wasFocused && target) target.focus({ preventScroll: true });
    focusId = target?.dataset.id || null;
  }

  function focusItem(el) {
    for (const treeitem of visibleItems()) treeitem.tabIndex = -1;
    el.tabIndex = 0;
    focusId = el.dataset.id;
    el.focus({ preventScroll: true });
  }

  function chooseSite(id) {
    siteFilter = id;
    const params = new URLSearchParams(location.search);
    if (id) params.set("site", id); else params.delete("site");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : ""));
    renderScores();
    announce(status, `${visibleWindows().length} windows shown.`);
  }

  function toggleSite(id) {
    if (open.has(id)) open.delete(id); else open.add(id);
    chooseSite(id);
    renderTree();
    const el = visibleItems().find((treeitem) => treeitem.dataset.id === id);
    if (el) focusItem(el);
  }

  tree.addEventListener("keydown", (event) => {
    const el = event.target.closest('[role="treeitem"]');
    if (!el || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = visibleItems();
    const index = all.indexOf(el);
    const isSite = el.dataset.kind === "site";
    let handled = true;
    switch (event.key) {
      case "ArrowDown": focusItem(all[Math.min(all.length - 1, index + 1)]); break;
      case "ArrowUp": focusItem(all[Math.max(0, index - 1)]); break;
      case "Home": focusItem(all[0]); break;
      case "End": focusItem(all[all.length - 1]); break;
      case "ArrowRight":
        if (isSite && !open.has(el.dataset.id)) { open.add(el.dataset.id); renderTree(); focusItem(visibleItems().find((i) => i.dataset.id === el.dataset.id)); }
        else if (isSite) focusItem(all[index + 1]);
        break;
      case "ArrowLeft":
        if (isSite && open.has(el.dataset.id)) { open.delete(el.dataset.id); renderTree(); focusItem(visibleItems().find((i) => i.dataset.id === el.dataset.id)); }
        else if (!isSite) focusItem(all.find((i) => i.dataset.kind === "site" && i.dataset.id === el.dataset.parent));
        break;
      case "Enter":
        if (isSite) toggleSite(el.dataset.id); else navigate(`/windows/${el.dataset.id}`);
        break;
      default: handled = false;
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  });
  tree.addEventListener("click", (event) => {
    const el = event.target.closest('[role="treeitem"]');
    if (!el) return;
    event.stopPropagation();
    if (el.dataset.kind === "site") toggleSite(el.dataset.id);
    else navigate(`/windows/${el.dataset.id}`);
  });
  showAll.addEventListener("click", () => chooseSite(null));

  // ---- tables ----------------------------------------------------------------------------------------------
  function renderTotals() {
    totals.body.replaceChildren(...groupReply.rollups.map((r) => row([
      ["Month", r.month], ["Windows", String(r.window_count)], ["Consumed", `${commas(r.consumed_wh)} Wh`],
      ["Month score", pct(r.scores.month_bp)], ["Week score", pct(r.scores.week_bp)], ["Day score", pct(r.scores.day_bp)],
      ["Hour score", pct(r.scores.hour_bp)], ["Residual", r.residual_emissions_g === null ? "unknown" : `${commas(r.residual_emissions_g)} g`]])));
  }

  const rowFor = new Map();
  function buildRow(w) {
    const text = (value) => h("span", { text: value });
    const cells = { state: text(""), month: text(""), week: text(""), day: text(""), hour: text(""), target: text(""), residual: text(""), firm: text("") };
    let assign = null;
    if (ASSIGNABLE.includes(w.state)) {
      const select = h("select", { "aria-label": "Verifier firm", "data-window": w.id },
        w.verifier_firm ? null : h("option", { value: "", text: "No firm" }),
        firms.map((f) => h("option", { value: f.id, text: f.name })));
      select.value = w.verifier_firm?.id ?? "";
      const button = h("button", { type: "button", text: "Assign" });
      button.addEventListener("click", () => assignFirm(w, select, button));
      assign = h("div", { class: "row" }, select, button);
    }
    const el = row([
      ["Window", link(`/windows/${w.id}`, `${w.site.name} ${w.month}`)], ["State", cells.state],
      ["Month", cells.month], ["Week", cells.week], ["Day", cells.day], ["Hour", cells.hour],
      ["Target", cells.target], ["Residual", cells.residual], ["Verifier", [cells.firm, assign]]]);
    return { el, cells, assignable: assign !== null };
  }

  function renderScores() {
    const wanted = visibleWindows().map((w) => {
      let entry = rowFor.get(w.id);
      if (!entry || entry.assignable !== ASSIGNABLE.includes(w.state)) { entry = buildRow(w); rowFor.set(w.id, entry); }
      const c = entry.cells;
      c.state.textContent = w.state;
      c.month.textContent = pct(w.scores.month_bp);
      c.week.textContent = pct(w.scores.week_bp);
      c.day.textContent = pct(w.scores.day_bp);
      c.hour.textContent = pct(w.scores.hour_bp);
      c.target.textContent = targetWord(w);
      c.residual.textContent = w.residual_emissions_g === null ? "unknown" : `${commas(w.residual_emissions_g)} g`;
      c.firm.textContent = w.verifier_firm ? w.verifier_firm.name : "";
      return entry.el;
    });
    const current = [...scores.body.children];
    if (wanted.length !== current.length || wanted.some((el, i) => el !== current[i])) scores.body.replaceChildren(...wanted);
  }

  async function assignFirm(w, select, button) {
    if (button.getAttribute("aria-disabled") === "true" || !select.value) return;
    button.setAttribute("aria-disabled", "true");
    try {
      await put(`/api/windows/${w.id}/verifier`, { firm_id: select.value });
      announce(status, "Verifier firm assigned.");
      await refresh();
    } catch (error) {
      if (error instanceof SessionCancelled) return;
      if (!(error instanceof ApiError)) throw error;
      announce(status, error.message);
    } finally {
      button.removeAttribute("aria-disabled");
    }
  }

  // ---- policy ----------------------------------------------------------------------------------------------
  const policyFor = new Map();
  function renderPolicies() {
    for (const site of sites()) {
      const unsigned = groupReply.windows.find((w) => w.site.id === site.id && !SIGNED.includes(w.state)) || groupReply.windows.find((w) => w.site.id === site.id);
      const current = unsigned.target;
      let entry = policyFor.get(site.id);
      if (!entry) {
        const list = problems();
        const grain = h("select", { id: `grain-${site.id}` }, ["MONTH", "WEEK", "DAY", "HOUR"].map((g) => h("option", { value: g, text: g })));
        const percent = h("input", { id: `percent-${site.id}`, type: "text", inputmode: "decimal", autocomplete: "off" });
        const save = h("button", { type: "button", text: "Save policy" });
        const region = h("section", { role: "region", "aria-label": `${site.name} policy`, class: "policy field-white" },
          h("h2", { text: site.name }),
          h("label", { for: grain.id, text: "Target grain" }), grain,
          h("label", { for: percent.id, text: "Target percent" }), percent, list.el, save);
        grain.addEventListener("input", () => { entry.touched = true; });
        percent.addEventListener("input", () => { entry.touched = true; });
        save.addEventListener("click", async () => {
          if (save.getAttribute("aria-disabled") === "true") return;
          const bp = percentToBp(percent.value);
          if (bp === null) { list.show("", [{ message: POLICY_MESSAGE, target: percent }]); return; }
          list.clear();
          save.setAttribute("aria-disabled", "true");
          try {
            await put(`/api/sites/${site.id}/policy`, { target_grain: grain.value, target_bp: bp });
            entry.touched = false;
            announce(status, `Policy saved for ${site.name}.`);
            await refresh();
          } catch (error) {
            if (error instanceof SessionCancelled) return;
            if (!(error instanceof ApiError)) throw error;
            list.fromError(error, { target_grain: grain, target_bp: percent });
          } finally {
            save.removeAttribute("aria-disabled");
          }
        });
        entry = { region, grain, percent, touched: false };
        policyFor.set(site.id, entry);
      }
      if (!entry.touched) {
        entry.grain.value = current.grain;
        entry.percent.value = pct(current.bp);
      }
    }
    policies.replaceChildren(...sites().map((site) => policyFor.get(site.id).region));
  }

  async function refresh() {
    const next = await get("/api/group/scores", { background: true });
    if (!firms.length) firms = (await get("/api/firms", { background: true })).firms;
    const serial = JSON.stringify(next);
    if (serial === last) return;
    last = serial;
    groupReply = next;
    if (siteFilter && !known(siteFilter)) siteFilter = null;
    if (siteFilter) open.add(siteFilter);
    loading.remove();
    content.hidden = false;
    renderTree();
    renderTotals();
    renderScores();
    renderPolicies();
  }

  refresh();
  const loop = poll(refresh, 3000);
  return {
    unmount() { loop.stop(); },
    onUrl(next) { siteFilter = next.get("site"); if (groupReply) { if (siteFilter && !known(siteFilter)) siteFilter = null; renderScores(); } },
  };
}
