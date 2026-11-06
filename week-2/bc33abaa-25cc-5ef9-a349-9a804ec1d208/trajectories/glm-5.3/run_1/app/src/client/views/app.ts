import { el, label, aria, navigate, busy, openDialog, showFieldError } from "../dom";
import { api, errorText, money, localTime, localDate, type Me, type Subscription } from "../api";

const ROLE_LINKS: Record<string, string[]> = {
  owner: ["Dashboard", "Scenes", "Members", "Agents", "Audit", "Billing", "Settings"],
  admin: ["Dashboard", "Scenes", "Members", "Agents", "Audit"],
  billing_manager: ["Dashboard", "Scenes", "Members", "Billing"],
  editor: ["Dashboard", "Scenes"],
  viewer: ["Dashboard", "Scenes"],
};

const LINK_PATHS: Record<string, string> = {
  Dashboard: "/app",
  Scenes: "/app/scenes",
  Members: "/app/members",
  Agents: "/app/agents",
  Audit: "/app/audit",
  Billing: "/app/billing",
  Settings: "/app/settings",
};

export interface Shell {
  root: HTMLElement;
  me: Me;
  statusBanner: HTMLElement;
  page: HTMLElement;
}

export async function loadMe(): Promise<Me> {
  return (await api("/api/me")) as Me;
}

export function serviceStatusText(subscription: Subscription | null, overdueInvoice?: { number: string; dueAt: Date }): string | null {
  const s = subscription;
  if (!s) return null;
  if (s.state === "cancelled") return "This subscription is cancelled. The workspace is read-only.";
  if (s.state === "suspended") {
    if (s.graceEndsAt) return "This workspace is read-only until the overdue invoice is paid.";
    return "Your trial has ended. Start a paid plan to keep editing.";
  }
  if (s.state === "past_due" && s.graceEndsAt && overdueInvoice) {
    return `Payment failed. Pay invoice ${overdueInvoice.number} by ${localTime(overdueInvoice.dueAt, "UTC")} to keep publishing.`;
  }
  return null;
}

export async function buildShell(me: Me, path: string): Promise<Shell> {
  const root = document.getElementById("root")!;
  root.textContent = "";
  const topbar = el("div", { className: "topbar" });
  topbar.append(
    el("a", { href: "/app", className: "brand" }, document.createTextNode("Orrery "), el("span", { className: "mark", text: me.workspace.name })),
    el("div", { className: "who", text: me.member ? `${me.member.name} · ${me.member.role.replace("_", " ")}` : `${me.agent!.name} (agent)` }),
    el("button", {
      className: "btn",
      text: "Sign out",
      onclick: async () => {
        await api("/api/auth/logout", { method: "POST" });
        navigate("/login");
      },
    }),
  );
  const nav = el("nav", { className: "wsnav" });
  nav.setAttribute("aria-label", "Workspace");
  nav.setAttribute("role", "navigation");
  const role = me.member?.role ?? "";
  for (const linkName of ROLE_LINKS[role] ?? ["Dashboard", "Scenes"]) {
    const href = LINK_PATHS[linkName]!;
    const link = el("a", { href, text: linkName });
    if (path === href) link.classList.add("active");
    nav.append(link);
  }
  const banner = el("div", { className: "banner hidden", role: "status" });
  aria(banner, { live: "polite" });
  label(banner, "Service status");
  const page = el("div", { className: "page" });
  root.append(topbar, nav, banner, page);

  // Service status banner: storage, billing, subscription.
  async function refreshBanner(): Promise<void> {
    let text: string | null = null;
    try {
      const health = (await api("/api/assets")) as unknown;
      void health;
      text = null;
    } catch (err) {
      const body = (err as { status?: number; body?: Record<string, unknown> }).body;
      if (body?.service === "file_storage") text = "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.";
    }
    const me2 = await loadMe().catch(() => null);
    if (!text && me2?.subscription) {
      text = serviceStatusText(me2.subscription);
      if (me2.subscription.state === "past_due" && me2.subscription.graceEndsAt) {
        try {
          const invoices = (await api("/api/billing/invoices")) as { invoices: { number: string; status: string; balanceCents: number }[] };
          const unpaid = invoices.invoices.find((i) => i.status === "unpaid" && i.balanceCents > 0);
          if (unpaid) text = `Payment failed. Pay invoice ${unpaid.number} by ${localTime(new Date(me2.subscription.graceEndsAt!), me2.workspace.timeZone)} to keep publishing.`;
        } catch {
          // billing gateway may be down; the past-due banner still shows
        }
      }
    }
    if (text) {
      banner.textContent = text;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
  void refreshBanner();
  window.setInterval(() => {
    void refreshBanner();
  }, 5000);

  return { root, me, statusBanner: banner, page };
}

export async function dashboardView(me: Me, shell: Shell): Promise<void> {
  const dash = (await api("/api/dashboard")) as {
    seatsUsed: number;
    seatsPurchased: number;
    scenes: number;
    publishedScenes: number;
    scheduledVersions: number;
    activeAgentTokens: number;
    subscription: Subscription;
  };
  const sub = dash.subscription;
  const tiles = el("div", { className: "tiles" });
  const seatTile = el("div", { className: "tile" });
  seatTile.setAttribute("role", "region");
  seatTile.setAttribute("aria-label", "Seats");
  seatTile.append(el("h3", { text: "Seats" }), el("div", { className: "num", text: `${dash.seatsUsed} of ${dash.seatsPurchased} seats used` }));
  const subTile = el("div", { className: "tile" });
  subTile.setAttribute("role", "region");
  subTile.setAttribute("aria-label", "Subscription");
  let subText: string;
  if (sub.state === "trial") {
    subText = `Trial ends ${localTime(new Date(sub.trialEndsAt!), me.workspace.timeZone)}`;
  } else if (sub.state === "active") {
    subText = `Active: ${sub.plan === "team" ? "Team" : "Business"} ${sub.period}`;
  } else if (sub.state === "past_due") {
    subText = `Past due: grace period ends ${localTime(new Date(sub.graceEndsAt!), me.workspace.timeZone)}`;
  } else if (sub.state === "suspended") {
    subText = "Suspended";
  } else {
    subText = "Cancelled";
  }
  subTile.append(el("h3", { text: "Subscription" }), el("div", { className: "num", text: subText }));
  const sceneTile = el("div", { className: "tile" });
  sceneTile.setAttribute("role", "region");
  sceneTile.setAttribute("aria-label", "Scenes");
  sceneTile.append(el("h3", { text: "Scenes" }), el("div", { className: "num", text: `${dash.scenes} scenes, ${dash.publishedScenes} published` }));
  const tokenTile = el("div", { className: "tile" });
  tokenTile.setAttribute("role", "region");
  tokenTile.setAttribute("aria-label", "Agent tokens");
  tokenTile.append(el("h3", { text: "Agent tokens" }), el("div", { className: "num", text: `${dash.activeAgentTokens} active agent tokens` }));
  tiles.append(seatTile, subTile, sceneTile, tokenTile);
  shell.page.append(tiles);
}

export async function scenesView(me: Me, shell: Shell): Promise<void> {
  const head = el("div", { className: "page-head" });
  const search = el("input", { type: "search", className: "searchbox", placeholder: "Search scenes" }) as HTMLInputElement;
  search.setAttribute("role", "searchbox");
  label(search, "Search scenes");
  const newBtn = el("button", { className: "btn primary", text: "New scene" });
  label(newBtn, "New scene");
  head.append(search, newBtn);
  shell.page.append(head);

  const list = el("ul", {});
  list.setAttribute("role", "list");
  label(list, "Scenes");
  const results = el("ul", {});
  results.setAttribute("role", "list");
  label(results, "Search results");

  async function refresh(): Promise<void> {
    const data = (await api("/api/scenes")) as { scenes: { id: string; name: string; latestSeq: number }[] };
    list.textContent = "";
    for (const scene of data.scenes) {
      const link = el("a", { href: `/app/scenes/${scene.id}`, text: scene.name });
      link.style.display = "block";
      link.style.minHeight = "44px";
      link.style.padding = "10px 4px";
      link.style.borderBottom = "1px solid var(--putty-soft)";
      list.append(el("li", {}, link));
    }
  }
  await refresh();

  let searchTimer: number | null = null;
  search.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) {
        results.textContent = "";
        return;
      }
      const data = (await api(`/api/search?q=${encodeURIComponent(q)}`)) as { scenes: { id: string; name: string }[] };
      results.textContent = "";
      for (const scene of data.scenes) {
        const link = el("a", { href: `/app/scenes/${scene.id}`, text: scene.name, style: { display: "block", minHeight: "44px", padding: "10px 4px" } });
        results.append(el("li", {}, link));
      }
      if (results.children.length === 0) results.append(el("li", { text: "No scenes found." }));
    }, 200);
  });

  newBtn.addEventListener("click", () => {
    const nameInput = el("input", { type: "text", id: "ns-name" }) as HTMLInputElement;
    const form = el("form", {}, el("div", { className: "field" }, el("label", { for: nameInput.id, text: "Scene name" }), nameInput));
    form.setAttribute("aria-label", "New scene");
    const create = el("button", { className: "btn primary", type: "submit", text: "Create scene" });
    form.append(create);
    const dialog = openDialog(form, { name: "New scene", onOpen: () => nameInput.focus() });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = busy(create);
      b.start();
      try {
        await api("/api/scenes", { method: "POST", body: { name: nameInput.value } });
        dialog.close();
        await refresh();
      } catch (err) {
        showFieldError(nameInput, fieldMessage(err, "name"));
      } finally {
        b.end();
      }
    });
  });

  shell.page.append(list, results);
}

function fieldMessage(err: unknown, field: string): string | undefined {
  const body = (err as { body?: { errors?: Record<string, string> } }).body;
  return body?.errors?.[field];
}

export async function membersView(me: Me, shell: Shell): Promise<void> {
  const head = el("div", { className: "page-head" });
  const inviteBtn = el("button", { className: "btn primary", text: "Invite member" });
  head.append(el("h1", { text: "Members" }), inviteBtn);
  const status = el("div", { className: "status", role: "status" });
  label(status, "Members status");
  const table = el("table", { className: "data compact-cards" });
  table.setAttribute("aria-label", "Members");
  shell.page.append(head, status, table);

  async function refresh(): Promise<void> {
    const data = (await api("/api/members")) as {
      members: { id: string; name: string; email: string; role: string }[];
      invites: { id: string; email: string; role: string; expiresAt: string; invitedBy: { name: string } }[];
    };
    table.textContent = "";
    const thead = el("thead", {}, el("tr", {}, el("th", { text: "Name" }), el("th", { text: "Email" }), el("th", { text: "Role" }), el("th", { text: "" })));
    const tbody = el("tbody");
    for (const member of data.members) {
      const row = el("tr", {}, el("td", { text: member.name }), el("td", { text: member.email }), el("td", { text: member.role }));
      const actions = el("td");
      if (member.role !== "owner" && (me.member?.role === "owner" || me.member?.role === "admin")) {
        const removeBtn = el("button", { className: "btn danger", text: `Remove ${member.name}` });
        actions.append(removeBtn);
        removeBtn.addEventListener("click", () => {
          const content = el("div", {}, el("p", { text: `Remove ${member.name} from the workspace?` }));
          content.setAttribute("role", "alertdialog");
          content.setAttribute("aria-label", "Remove member");
          const remove = el("button", { className: "btn danger", text: "Remove" });
          const cancel = el("button", { className: "btn", text: "Cancel" });
          content.append(el("div", { className: "dialog-actions" }, cancel, remove));
          const dialog = openDialog(content, { name: "Remove member", onOpen: () => cancel.focus() });
          remove.addEventListener("click", async () => {
            const b = busy(remove);
            b.start();
            try {
              await api(`/api/members/${member.id}`, { method: "DELETE" });
              status.textContent = `${member.name} was removed. Their seat is free.`;
              dialog.close();
              await refresh();
            } catch (err) {
              status.textContent = errorText(err);
              status.classList.add("error");
            } finally {
              b.end();
            }
          });
          cancel.addEventListener("click", () => dialog.close());
        });
      }
      row.append(actions);
      tbody.append(row);
    }
    for (const invite of data.invites) {
      const row = el("tr", {}, el("td", { text: `${invite.email} (invited)` }), el("td", { text: invite.email }), el("td", { text: invite.role }));
      const actions = el("td");
      const revoke = el("button", { className: "btn", text: `Revoke invitation for ${invite.email}` });
      actions.append(revoke);
      revoke.addEventListener("click", async () => {
        await api(`/api/members/invites/${invite.id}`, { method: "DELETE" });
        await refresh();
      });
      row.append(actions);
      tbody.append(row);
    }
    table.append(thead, tbody);
  }
  await refresh();

  inviteBtn.addEventListener("click", () => {
    const email = el("input", { type: "email", id: "in-email" }) as HTMLInputElement;
    const role = el("select", { id: "in-role" }) as HTMLSelectElement;
    for (const r of ["admin", "billing_manager", "editor", "viewer"]) {
      role.append(el("option", { value: r, text: r }));
    }
    role.setAttribute("aria-label", "Role");
    const send = el("button", { className: "btn primary", type: "submit", text: "Send invite" });
    const form = el("form", { "aria-label": "Invite member" }, el("div", { className: "field" }, el("label", { for: email.id, text: "Email" }), email), el("div", { className: "field" }, el("label", { for: role.id, text: "Role" }), role), send);
    const dialog = openDialog(form, { name: "Invite member", onOpen: () => email.focus() });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = busy(send);
      b.start();
      try {
        await api("/api/members/invites", { method: "POST", body: { email: email.value, role: role.value } });
        status.textContent = `Invitation created for ${email.value}. The email is on its way.`;
        status.classList.remove("error");
        dialog.close();
        await refresh();
      } catch (err) {
        const body = (err as { status: number; body: Record<string, unknown> }).body;
        if (body.error === "already_member") {
          status.textContent = `${email.value} is already a member or invited.`;
        } else if (body.error === "no_seats_left") {
          status.textContent = "No seats left. Add seats in Billing or remove a member.";
        } else {
          status.textContent = errorText(err);
        }
        status.classList.add("error");
      } finally {
        b.end();
      }
    });
  });
}

export async function agentsView(me: Me, shell: Shell): Promise<void> {
  const head = el("div", { className: "page-head" });
  const issueBtn = el("button", { className: "btn primary", text: "Issue token" });
  head.append(el("h1", { text: "Agent tokens" }), issueBtn);
  const status = el("div", { className: "status", role: "status" });
  label(status, "Members status");
  const table = el("table", { className: "data compact-cards" });
  table.setAttribute("aria-label", "Agent tokens");
  const newTokenRegion = el("div", {});
  shell.page.append(head, newTokenRegion, status, table);

  async function refresh(): Promise<void> {
    const data = (await api("/api/agent-tokens")) as { tokens: { id: string; name: string; scope: string; expiresAt: string; status: string; issuedBy: { name: string } }[] };
    table.textContent = "";
    const thead = el("thead", {}, el("tr", {}, el("th", { text: "Name" }), el("th", { text: "Scope" }), el("th", { text: "Status" }), el("th", { text: "" })));
    const tbody = el("tbody");
    for (const token of data.tokens) {
      const row = el("tr", {}, el("td", { text: token.name }), el("td", { text: token.scope }), el("td", { text: token.status }));
      const actions = el("td");
      if (token.status === "active") {
        const revoke = el("button", { className: "btn", text: `Revoke ${token.name}` });
        actions.append(revoke);
        revoke.addEventListener("click", async () => {
          const b = busy(revoke);
          b.start();
          try {
            await api(`/api/agent-tokens/${token.id}`, { method: "DELETE" });
            status.textContent = `Token ${token.name} revoked.`;
            status.classList.remove("error");
            await refresh();
          } catch (err) {
            status.textContent = errorText(err);
            status.classList.add("error");
          } finally {
            b.end();
          }
        });
      }
      row.append(actions);
      tbody.append(row);
    }
    table.append(thead, tbody);
  }
  await refresh();

  issueBtn.addEventListener("click", () => {
    const name = el("input", { type: "text", id: "tk-name" }) as HTMLInputElement;
    const expires = el("input", { type: "text", id: "tk-expires", placeholder: "YYYY-MM-DD HH:mm:ss" }) as HTMLInputElement;
    const readRadio = el("input", { type: "radio", name: "scope", id: "tk-read", value: "read" }) as HTMLInputElement;
    const editRadio = el("input", { type: "radio", name: "scope", id: "tk-edit", value: "edit" }) as HTMLInputElement;
    editRadio.checked = true;
    const scopeGroup = el("div", { role: "radiogroup", "aria-label": "Scope" });
    scopeGroup.append(
      el("div", { className: "field" }, el("label", { for: readRadio.id, text: "Read" }), readRadio),
      el("div", { className: "field" }, el("label", { for: editRadio.id, text: "Edit" }), editRadio),
    );
    const issue = el("button", { className: "btn primary", type: "submit", text: "Issue token" });
    const form = el("form", { "aria-label": "Issue agent token" },
      el("div", { className: "field" }, el("label", { for: name.id, text: "Token name" }), name),
      el("div", { className: "field" }, el("label", { for: expires.id, text: "Expires" }), expires),
      scopeGroup,
      issue,
    );
    const dialog = openDialog(form, { name: "Issue agent token", onOpen: () => name.focus() });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = busy(issue);
      b.start();
      try {
        const result = (await api("/api/agent-tokens", {
          method: "POST",
          body: { name: name.value, scope: editRadio.checked ? "edit" : "read", expiresAt: expires.value },
        })) as { token: string; name: string };
        status.textContent = `Token ${result.name} issued.`;
        status.classList.remove("error");
        dialog.close();
        newTokenRegion.textContent = "";
        const region = el("div", { className: "panel" });
        region.setAttribute("role", "region");
        region.setAttribute("aria-label", "New token");
        region.append(
          el("h3", { text: "New token" }),
          el("p", { text: "Copy this token now. It will not be shown again." }),
          el("code", { className: "num", text: result.token, style: { display: "block", padding: "8px", background: "#fff", border: "1px solid var(--putty)", overflowWrap: "anywhere" } }),
        );
        newTokenRegion.append(region);
        await refresh();
      } catch (err) {
        const errors = (err as { body?: { errors?: Record<string, string> } }).body?.errors;
        if (errors?.expiresAt) showFieldError(expires, errors.expiresAt);
        else if (errors?.name) showFieldError(name, errors.name);
        else {
          status.textContent = errorText(err);
          status.classList.add("error");
        }
      } finally {
        b.end();
      }
    });
  });
}

export async function auditView(me: Me, shell: Shell): Promise<void> {
  shell.page.append(el("h1", { text: "Audit trail" }));
  const table = el("table", { className: "data compact-cards" });
  table.setAttribute("aria-label", "Audit trail");
  const thead = el("thead", {}, el("tr", {}, el("th", { text: "Time" }), el("th", { text: "Actor" }), el("th", { text: "Action" }), el("th", { text: "Target" })));
  const tbody = el("tbody");
  const data = (await api("/api/audit")) as { entries: { id: string; at: string; actor: { name: string }; action: string; target: { type: string; id: string } }[] };
  for (const entry of data.entries) {
    tbody.append(el("tr", {},
      el("td", { className: "num", text: localTime(new Date(entry.at), me.workspace.timeZone) }),
      el("td", { text: entry.actor.name }),
      el("td", { className: "num", text: entry.action }),
      el("td", { className: "num", text: `${entry.target.type} ${entry.target.id}` }),
    ));
  }
  table.append(thead, tbody);
  shell.page.append(table);
}
