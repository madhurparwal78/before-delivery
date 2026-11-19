/** The app shell: header, router, live regions and the screens. */

import { api, esc, el } from "./api.js";
import type { QueryAnswer } from "./view.js";
import { renderChart, type ChartSpec } from "./chart.js";
import { displayNumber, displayShare, displayUtc, dataValue } from "../../src/shared/display.js";

interface Me {
  user: { id: string; username: string };
  projects: { id: string; name: string; role: string }[];
}

let unread = 0;
let serverNow = new Date();
let currentPath = location.pathname + location.search;

function setUnread(n: number): void {
  unread = n;
  const link = document.querySelector<HTMLAnchorElement>('a[data-role="inbox"]');
  if (link) link.textContent = `Inbox, ${n} unread`;
}

function announce(text: string, region: "announcements" | "view" | "sign-in" = "announcements"): void {
  const id = region === "view" ? "view-announcements" : region === "sign-in" ? "sign-in-state" : "announcements";
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function viewNotice(text: string): void {
  const node = document.getElementById("view-notice");
  if (node) node.textContent = text;
}

async function refreshInbox(): Promise<void> {
  const res = await api<{ unread: number }>("GET", "/api/inbox");
  if (res.status === 200 && res.json) setUnread(res.json.unread);
}

function headerHtml(me: Me | null): string {
  if (!me) {
    return `<a class="brand" href="/">Lozenge</a><nav><a href="/signin">Sign in</a></nav>`;
  }
  return `
    <a class="brand" href="/">Lozenge</a>
    <nav>
      <a href="/workbooks">Workbooks</a>
      <a data-role="inbox" href="/inbox">Inbox, ${unread} unread</a>
      <button data-action="signout">Sign out</button>
    </nav>`;
}

async function renderHeader(): Promise<void> {
  const meRes = await api<Me>("GET", "/api/me");
  const me = meRes.status === 200 ? meRes.json : null;
  const header = document.querySelector<HTMLElement>(".site-header");
  if (header) header.innerHTML = headerHtml(me);
  const signOut = header?.querySelector<HTMLButtonElement>('[data-action="signout"]');
  signOut?.addEventListener("click", async () => {
    await api("POST", "/api/auth/logout");
    location.href = "/";
  });
}

function shell(inner: string): void {
  document.getElementById("app")!.innerHTML = `
    <header class="site-header"></header>
    <main id="page">${inner}</main>`;
}

function liveRegions(viewMode: boolean): string {
  return `
    <p id="announcements" class="status" role="status" aria-live="polite"></p>
    ${viewMode ? `<p id="view-announcements" class="status" role="status" aria-live="polite"></p>
    <p id="view-notice" class="status" role="status" aria-live="polite"></p>` : ""}`;
}

function notFound(): void {
  shell(`
    <div class="card" style="max-width:520px;margin:48px auto;">
      <h1 class="headline">Not found.</h1>
      <p class="muted">The page you asked for does not exist.</p>
      ${liveRegions(false)}
    </div>`);
}

function forbidden(): void {
  shell(`
    <div class="card" style="max-width:520px;margin:48px auto;">
      <h1 class="headline">You do not have access to this.</h1>
      ${liveRegions(false)}
    </div>`);
}

// ---------- Screens ----------

async function homePage(): Promise<void> {
  shell(`
    <section class="hero">
      <div class="sticker shelf" aria-hidden="true"></div>
      <div class="sticker sum" aria-hidden="true"></div>
      <div class="sticker blob" aria-hidden="true"></div>
      <div class="sticker at" aria-hidden="true">AT</div>
      <h1><span class="grey">Charts you can</span> explain.</h1>
      <div class="sample-wrap">
        <section aria-label="Sample sheet" id="sample-sheet">
          <div class="card"><div class="updating">Updating...</div></div>
        </section>
      </div>
      <a class="open-link" href="/workbooks">Open a workbook</a>
    </section>
    ${liveRegions(false)}`);
  // The live sample sheet: SUM(Sales) by Region from the bundled Fernhollow
  // Tea sample with the source filter Region is not null — four bars with
  // their data table twin.
  try {
    const { renderChart } = await import("./chart.js");
    const holder = document.getElementById("sample-sheet")!;
    const ordersRes = await fetch("/api/sample/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    if (ordersRes.ok) {
      const answer = (await ordersRes.json()) as {
        chart: string;
        columns: { name: string; role: string }[];
        rows: (string | number | boolean | null)[][];
      };
      const dims = answer.columns.filter((c) => c.role === "dimension").map((c) => c.name);
      const measures = answer.columns.filter((c) => c.role === "measure").map((c) => c.name);
      const spec = {
        chart: answer.chart,
        dims,
        measures,
        marks: answer.rows.map((r) => ({
          key: r.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))).join(" | "),
          dimTexts: r.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))),
          values: r.slice(dims.length) as (number | null)[],
        })),
        colorDimension: false,
        colorMeasure: null,
        total: null,
        refLines: [],
        trend: null,
        sheetName: "Sample",
      };
      const twinRows = answer.rows
        .map(
          (r) =>
            `<tr>${r
              .map((v, i) => (i < dims.length ? `<td role="rowheader">${v === null ? "(null)" : esc(String(v))}</td>` : `<td role="gridcell" data-value="${v === null || v === undefined ? "" : dataValue(v as number)}">${v === null ? "(null)" : displayNumber(v as number)}</td>`))
              .join("")}</tr>`,
        )
        .join("");
      holder.innerHTML = `
        <div class="card">
          <div id="sample-chart"></div>
          <table class="twin-table" role="grid" aria-label="Sample table">
            <thead><tr>${[...dims, ...measures].map((h) => `<th scope="col" class="columnheader">${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>${twinRows}</tbody>
          </table>
        </div>`;
      document.getElementById("sample-chart")!.innerHTML = renderChart(spec);
    } else {
      holder.innerHTML = `<div class="card"><p class="muted">The sample is warming up.</p></div>`;
    }
  } catch {
    // The sample sheet is decorative on failure; the page still serves.
  }
}

async function signInPage(): Promise<void> {
  const next = new URLSearchParams(location.search).get("next") ?? "/workbooks";
  shell(`
    <div class="card" style="max-width:420px;margin:64px auto;">
      <h1 class="headline">Sign in</h1>
      <form id="signin-form" class="stack">
        <label>Username <input name="username" aria-label="Username" autocomplete="username"></label>
        <label>Password <input name="password" type="password" aria-label="Password" autocomplete="current-password"></label>
        <div class="row">
          <button type="submit" class="primary">Sign in</button>
          <button type="button" id="create-account">Create account</button>
        </div>
        <p id="sign-in-state" class="status" role="status" aria-live="polite"></p>
      </form>
    </div>`);
  const form = document.getElementById("signin-form") as HTMLFormElement;
  const state = document.getElementById("sign-in-state")!;
  const doAuth = async (path: string): Promise<void> => {
    const data = new FormData(form);
    const res = await api<{ user: { username: string } }>("POST", path, {
      username: String(data.get("username") ?? "").toLowerCase(),
      password: String(data.get("password") ?? ""),
    });
    if (res.status === 200 || res.status === 201) {
      location.href = next;
      return;
    }
    if (res.status === 429) {
      const retry = res.headers.get("retry-after") ?? "60";
      state.textContent = `Too many sign-in attempts. Try again in ${retry} seconds.`;
      return;
    }
    if (res.status === 401) {
      state.textContent = "Wrong username or password.";
      return;
    }
    const errors = (res.json as { errors?: Record<string, string> } | null)?.errors;
    if (errors?.username) state.textContent = errors.username;
    else if (errors?.password) state.textContent = errors.password;
    else if (res.status === 409) state.textContent = "That username is taken.";
    else state.textContent = "Something went wrong. Try again.";
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void doAuth("/api/auth/login");
  });
  document.getElementById("create-account")!.addEventListener("click", () => {
    void doAuth("/api/auth/register");
  });
}

async function workbooksPage(): Promise<void> {
  shell(`
    <div class="list-of-cards">
      <div class="row" style="justify-content:space-between">
        <h1 class="headline">Workbooks</h1>
        <button class="primary" id="new-workbook">New workbook</button>
      </div>
      <div id="workbook-list"></div>
      <p id="announcements" class="status" role="status" aria-live="polite"></p>
    </div>`);
  const meRes = await api<Me>("GET", "/api/me");
  if (meRes.status !== 200) {
    location.href = "/signin?next=/workbooks";
    return;
  }
  const listRes = await api<{ id: string; name: string; project: string; state: string; certified_by: string | null }[]>("GET", "/api/workbooks");
  const list = listRes.json ?? [];
  const listEl = document.getElementById("workbook-list")!;
  if (list.length === 0) {
    listEl.innerHTML = `<div class="card"><h2 class="headline">No workbooks yet.</h2></div>`;
  } else {
    listEl.innerHTML = list
      .map(
        (w) => `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <a href="/workbooks/${esc(w.id)}" style="font-weight:700;font-size:1.1em">${esc(w.name)}</a>
          <span>${w.state === "published" ? "Published" : "Draft"}${w.certified_by ? ` · Certified by ${esc(w.certified_by)}` : ""}</span>
        </div>
        <div class="muted">${esc(meRes.json!.projects.find((p) => p.id === w.project)?.name ?? "")}</div>
      </div>`,
      )
      .join("");
  }
  document.getElementById("new-workbook")!.addEventListener("click", async () => {
    const projects = meRes.json!.projects.filter((p) => p.role === "creator");
    if (projects.length === 0) {
      announce("You do not have access to this.");
      return;
    }
    const dlg = el(`<dialog aria-label="New workbook">
      <form method="dialog" class="stack">
        <h3>New workbook</h3>
        <label>Workbook name <input name="name" aria-label="Workbook name"></label>
        <label>Project <select name="project" aria-label="Project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <label>Source <select name="source" aria-label="Source"></select></label>
        <button class="primary" value="ok">Create workbook</button>
        <button value="cancel">Cancel</button>
      </form>
    </dialog>`);
    document.body.appendChild(dlg);
    const srcSel = dlg.querySelector<HTMLSelectElement>('[aria-label="Source"]')!;
    const projSel = dlg.querySelector<HTMLSelectElement>('[aria-label="Project"]')!;
    const loadSources = async (): Promise<void> => {
      const srcRes = await api<{ sources: { id: string; name: string }[] }>("GET", `/api/projects/${projSel.value}`);
      srcSel.innerHTML = (srcRes.json?.sources ?? []).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    };
    projSel.addEventListener("change", () => void loadSources());
    await loadSources();
    const opener = document.getElementById("new-workbook") as HTMLElement;
    (dlg as unknown as HTMLDialogElement).showModal();
    dlg.addEventListener("close", async () => {
      const value = (dlg.querySelector("form") as HTMLFormElement).value;
      if (value !== "ok") {
        dlg.remove();
        opener.focus();
        return;
      }
      const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
      const res = await api<{ id: string }>("POST", `/api/projects/${projSel.value}/workbooks`, {
        name: String(data.get("name") ?? ""),
        source: String(data.get("source") ?? ""),
      });
      dlg.remove();
      if (res.status === 201) {
        location.href = `/workbooks/${res.json!.id}`;
      } else {
        announce("Name is required.");
        opener.focus();
      }
    });
  });
}

async function workbookPage(id: string): Promise<void> {
  const res = await api<{
    id: string;
    name: string;
    state: string;
    version: number;
    certified_by: string | null;
    sheets: { id: string; name: string }[];
    dashboards: { id: string; name: string }[];
    parameters: { name: string; type: string; value: string; values: string[] }[];
    sets: { name: string; field: string; members: string[] | null }[];
    project: string;
  }>("GET", `/api/workbooks/${id}`);
  if (res.status === 404) return notFound();
  if (res.status === 403) return forbidden();
  const wb = res.json!;
  shell(`
    <div class="stack" style="max-width:900px;margin:0 auto;padding:24px;">
      <div class="row" style="justify-content:space-between">
        <h1 class="headline">${esc(wb.name)}</h1>
        <div class="row">
          <button id="publish">Publish</button>
          <button id="certify">Certify</button>
        </div>
      </div>
      <p class="muted">${wb.state === "published" ? "Published" : "Draft"} <span id="certified" role="status" aria-live="polite" class="status">${wb.certified_by ? `Certified by ${esc(wb.certified_by)}` : ""}</span></p>
      <div class="row">
        <button id="new-sheet">New sheet</button>
        <button id="new-dashboard">New dashboard</button>
      </div>
      <div class="card">
        <h3>Sheets</h3>
        <ul>${wb.sheets.map((s) => `<li><a href="/workbooks/${esc(id)}/sheets/${esc(s.id)}">${esc(s.name)}</a></li>`).join("") || '<li class="muted">No sheets yet.</li>'}</ul>
      </div>
      <div class="card">
        <h3>Dashboards</h3>
        <ul>${wb.dashboards.map((d) => `<li><a href="/dashboards/${esc(d.id)}">${esc(d.name)}</a></li>`).join("") || '<li class="muted">No dashboards yet.</li>'}</ul>
      </div>
      <p id="publish-state" role="status" aria-live="polite" class="status"></p>
      <p id="announcements" role="status" aria-live="polite" class="status"></p>
    </div>`);

  const pubState = document.getElementById("publish-state")!;
  document.getElementById("new-sheet")!.addEventListener("click", async () => {
    const res2 = await api<{ id: string }>("POST", `/api/workbooks/${id}/sheets`, {
      name: "Sheet 1",
      rows: [],
      columns: [],
      color: null,
      size: null,
      label: [],
      detail: [],
      filters: [],
      chart: "automatic",
      totals: false,
      reference_lines: [],
      trend: false,
      sort: {},
    }, undefined);
    if (res2.status === 201) {
      location.href = `/workbooks/${id}/sheets/${res2.json!.id}`;
    } else if (res2.status === 409) {
      pubState.textContent = "This workbook changed since you opened it. Reload and publish again.";
    } else {
      announce("You do not have access to this.");
    }
  });
  document.getElementById("new-dashboard")!.addEventListener("click", () => {
    const dlg = el(`<dialog aria-label="New dashboard">
      <form method="dialog" class="stack">
        <h3>New dashboard</h3>
        <label>Dashboard name <input name="name" aria-label="Dashboard name"></label>
        ${wb.sheets.map((s) => `<label><input type="checkbox" name="sheet" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join("")}
        <label>Arrangement <select name="arrangement" aria-label="Arrangement"><option>Horizontal</option><option>Vertical</option></select></label>
        <button class="primary" value="ok">Create dashboard</button>
        <button value="cancel">Cancel</button>
      </form>
    </dialog>`);
    document.body.appendChild(dlg);
    const opener = document.getElementById("new-dashboard") as HTMLElement;
    (dlg as unknown as HTMLDialogElement).showModal();
    dlg.addEventListener("close", async () => {
      const value = (dlg.querySelector("form") as HTMLFormElement).value;
      if (value !== "ok") {
        dlg.remove();
        opener.focus();
        return;
      }
      const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
      const chosen = wb.sheets.filter((s) => data.get("sheet") === s.id || [...data.getAll("sheet")].includes(s.id));
      if (chosen.length < 2 || chosen.length > 4) {
        dlg.remove();
        announce("A dashboard holds 2 to 4 sheets.");
        opener.focus();
        return;
      }
      const type = String(data.get("arrangement")).toLowerCase() === "vertical" ? "vertical" : "horizontal";
      const res2 = await api<{ id: string }>("POST", `/api/workbooks/${id}/dashboards`, {
        name: String(data.get("name") ?? ""),
        layout: { type, children: chosen.map((s) => ({ sheet: s.id, fixed: null })) },
        actions: [],
      });
      dlg.remove();
      if (res2.status === 201) {
        location.href = `/dashboards/${res2.json!.id}`;
      } else {
        announce("A dashboard holds 2 to 4 sheets.");
        opener.focus();
      }
    });
  });
  document.getElementById("publish")!.addEventListener("click", () => {
    const meRes = api<Me>("GET", "/api/me").then(async (r) => {
      const projects = (r.json?.projects ?? []).filter((p) => p.role === "creator");
      const dlg = el(`<dialog aria-label="Publish">
        <form method="dialog" class="stack">
          <h3>Publish</h3>
          <label>Project <select name="project" aria-label="Project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
          <button class="primary" value="ok">Publish workbook</button>
          <button value="cancel">Cancel</button>
        </form>
      </dialog>`);
      document.body.appendChild(dlg);
      const opener = document.getElementById("publish") as HTMLElement;
      (dlg as unknown as HTMLDialogElement).showModal();
      dlg.addEventListener("close", async () => {
        const value = (dlg.querySelector("form") as HTMLFormElement).value;
        if (value !== "ok") {
          dlg.remove();
          opener.focus();
          return;
        }
        const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
        const res2 = await fetch(`/api/workbooks/${id}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json", "if-match": String(wb.version) },
          body: JSON.stringify({ project: String(data.get("project")) }),
        });
        dlg.remove();
        opener.focus();
        if (res2.status === 200) {
          pubState.textContent = `Published to ${esc(String(data.get("project")))}.`;
          location.reload();
        } else if (res2.status === 409) {
          pubState.textContent = "This workbook changed since you opened it. Reload and publish again.";
        } else {
          announce("You do not have access to this.");
        }
      });
    });
    void meRes;
  });
  document.getElementById("certify")!.addEventListener("click", async () => {
    const res2 = await api<{ certified_by: string }>("POST", `/api/workbooks/${id}/certify`);
    if (res2.status === 200) {
      document.getElementById("certified")!.textContent = `Certified by ${res2.json!.certified_by}`;
    } else {
      announce("You do not have access to this.");
    }
  });
}

// ---------- Router ----------

async function route(): Promise<void> {
  const path = location.pathname;
  if (path === "/") return homePage();
  if (path === "/signin") return signInPage();
  if (path === "/workbooks") return workbooksPage();
  if (path.startsWith("/workbooks/") && path.includes("/sheets/")) {
    const parts = path.split("/");
    const { sheetPage } = await import("./sheet.js");
    return sheetPage(parts[2], parts[4]);
  }
  if (path.startsWith("/workbooks/")) return workbookPage(path.split("/")[2]);
  if (path.startsWith("/dashboards/")) {
    const { dashboardPage } = await import("./dashboard.js");
    return dashboardPage(path.split("/")[2]);
  }
  if (path === "/inbox") {
    const { inboxPage } = await import("./inbox.js");
    return inboxPage();
  }
  if (path.startsWith("/projects/")) {
    const { projectPage } = await import("./project.js");
    return projectPage(path.split("/")[2]);
  }
  if (path === "/sources/new") {
    const { uploadPage } = await import("./upload.js");
    return uploadPage();
  }
  if (path.startsWith("/sources/")) {
    const { sourcePage } = await import("./source.js");
    return sourcePage(path.split("/")[2]);
  }
  notFound();
}

function startEvents(): void {
  void (async () => {
    const res = await fetch("/api/events", { headers: { accept: "text/event-stream" } });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const raw of events) {
        let event = "";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (event === "inbox") {
          const parsed = JSON.parse(data) as { unread: number };
          setUnread(parsed.unread);
        }
        if (event === "clock") {
          const parsed = JSON.parse(data) as { server_now: string };
          serverNow = new Date(parsed.server_now);
        }
        if (event === "extract") {
          const parsed = JSON.parse(data) as { source: string; state: string; stale: boolean; last_success_at: string | null; last_failure_at: string | null; next_run_at: string | null };
          const node = document.getElementById("extract-state");
          if (node && node.dataset.source === parsed.source) {
            node.textContent = extractText(parsed);
          }
          const nextNode = document.getElementById("next-refresh");
          if (nextNode) nextNode.textContent = parsed.next_run_at ? `Next refresh ${displayUtc(Date.parse(parsed.next_run_at))} UTC` : "No schedule.";
        }
      }
    }
  })();
}

function extractText(e: { state: string; stale: boolean; last_success_at: string | null; last_failure_at: string | null }): string {
  if (e.state === "refresh_failed" && e.last_failure_at) {
    return `Refresh failed at ${displayUtc(Date.parse(e.last_failure_at))} UTC. Showing data from ${e.last_success_at ? displayUtc(Date.parse(e.last_success_at)) : "never"} UTC.`;
  }
  if (e.state === "refreshing") return "Updating...";
  if (e.last_success_at) {
    return `${e.stale ? "Stale" : "Fresh"}, refreshed ${displayUtc(Date.parse(e.last_success_at))} UTC`;
  }
  return "Fresh";
}

window.addEventListener("popstate", () => {
  currentPath = location.pathname + location.search;
  void boot();
});

export async function boot(): Promise<void> {
  document.getElementById("app")!.innerHTML = `
    <header class="site-header"></header>
    <main id="page"></main>`;
  await renderHeader();
  await route();
  void refreshInbox();
  startEventsOnce();
}

let eventsStarted = false;
function startEventsOnce(): void {
  if (eventsStarted) return;
  eventsStarted = true;
  startEvents();
}

boot();
