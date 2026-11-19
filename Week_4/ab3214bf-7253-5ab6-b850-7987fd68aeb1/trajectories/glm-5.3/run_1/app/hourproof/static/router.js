/* Group scores, public check page, router, boot. */
"use strict";

async function renderGroup() {
  let data = null, firms = [];
  try {
    data = await api("GET", "/api/group/scores");
    firms = (await api("GET", "/api/firms")).firms;
  } catch (err) { return renderSignIn(); }
  const groupStatus = el("div", { role: "status", "aria-label": "Group status" });
  const siteFilter = new URLSearchParams(location.search).get("site");

  const tree = el("ul", { role: "tree", "aria-label": "Sites", class: "site-tree" });
  const showAll = el("button", { text: "Show every site" });
  showAll.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.delete("site");
    history.pushState({}, "", url);
    drawTables(data.windows);
  });

  function drawTree() {
    tree.replaceChildren();
    const bySite = new Map();
    for (const win of data.windows) {
      if (!bySite.has(win.site.id)) bySite.set(win.site.id, { site: win.site, windows: [] });
      bySite.get(win.site.id).windows.push(win);
    }
    for (const [siteId, entry] of bySite) {
      const siteItem = el("li", { role: "treeitem", tabindex: "0", "aria-expanded": "false" },
        el("span", { text: entry.site.name }));
      const children = el("ul", { role: "group", hidden: true });
      for (const win of entry.windows) {
        const winItem = el("li", { role: "treeitem", tabindex: "-1" },
          el("a", { href: `/windows/${win.id}`, text: `${entry.site.name} ${win.month}` }));
        children.append(winItem);
      }
      siteItem.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const open = siteItem.getAttribute("aria-expanded") === "true";
          siteItem.setAttribute("aria-expanded", String(!open));
          children.hidden = open;
        }
        if (event.key === "ArrowRight" && siteItem.getAttribute("aria-expanded") === "false") {
          siteItem.setAttribute("aria-expanded", "true"); children.hidden = false;
        }
        if (event.key === "ArrowLeft") {
          if (siteItem.getAttribute("aria-expanded") === "true") {
            siteItem.setAttribute("aria-expanded", "false"); children.hidden = true;
          }
        }
      });
      siteItem.addEventListener("click", () => {
        const open = siteItem.getAttribute("aria-expanded") === "true";
        siteItem.setAttribute("aria-expanded", String(!open));
        children.hidden = open;
        const url = new URL(location.href);
        url.searchParams.set("site", siteId);
        history.pushState({}, "", url);
        drawTables(data.windows);
        announce(groupStatus, `${data.windows.filter((w) => w.site.id === siteId).length} windows shown.`);
      });
      siteItem.append(children);
      tree.append(siteItem);
    }
  }

  const siteTable = el("table", { "aria-label": "Site scores" });
  function drawTables(windows) {
    const filtered = siteFilter && siteFilter !== "All"
      ? windows.filter((w) => w.site.id === siteFilter) : windows;
    const tbody = el("tbody");
    for (const win of filtered) {
      const tr = el("tr", {},
        el("td", {}, link(`${win.site.name} ${win.month}`, `/windows/${win.id}`)),
        el("td", { text: win.state }),
        el("td", { text: pct(win.scores.month_bp) }),
        el("td", { text: pct(win.scores.week_bp) }),
        el("td", { text: pct(win.scores.day_bp) }),
        el("td", { text: pct(win.scores.hour_bp) }),
        el("td", { text: win.target.met ? "On target" : "Off target" }));
      if (["Awaiting meters", "Reconciling", "Returned"].includes(win.state)) {
        const combo = el("select", { "aria-label": "Verifier firm" });
        for (const firm of firms) {
          const opt = el("option", { value: firm.id, text: firm.name });
          if (win.verifier_firm && win.verifier_firm.id === firm.id) opt.selected = true;
          combo.append(opt);
        }
        const assign = el("button", { text: "Assign" });
        assign.addEventListener("click", async () => {
          try {
            await api("PUT", `/api/windows/${win.id}/verifier`, { firm_id: combo.value });
            announce(groupStatus, "Verifier firm assigned.");
            win.verifier_firm = firms.find((f) => f.id === combo.value);
            drawTables(windows);
          } catch (err) { announce(groupStatus, err.message); }
        });
        tr.append(el("td", {}, combo, assign));
      }
      tbody.append(tr);
    }
    siteTable.replaceChildren(tableHead(["Window", "State", "Month", "Week", "Day", "Hour", "Target"]), tbody);
  }
  drawTables(data.windows);
  drawTree();

  const totals = el("table", { "aria-label": "Group totals" });
  const tbody = el("tbody");
  for (const rollup of data.rollups) {
    tbody.append(el("tr", {},
      el("td", { text: rollup.month }),
      el("td", { text: String(rollup.window_count) }),
      el("td", { text: fmtThousands(rollup.consumed_wh) }),
      el("td", { text: pct(rollup.scores.month_bp) }),
      el("td", { text: pct(rollup.scores.week_bp) }),
      el("td", { text: pct(rollup.scores.day_bp) }),
      el("td", { text: pct(rollup.scores.hour_bp) }),
      el("td", { text: rollup.residual_emissions_g === null ? "unknown" : fmtThousands(rollup.residual_emissions_g) })));
  }
  totals.replaceChildren(tableHead(["Month", "Windows", "Consumed", "Month", "Week", "Day", "Hour", "Residual"]), tbody);

  // policy regions for every site in tree order
  const policyHost = el("div", { class: "policy-host" });
  const bySiteOrder = new Map();
  for (const win of data.windows) {
    if (!bySiteOrder.has(win.site.id)) bySiteOrder.set(win.site.id, win.site);
  }
  for (const [siteId, site] of bySiteOrder) {
    const region = el("section", { "aria-label": `${site.name} policy` });
    const grain = el("select", { "aria-label": "Target grain", "data-field": "target_grain" });
    for (const value of ["MONTH", "WEEK", "DAY", "HOUR"]) {
      const opt = el("option", { value, text: value });
      if (value === site.target.grain) opt.selected = true;
      grain.append(opt);
    }
    const percent = el("input", { type: "text", "aria-label": "Target percent",
                                  "data-field": "target_bp",
                                  value: `${Math.floor(site.target.bp / 100)}.${String(site.target.bp % 100).padStart(2, "0")}` });
    const save = el("button", { text: "Save policy" });
    save.addEventListener("click", async () => {
      clearProblems(region);
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(percent.value.trim());
      if (!match) { showProblems(region, { fields: { target_bp: "Enter a percent from 0.00 to 100.00 with at most two decimals." } }); return; }
      const whole = Number(match[1]);
      const frac = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
      const bp = whole * 100 + frac;
      if (bp < 0 || bp > 10000) {
        showProblems(region, { fields: { target_bp: "Enter a percent from 0.00 to 100.00 with at most two decimals." } });
        return;
      }
      try {
        await api("PUT", `/api/sites/${siteId}/policy`, { target_grain: grain.value, target_bp: bp });
        announce(groupStatus, `Policy saved for ${site.name}.`);
      } catch (err) { showProblems(region, err); }
    });
    region.append(grain, percent, save);
    policyHost.append(region);
  }

  const content = el("div", { class: "group-page" },
    el("h1", { text: "EVERY SITE. EVERY GRAIN." }),
    tree, showAll, totals, siteTable, policyHost, groupStatus);
  land(deskShell(content, "/group"));
}

/* --- Public check ----------------------------------------------------------- */
function renderCheck() {
  const code = el("input", { "aria-label": "Statement code" });
  const check = el("button", { text: "Check statement" });
  const form = el("form", {},
    el("h1", { text: "CHECK A STATEMENT." }), code, check);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (code.value.trim()) go(`/check/${encodeURIComponent(code.value.trim())}`);
  });
  land(el("div", { class: "check-page" }, form));
}

async function renderStatement(code) {
  let statement = null;
  const result = el("section", { "aria-label": "Statement result" });
  try {
    statement = await api("GET", `/api/public/statements/${encodeURIComponent(code)}`);
  } catch (err) {
    result.append(el("div", { class: "state-word", text: err.message }));
    land(el("div", { class: "check-page" }, el("h1", { text: "CHECK A STATEMENT." }), result));
    return;
  }
  result.append(
    el("div", { text: `Statement ${statement.code}` }),
    el("div", { text: `Site ${statement.site_name}` }),
    el("div", { text: `Month ${statement.month}` }),
    el("div", { text: `Month score ${pct(statement.scores.month_bp)}%` }),
    el("div", { text: `Week score ${pct(statement.scores.week_bp)}%` }),
    el("div", { text: `Day score ${pct(statement.scores.day_bp)}%` }),
    el("div", { text: `Hour score ${pct(statement.scores.hour_bp)}%` }),
    el("div", { text: `Opinion ${statement.opinion}` }),
    el("div", { text: `Verifier firm ${statement.firm_name}` }),
    el("div", { text: `State ${statement.state}` }),
    el("div", { text: statement.signature_valid ? "SIGNATURE HOLDS." : "SIGNATURE DOES NOT HOLD." }));
  const download = el("a", { href: `/check/${encodeURIComponent(code)}/attestation.pdf`,
                              text: "Download attestation PDF" });
  const content = el("div", { class: "statement-page" },
    el("h1", { text: statement.site_name }),
    result, download);
  if (statement.successor_statement_code) {
    content.append(el("a", { href: `/check/${encodeURIComponent(statement.successor_statement_code)}`,
                             text: "Open the successor statement" }));
  }
  if (statement.state === "Restated") {
    content.append(el("div", { class: "stamp", text: `RESTATED. SEE THE SUCCESSOR WINDOW. ${statement.successor_window_id || ""}` }));
  }
  land(el("div", { class: "check-page" }, content));
}

/* --- Router ------------------------------------------------------------------- */
const DESK_PREFIXES = ["/windows", "/review", "/group"];

function go(path) {
  history.pushState({}, "", path);
  renderRoute();
}

async function renderRoute() {
  const path = location.pathname;
  applyLayoutClasses();
  if (path === "/" ) return renderHome();
  if (path === "/sign-in") return renderSignIn();
  if (path === "/check") return renderCheck();
  if (path.startsWith("/check/")) {
    const code = decodeURIComponent(path.slice("/check/".length));
    if (code.endsWith("/attestation.pdf")) return renderStatement(code.slice(0, -"/attestation.pdf".length));
    return renderStatement(code);
  }
  if (DESK_PREFIXES.some((p) => path === p || path.startsWith(p + "/")) || /^\/windows\/[^/]+$/.test(path)) {
    if (!ME) {
      try { ME = (await api("GET", "/api/me", undefined, { noDialog: true })).user; }
      catch { return go("/sign-in"); }
    }
    if (path === "/windows" || path.startsWith("/windows?")) return renderBoard();
    const windowMatch = path.match(/^\/windows\/([^/]+)$/);
    if (windowMatch) return renderWindowDesk(decodeURIComponent(windowMatch[1]));
    const lotsMatch = path.match(/^\/windows\/([^/]+)\/lots$/);
    if (lotsMatch) return renderLots(decodeURIComponent(lotsMatch[1]));
    const ledgerMatch = path.match(/^\/windows\/([^/]+)\/ledger$/);
    if (ledgerMatch) return renderLedger(decodeURIComponent(ledgerMatch[1]));
    if (path === "/review" || path.startsWith("/review?")) return renderQueue();
    const reviewMatch = path.match(/^\/review\/([^/]+)$/);
    if (reviewMatch) return renderReview(decodeURIComponent(reviewMatch[1]));
    if (path === "/group" || path.startsWith("/group?")) return renderGroup();
    return renderNotFound();
  }
  return renderNotFound();
}

window.addEventListener("popstate", renderRoute);
document.addEventListener("keydown", (event) => {
  if (event.key === "a" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    const target = event.target;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (document.querySelector("dialog[open]")) return;
    const desk = target.closest('[aria-label="Window desk"]');
    if (desk) {
      event.preventDefault();
      const btn = findAction("Rerun allocation");
      if (btn) btn.click();
    }
  }
});

applyMotionPreference();
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
motionQuery.addEventListener("change", applyMotionPreference);

function applyMotionPreference() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.dataset.motion = reduced ? "reduced" : "full";
}

(async function boot() {
  try { ME = (await api("GET", "/api/me", undefined, { noDialog: true })).user; }
  catch { ME = null; }
  await renderRoute();
})();
