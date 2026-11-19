/* The Projects screen and one project's page. */

import {
  api, announce, duration, owedText, paintVerdictCard, openDialog, closeDialog,
  wireDialog, el, showFieldErrors, clearFieldErrors, startTonightRefresh,
  readKey,
} from "./app.js";

const path = location.pathname;
const match = path.match(/^\/projects\/([^/]+)$/);

if (match) {
  bootProjectPage(match[1]);
} else {
  bootProjectsList();
}

async function bootProjectsList() {
  readKey();
  wireChrome();
  await refreshTonight();
  await loadProjects();
  const dialog = document.getElementById("new-project-dialog");
  wireDialog(dialog);
  document.getElementById("new-project").addEventListener("click", () => {
    clearForm();
    openDialog(dialog, document.getElementById("new-project"));
  });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      name: form.querySelector("#project-name").value.trim(),
      target_name: form.querySelector("#target-name").value.trim(),
      ra_deg: Number(form.querySelector("#ra-deg").value),
      dec_deg: Number(form.querySelector("#dec-deg").value),
    };
    try {
      const project = await api("POST", "/api/projects", body);
      closeDialog(dialog);
      await loadProjects();
      announce("project-updates", `${project.name} created.`);
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("project-updates", err.message);
    }
  });
  startTonightRefresh(refreshTonight);
}

async function refreshTonight() {
  try {
    const plan = await api("GET", "/api/tonight");
    paintVerdictCard(document.getElementById("tonight-verdict"), plan);
  } catch (err) {
    /* the card keeps its last figures */
  }
}

async function loadProjects() {
  const grid = document.getElementById("project-grid");
  grid.textContent = "";
  const { projects } = await api("GET", "/api/projects");
  projects.forEach((p) => {
    const card = el("article", { class: "card", "aria-label": p.name });
    card.appendChild(el("h3", { text: "" })).append(
      (() => {
        const a = el("a", { href: `/projects/${p.id}`, text: p.name });
        return a;
      })()
    );
    const total = p.filters.reduce((s, f) => s + f.logged_seconds, 0);
    const owed = p.filters.reduce((s, f) => s + f.owed_seconds, 0);
    card.appendChild(el("p", { class: "num", text: `${p.target_name} · ${p.state}` }));
    card.appendChild(el("p", { class: "num", text: `${duration(total)} total · ${owedText(owed)} owed` }));
    grid.appendChild(card);
  });
}

function clearForm() {
  ["#project-name", "#target-name", "#ra-deg", "#dec-deg"].forEach((sel) => {
    document.querySelector(sel).value = "";
  });
  clearFieldErrors("error-summary");
}

function wireChrome() {
  import("/static/js/chrome.js").then(({ wireLockButton }) => wireLockButton());
}

async function bootProjectPage(projectId) {
  readKey();
  wireChrome();
  await refreshTonight();
  startTonightRefresh(refreshTonight);
  const project = await api("GET", `/api/projects/${projectId}`);
  paintProject(project);
  await loadShare(projectId);

  document.querySelectorAll("[data-transition]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const updated = await api("POST", `/api/projects/${projectId}/transition`, { to: btn.dataset.transition });
        paintProject(updated);
        announce("project-updates", `Project is now ${updated.state}.`);
      } catch (err) {
        announce("project-updates", err.message);
      }
    });
  });

  document.getElementById("show-ledger").addEventListener("click", async () => {
    const sheet = document.getElementById("ledger-sheet");
    const table = sheet.querySelector("tbody");
    table.textContent = "";
    const { entries } = await api("GET", `/api/projects/${projectId}/ledger`);
    entries.forEach((e) => {
      const tr = el("tr");
      tr.append(
        el("td", { class: "num", text: e.movement_kind }),
        el("td", { class: "num", text: e.filter }),
        el("td", { class: "num", text: e.account }),
        el("td", { class: "num", text: String(e.seconds) }),
        el("td", { class: "num", text: (e.created_at || "").replace("T", " ").slice(0, 16) })
      );
      table.appendChild(tr);
    });
    sheet.hidden = false;
  });
  document.getElementById("ledger-close").addEventListener("click", () => {
    document.getElementById("ledger-sheet").hidden = true;
  });

  const shareDialog = document.getElementById("share-dialog");
  wireDialog(shareDialog);
  document.getElementById("share-button").addEventListener("click", () => openDialog(shareDialog, document.getElementById("share-button")));
  document.getElementById("create-link").addEventListener("click", async () => {
    const expires = document.getElementById("link-expires").value.trim();
    const body = expires ? { expires_at: expires } : {};
    try {
      const share = await api("POST", `/api/projects/${projectId}/share`, body);
      document.getElementById("share-link").value = location.origin + share.url;
      announce("project-updates", "Share link ready.");
    } catch (err) {
      announce("project-updates", err.message);
    }
  });
  document.getElementById("regenerate-link").addEventListener("click", async () => {
    try {
      const share = await api("POST", `/api/projects/${projectId}/share`, {});
      document.getElementById("share-link").value = location.origin + share.url;
      announce("project-updates", "New share link ready. The old link no longer works.");
    } catch (err) {
      announce("project-updates", err.message);
    }
  });
  document.getElementById("revoke-link").addEventListener("click", async () => {
    try {
      await api("DELETE", `/api/projects/${projectId}/share`);
      document.getElementById("share-link").value = "";
      announce("project-updates", "Share link revoked.");
    } catch (err) {
      announce("project-updates", err.message);
    }
  });
  document.getElementById("copy-link").addEventListener("click", async () => {
    const value = document.getElementById("share-link").value;
    if (value) await navigator.clipboard.writeText(value);
  });
}

function paintProject(project) {
  document.querySelector("h1").textContent = project.name;
  document.getElementById("project-target").textContent = `${project.target_name} · ${project.state}`;
  const legal = {
    draft: ["active", "archived"],
    active: ["paused", "complete"],
    paused: ["active"],
    complete: ["archived"],
    archived: [],
  };
  document.querySelectorAll("[data-transition]").forEach((btn) => {
    const to = btn.dataset.transition;
    const label = { active: "Activate", paused: "Pause", complete: "Mark complete", archived: "Archive" }[to];
    btn.textContent = label;
    btn.hidden = !legal[project.state].includes(to);
  });
  const tbody = document.getElementById("owed-tbody");
  tbody.textContent = "";
  const total = project.filters.reduce((s, f) => s + f.logged_seconds, 0);
  project.filters.forEach((f) => {
    const tr = el("tr");
    const nameTd = el("td", { text: f.filter });
    const planned = el("input", {
      type: "number",
      min: "0",
      max: "60000",
      step: "1",
      value: String(Math.round(f.planned_seconds / 60)),
      "aria-label": `Planned minutes ${f.filter}`,
      "data-filter": f.filter,
    });
    planned.addEventListener("change", async () => {
      const seconds = Number(planned.value) * 60;
      try {
        const updated = await api("PUT", `/api/projects/${project.id}/allotments/${f.filter}`, { planned_seconds: seconds });
        paintProject(updated);
        const row = updated.filters.find((x) => x.filter === f.filter);
        announce("project-updates", `Planned ${f.filter} set to ${duration(row.planned_seconds)}. Owed now ${duration(row.owed_seconds)}.`);
      } catch (err) {
        announce("project-updates", err.message);
      }
    });
    const plannedTd = el("td", {});
    plannedTd.appendChild(planned);
    tr.append(
      nameTd,
      plannedTd,
      el("td", { class: "num", text: duration(f.logged_seconds) }),
      el("td", { class: "num", text: duration(f.owed_seconds) })
    );
    tbody.appendChild(tr);
  });
  document.getElementById("total-integration").textContent = `${duration(total)} total`;
}

async function loadShare(projectId) {
  try {
    const share = await api("GET", `/api/projects/${projectId}/share`);
    document.getElementById("share-link").value = location.origin + share.url;
  } catch (err) {
    document.getElementById("share-link").value = "";
  }
}
