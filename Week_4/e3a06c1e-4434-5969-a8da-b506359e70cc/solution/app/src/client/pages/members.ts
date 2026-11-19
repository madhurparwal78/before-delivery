// Members and the invite dialog: role changes and removals apply on the member's next request.
import type { Member, Project } from "../../shared/types";
import { ROLES } from "../../shared/types";
import { api, GENERIC_FAILURE } from "../api";
import { openDialog } from "../dialog";
import { cardTable, field, h, icon, replace, say, uid } from "../dom";
import { ROLE_LABEL, stamp } from "../format";
import type { Page } from "../main";

const SELF = "You can't change or remove your own membership.";

function projectChecks(projects: Project[]): { root: HTMLFieldSetElement; values(): string[] } {
  const boxes = projects.map((p) => {
    const box = h("input", { type: "checkbox", value: p.id, id: uid("project") });
    return { box, label: h("label", { for: box.id, class: "choice" }, box, h("span", {}, p.name)) };
  });
  const root = h("fieldset", { class: "choices column" }, h("legend", {}, "Projects"), ...boxes.map((b) => b.label));
  return { root, values: () => boxes.filter((b) => b.box.checked).map((b) => b.box.value) };
}

export function renderMembers(page: Page): void {
  const status = h("p", { role: "status", "aria-label": "Members status", class: "status-line" });
  const invite = h("button", { type: "button", class: "primary" }, icon("plus"), "Invite teammate");
  const membersBody = h("tbody", {}, h("tr", { class: "skeleton" }, h("td", { colspan: 5 }, h("span", { class: "bar" }))));
  const membersTable = h("table", { class: "data cards", "aria-label": "Members" }, h("thead", {}, h("tr", {}, ...["Name", "Email", "Role", "Projects", ""].map((c) => h("th", { scope: "col" }, c || h("span", { class: "visually-hidden" }, "Actions"))))), membersBody);
  page.root.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Members"), h("p", { class: "muted" }, "Developers, reviewers and approvers see only their assigned projects.")), invite),
    status,
    h("div", { class: "table-wrap", tabindex: 0 }, membersTable),
  );
  let projects: Project[] = [];
  const projectNames = (ids: readonly string[]) => (ids.length ? ids.map((id) => projects.find((p) => p.id === id)?.name ?? "").filter(Boolean).join(", ") : "—");
  let handle: (() => void) | null = null;
  page.onLeave(() => handle?.());

  const load = async () => {
    const [members, list] = await Promise.all([
      api<{ members: Member[] }>("GET", "/api/org/members"),
      api<{ projects: Project[] }>("GET", "/api/projects"),
    ]);
    if (!page.current() || !members.ok) return;
    projects = list.ok ? list.data.projects : [];
    replace(
      membersBody,
      ...members.data.members.map((member) => {
        const roleSelect = h("select", { "aria-label": `Role for ${member.name}` }, ...ROLES.map((r) => h("option", { value: r, selected: r === member.role }, ROLE_LABEL[r])));
        roleSelect.addEventListener("change", async () => {
          const result = await api<{ member: Member }>("PATCH", `/api/org/members/${member.id}`, { role: roleSelect.value });
          if (result.ok) {
            member.role = result.data.member.role;
            say(status, "Member updated.");
          } else say(status, result.error.error === "self_change" ? SELF : GENERIC_FAILURE);
        });
        // A refused change shows its message while the control has focus, then the row shows the real role again.
        roleSelect.addEventListener("blur", () => (roleSelect.value = member.role));
        const remove = h("button", { type: "button", class: "secondary small", "aria-label": `Remove ${member.name}` }, "Remove");
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          const result = await api("DELETE", `/api/org/members/${member.id}`);
          remove.disabled = false;
          if (result.ok) {
            say(status, "Member removed.");
            await load();
          } else say(status, result.error.error === "self_change" ? SELF : GENERIC_FAILURE);
        });
        return h(
          "tr",
          {},
          h("th", { scope: "row" }, member.name, h("span", { class: "muted block num nowrap" }, `Joined ${stamp(member.joined_at)}`)),
          h("td", {}, member.email),
          h("td", {}, roleSelect),
          h("td", {}, member.role === "admin" || member.role === "billing" ? "All projects" : projectNames(member.project_ids)),
          h("td", { class: "right actions" }, remove),
        );
      }),
    );
    cardTable(membersTable);
  };
  const ready = load();

  // Invite teammate.
  const name = h("input", { type: "text", autocomplete: "off" });
  const email = h("input", { type: "email", autocomplete: "off" });
  const roleSelect = h("select", {}, ...ROLES.map((r) => h("option", { value: r, selected: r === "developer" }, ROLE_LABEL[r])));
  const nameField = field("Name", name);
  const emailField = field("Email", email);
  const roleField = field("Role", roleSelect);
  const checksSlot = h("div");
  const create = h("button", { type: "submit", class: "primary" }, "Create invitation");
  const link = h("input", { type: "text", readonly: true, class: "num" });
  const linkField = field("Invitation link", link, "Single use. It doesn't expire.");
  const close = h("button", { type: "button", class: "secondary" }, "Done");
  const linkBlock = h("div", { class: "stack", hidden: true }, linkField.root, h("div", { class: "button-row" }, close));
  const form = h("form", { novalidate: true, class: "stack" }, nameField.root, emailField.root, roleField.root, checksSlot, h("div", { class: "button-row end" }, create));
  const dialog = h("dialog", { "aria-label": "Invite teammate", class: "modal" }, h("h2", {}, "Invite teammate"), form, linkBlock);
  page.root.append(dialog);
  let checks: ReturnType<typeof projectChecks> | null = null;
  invite.addEventListener("click", async () => {
    name.value = "";
    email.value = "";
    roleSelect.value = "developer";
    link.value = "";
    linkBlock.hidden = true;
    form.hidden = false;
    for (const f of [nameField, emailField, roleField]) f.error(null);
    replace(checksSlot);
    handle = openDialog(dialog, invite, { initialFocus: name });
    await ready;
    checks = projectChecks(projects);
    replace(checksSlot, checks.root);
  });
  close.addEventListener("click", () => handle?.());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const f of [nameField, emailField, roleField]) f.error(null);
    create.disabled = true;
    const result = await api<{ id: string; invite_url: string }>("POST", "/api/org/invitations", { name: name.value, email: email.value, role: roleSelect.value, project_ids: checks?.values() ?? [] });
    create.disabled = false;
    if (!result.ok) {
      if (result.error.error === "email_taken") emailField.error("That email already belongs to a member or an open invitation.");
      else if (result.error.fields) {
        nameField.error(result.error.fields.name ?? null);
        emailField.error(result.error.fields.email ?? null);
        roleField.error(result.error.fields.role ?? null);
      } else say(status, GENERIC_FAILURE);
      return;
    }
    link.value = `${location.origin}${result.data.invite_url}`;
    form.hidden = true;
    linkBlock.hidden = false;
    link.focus();
    link.select();
    say(status, `Invitation created. Share the link below with ${name.value.trim()}.`);
    await load();
  });
}
