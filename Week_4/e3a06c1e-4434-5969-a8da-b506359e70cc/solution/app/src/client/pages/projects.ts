// Projects list and the New project dialog.
import type { Project } from "../../shared/types";
import { allows, TAB_ACTION, type ProjectTab } from "../../shared/permissions";
import { minutesText } from "../../shared/billing";
import { api, GENERIC_FAILURE } from "../api";
import { openDialog } from "../dialog";
import { cardTable, field, h, icon, replace } from "../dom";
import { navigate, type Page } from "../main";

const TABS: ProjectTab[] = ["keys", "sessions", "review", "synthesis", "settings"];

/** The first project tab a role may open, or null when it may open none. */
function firstTab(role: Page["me"]["user"]["role"]): ProjectTab | null {
  return TABS.find((tab) => allows(role, TAB_ACTION[tab])) ?? null;
}

export function renderProjects(page: Page): void {
  const role = page.me.user.role;
  const tab = firstTab(role);
  const body = h("tbody", {}, ...[0, 1, 2].map(() => h("tr", { class: "skeleton" }, h("td", { colspan: 3 }, h("span", { class: "bar" })))));
  const table = h(
    "table",
    { class: "data cards", "aria-label": "Projects" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Project"), h("th", { scope: "col" }, "Quota used"), h("th", { scope: "col", class: "right" }, "Sessions this month"))),
    body,
  );
  const create = allows(role, "admin") ? h("button", { type: "button", class: "primary" }, icon("plus"), "New project") : null;
  page.root.append(h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Projects"), h("p", { class: "muted" }, "Monthly audio quotas reset on the first of each UTC month.")), create), h("div", { class: "table-wrap", tabindex: 0 }, table));

  void (async () => {
    const found = await api<{ projects: Project[] }>("GET", "/api/projects");
    if (!page.current()) return;
    if (!found.ok) {
      replace(body, h("tr", {}, h("td", { colspan: 3 }, GENERIC_FAILURE)));
      return;
    }
    if (found.data.projects.length === 0) {
      replace(body, h("tr", {}, h("td", { colspan: 3, class: "empty" }, "No projects yet.")));
      return;
    }
    replace(
      body,
      ...found.data.projects.map((p) =>
        h(
          "tr",
          {},
          h("th", { scope: "row" }, tab ? h("a", { href: `/console/projects/${p.id}/${tab}` }, p.name) : h("span", {}, p.name)),
          h("td", { class: "num" }, `${minutesText(p.quota.used_seconds)} / ${p.quota.limit_minutes} min`, p.quota.exhausted ? h("span", { class: "badge caution" }, "Quota reached") : null),
          h("td", { class: "num right" }, String(p.sessions)),
        ),
      ),
    );
    cardTable(table);
  })();

  if (!create) return;
  const name = h("input", { type: "text", autocomplete: "off", maxlength: 120 });
  const quota = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", value: "600" });
  const nameField = field("Project name", name);
  const quotaField = field("Monthly quota (minutes)", quota, "Whole minutes, 1 to 1000000.");
  const submit = h("button", { type: "submit", class: "primary" }, "Create project");
  const cancel = h("button", { type: "button", class: "secondary" }, "Cancel");
  const formError = h("p", { class: "form-error", role: "alert" });
  const form = h("form", { novalidate: true, class: "stack" }, nameField.root, quotaField.root, formError, h("div", { class: "button-row end" }, cancel, submit));
  const dialog = h("dialog", { "aria-label": "New project", class: "modal" }, h("h2", {}, "New project"), form);
  page.root.append(dialog);
  let handle: ReturnType<typeof openDialog> | null = null;
  create.addEventListener("click", () => {
    nameField.error(null);
    quotaField.error(null);
    formError.textContent = "";
    handle = openDialog(dialog, create, { initialFocus: name });
  });
  cancel.addEventListener("click", () => handle?.());
  page.onLeave(() => handle?.());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    nameField.error(null);
    quotaField.error(null);
    formError.textContent = "";
    const minutes = /^\d+$/.test(quota.value.trim()) ? Number(quota.value.trim()) : quota.value;
    submit.disabled = true;
    const result = await api<{ project: Project }>("POST", "/api/projects", { name: name.value, monthly_quota_minutes: minutes });
    submit.disabled = false;
    if (result.ok) {
      handle?.();
      navigate(`/console/projects/${result.data.project.id}/keys`, { handover: { keysStatus: "Project created. Issue its first API key." } });
      return;
    }
    if (result.error.error === "name_taken") nameField.error("A project with this name already exists.");
    else if (result.error.fields) {
      nameField.error(result.error.fields.name ?? null);
      quotaField.error(result.error.fields.monthly_quota_minutes ?? null);
    } else formError.textContent = GENERIC_FAILURE;
  });
}
