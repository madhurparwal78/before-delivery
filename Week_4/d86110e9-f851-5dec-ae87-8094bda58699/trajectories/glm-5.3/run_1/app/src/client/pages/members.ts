// Members page: table, pending invites and the invite form.

import { h } from "../runtime";
import type { Me } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api
 } from "../runtime";
import type { ApiError } from "../runtime";
import { Btn, Field, Select, StatusLog } from "../ui";

export function MembersPage(p: { me: Me | null; wsId: string }): VNode {
  const [members, setMembers] = useState<{ user_id: string; name: string; email: string; role: string }[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: string }[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [notice, setNotice] = useState<string[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const myRole = p.me?.workspaces.find((w) => w.id === p.wsId)?.role;
  const isOwner = myRole === "owner";
  const viewer = myRole === "viewer";

  const load = () => {
    void api<{ members: typeof members; invites: typeof invites }>(`/api/workspaces/${p.wsId}/members`)
      .then((r) => { setMembers(r.members); setInvites(r.invites); }).catch(() => undefined);
  };
  useEffect(load, [p.wsId]);

  const sendInvite = async () => {
    setAlert(null);
    try {
      await api(`/api/workspaces/${p.wsId}/invites`, { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice((prev) => [...prev.slice(-19), `Invite sent to ${email}`]);
      setEmail("");
      load();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 503) setAlert("Email is unavailable. The invite was not sent.");
      else setNotice((prev) => [...prev.slice(-19), err.message]);
    }
  };

  return h("div", { class: "page members-page" },
    h("h1", { class: "page-heading" }, "Members"),
    h("div", { class: "notice-region" },
      h(StatusLog, { name: "Notices", lines: notice }),
      alert ? h("div", { class: "alert-panel", role: "alert" }, h("p", {}, alert), h("button", { class: "link-action", onClick: () => setAlert(null) }, "Dismiss")) : null),
    h("div", { class: "members-grid" },
      h("div", { class: "members-block" },
        h("table", { class: "data-table", "aria-label": "Members" },
          h("thead", {}, h("tr", {}, h("th", { class: "col-head", scope: "col" }, "Name"), h("th", { class: "col-head", scope: "col" }, "Email"), h("th", { class: "col-head", scope: "col" }, "Role"))),
          h("tbody", {}, members.map((m) => h("tr", { key: m.user_id },
            h("td", { class: "cell" }, m.name),
            h("td", { class: "cell" }, m.email),
            h("td", { class: "cell" }, m.role))))),
        h("h2", { class: "section-heading" }, "Pending invites"),
        invites.length === 0
          ? h("p", { class: "muted" }, "No pending invites.")
          : h("ul", { class: "invite-list", "aria-label": "Pending invites" },
              invites.map((i) => h("li", { key: i.id }, `${i.email} (${i.role})`)))),
      h("form", { class: "invite-form form-card", onSubmit: (e: Event) => { e.preventDefault(); void sendInvite(); } },
        h("h2", { class: "section-heading" }, "Invite a member"),
        h(Field, { label: "Invitee email", value: email, onInput: setEmail, type: "email" }),
        h(Select, { label: "Role", value: role, options: ["editor", "viewer"], onChange: setRole }),
        h(Btn, { kind: "primary", type: "submit", disabled: !isOwner || viewer, describedBy: "invite-desc" }, "Send invite"),
        !isOwner ? h("span", { id: "invite-desc", class: "muted" }, viewer ? "Viewers cannot change this workspace" : "Only owners can do this") : null)));
}
