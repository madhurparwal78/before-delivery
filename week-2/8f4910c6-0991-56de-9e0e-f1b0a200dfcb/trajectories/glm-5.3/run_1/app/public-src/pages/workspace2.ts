import { api, el, link, button, announce, type Page, register } from "../pages.js";
import { ApiFail, focusElement } from "../lib.js";
import { formatDay, formatOfficeTime } from "../../shared/format.js";
import { rerender, dialogErrorText, makeSelect, makeInput, rosterStatus, calendarStatus } from "./workspace.js";

/** Packages list with new package, revoke and regenerate. */
const packagesPage: Page = {
  path: "/workspace/packages",
  title: () => "Packages",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Packages"));
    const data = (await api("/api/packages")) as { packages: Array<{ id: string; title: string; recipientName: string; url: string; state: string; expiresAt: string; shortlistedCount: number; talent: Array<{ displayName: string; decision: string }> }> };
    const table = el("table");
    table.setAttribute("aria-label", "Packages");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Package", "Recipient", "Link", "Expires", "State", "Shortlisted", ""]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const pkg of data.packages) {
      const row = el("tr");
      row.append(
        el("td", undefined, pkg.title),
        el("td", undefined, pkg.recipientName),
        el("td", undefined, pkg.url),
        el("td", undefined, pkg.expiresAt),
        el("td", undefined, pkg.state),
        el("td", undefined, String(pkg.shortlistedCount)),
      );
      const actionCell = el("td");
      const revoke = button("Revoke link", async () => {
        revoke.textContent = "Revoking…";
        try {
          await api(`/api/packages/${pkg.id}/revoke`, { body: {} });
          revoke.textContent = "Revoke link";
          announce(rosterStatus, "Package link revoked. It no longer opens.");
          const heading = row.querySelector("td");
          focusElement(heading as HTMLElement);
          await rerender();
        } catch {
          revoke.textContent = "Revoke link";
        }
      });
      const regenerate = button("Regenerate link", async () => {
        regenerate.textContent = "Creating new link…";
        try {
          await api(`/api/packages/${pkg.id}/regenerate`, { body: {} });
          regenerate.textContent = "Regenerate link";
          announce(rosterStatus, `New link sent to ${pkg.recipientName}. The old link no longer opens.`);
          const heading = row.querySelector("td");
          focusElement(heading as HTMLElement);
          await rerender();
        } catch {
          regenerate.textContent = "Regenerate link";
        }
      });
      actionCell.append(revoke, regenerate);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    main.appendChild(table);
    main.appendChild(button("New package", () => {
      void openNewPackage();
    }, "primary"));

    async function openNewPackage(): Promise<void> {
      const talent = (await api("/api/talent")) as { talent: Array<{ id: string; displayName: string }> };
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "New package");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "New package"));
      const title = makeInput("Title", "text");
      const name = makeInput("Recipient name", "text");
      const email = makeInput("Recipient email", "email");
      const choices = el("div", "stack");
      for (const t of talent.talent) {
        const l = el("label");
        const c = document.createElement("input");
        c.type = "checkbox";
        c.value = t.id;
        l.append(c, document.createTextNode(` ${t.displayName}`));
        choices.appendChild(l);
      }
      const send = button("Send package", async () => {
        send.textContent = "Creating package…";
        const ids = Array.from(choices.querySelectorAll<HTMLInputElement>("input:checked")).map((c) => c.value);
        try {
          const result = (await api("/api/packages", {
            body: { title: (title.querySelector("input") as HTMLInputElement).value, recipientName: (name.querySelector("input") as HTMLInputElement).value, recipientEmail: (email.querySelector("input") as HTMLInputElement).value, talentIds: ids },
          })) as { package: { recipientName: string; expiresAt: string } };
          dialog.close();
          dialog.remove();
          announce(rosterStatus, `Package sent to ${result.package.recipientName}. The link works until ${formatOfficeTime(new Date(result.package.expiresAt), "America/Toronto", "Toronto")}.`);
          await rerender();
        } catch (err) {
          send.textContent = "Send package";
          const fail = err as ApiFail;
          dialogErrorText(dialog, fail.status === 422 ? "Choose only active talent." : "Something went wrong. Try again.");
        }
      }, "primary");
      body.append(title, name, email, choices, send);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }
  },
};

register(packagesPage);

/** Application queue and review. */
const applicationsPage: Page = {
  path: "/workspace/applications",
  title: () => "Applications",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Applications"));
    const data = (await api("/api/applications")) as { applications: Array<{ id: string; firstName: string; lastName: string; status: string; minor: boolean }> };
    for (const app of data.applications) {
      const article = el("article");
      article.setAttribute("aria-label", `${app.firstName} ${app.lastName}`);
      article.appendChild(el("h3", undefined, `${app.firstName} ${app.lastName}`));
      article.appendChild(el("p", undefined, app.status));
      if (app.minor) article.appendChild(el("p", undefined, "Minor"));
      article.appendChild(link(`/workspace/applications/${app.id}`, "Review"));
      main.appendChild(article);
    }
  },
};

register(applicationsPage);

const applicationPage: Page = {
  path: "/workspace/applications/:id",
  title: () => "Application",
  workspace: true,
  render: async (main) => {
    const id = location.pathname.split("/")[3];
    const status = el("div", "status-live");
    main.appendChild(el("h1", undefined, "Application"));
    const data = (await api(`/api/applications?status=`)) as { applications: Array<{ id: string }> };
    void data;
    const photos = ["front", "profile", "full_length", "smile"] as const;
    const gallery = el("div", "grid-cards");
    for (const slot of photos) {
      const figure = el("figure", "talent-card");
      const img = document.createElement("img");
      img.src = `/api/applications/${id}/photos/${slot}`;
      img.alt = `${slot} photo`;
      img.className = "portrait";
      figure.appendChild(img);
      gallery.appendChild(figure);
    }
    main.appendChild(gallery);
    const actions = el("div", "row");
    actions.append(
      button("Approve", async () => {
        await decide("approve");
      }, "primary"),
      button("Decline", async () => {
        await decide("decline");
      }),
      button("Sign", async () => {
        btn.disabled = true;
        try {
          const result = (await api(`/api/applications/${id}/sign`, { body: {} })) as { talent: { displayName: string } };
          announce(status, `Signed ${result.talent.displayName} to the New Faces board.`);
        } catch (err) {
          const fail = err as ApiFail;
          announce(status, fail.code === "not_approved" ? "Approve this application before signing." : "Something went wrong. Try again.");
        } finally {
          btn.disabled = false;
        }
      }),
    );
    const btn = actions.children[2] as HTMLButtonElement;
    main.append(actions, status);

    async function decide(decision: "approve" | "decline"): Promise<void> {
      try {
        const result = (await api(`/api/applications/${id}/decision`, { body: { decision } })) as { firstName: string };
        announce(status, decision === "approve" ? `Approved ${result.firstName}'s application.` : `Declined ${result.firstName}'s application.`);
      } catch (err) {
        const fail = err as ApiFail;
        announce(status, fail.code === "awaiting_guardian"
          ? "This applicant is a minor and a guardian has not approved yet."
          : fail.code === "already_decided"
            ? "This application was already decided."
            : "Something went wrong. Try again.");
      }
    }
  },
};

register(applicationPage);

/** Roster: import, export, withdraw, restore, erase. */
const rosterPage: Page = {
  path: "/workspace/roster",
  title: () => "Roster",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Roster"));
    const talent = (await api("/api/talent")) as { talent: Array<{ id: string; displayName: string; state: string; office: string; board: string }> };
    main.appendChild(button("Import roster", () => {
      void openImport();
    }, "primary"));
    const exportLink = link("/api/roster/export.csv", "Export roster");
    main.appendChild(exportLink);
    const reportRegion = el("div");
    reportRegion.setAttribute("role", "region");
    reportRegion.setAttribute("aria-label", "Import report");
    main.appendChild(reportRegion);

    const table = el("table");
    table.setAttribute("aria-label", "Roster");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Talent", "Office", "Board", "State", ""]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const t of talent.talent) {
      const row = el("tr");
      const stateCell = el("td", undefined, t.state);
      row.append(el("td", undefined, t.displayName), el("td", undefined, t.office), el("td", undefined, t.board), stateCell);
      const actionCell = el("td");
      if (t.state === "active") {
        actionCell.appendChild(button("Withdraw", async () => {
          try {
            await api(`/api/talent/${t.id}/withdraw`, { body: {} });
            announce(rosterStatus, `Withdrew ${t.displayName}. They no longer appear on boards, packages or feeds.`);
            focusElement(stateCell);
            await rerender();
          } catch (err) {
            const fail = err as ApiFail;
            announce(rosterStatus, fail.code === "already_withdrawn" ? "That talent is already withdrawn." : "Something went wrong. Try again.");
          }
        }));
        actionCell.appendChild(button("Erase", () => {
          void confirmErase(t.displayName, t.id, stateCell);
        }));
      } else if (t.state === "withdrawn") {
        actionCell.appendChild(button("Restore", async () => {
          try {
            await api(`/api/talent/${t.id}/restore`, { body: {} });
            announce(rosterStatus, `Restored ${t.displayName} to their boards, packages and feed.`);
            focusElement(stateCell);
            await rerender();
          } catch {
            announce(rosterStatus, "Something went wrong. Try again.");
          }
        }));
      }
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    main.appendChild(table);
    main.appendChild(rosterStatus);

    async function confirmErase(displayName: string, id: string, stateCell: HTMLElement): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", `Erase ${displayName}?`);
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, `Erase ${displayName}?`));
      body.appendChild(el("p", undefined, "This removes their personal data everywhere. Booking amounts are kept under Erased talent."));
      const actions = el("div", "dialog-actions");
      const keep = button("Keep", () => {
        dialog.close();
        dialog.remove();
      });
      const erase = button("Erase", async () => {
        try {
          await api(`/api/talent/${id}/erase`, { body: {} });
          dialog.close();
          dialog.remove();
          announce(rosterStatus, `Erased ${displayName}'s personal data. Booking amounts are kept under Erased talent.`);
          focusElement(stateCell);
          await rerender();
        } catch {
          announce(rosterStatus, "That talent's record changed elsewhere. Reload to see it.");
        }
      }, "primary");
      actions.append(keep, erase);
      body.appendChild(actions);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }

    async function openImport(): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Import roster");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Import roster"));
      const file = document.createElement("input");
      file.type = "file";
      file.accept = ".csv";
      file.setAttribute("aria-label", "Roster CSV");
      const run = button("Import", async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        run.textContent = "Importing roster…";
        const form = new FormData();
        form.append("file", chosen);
        const res = await fetch("/api/roster/imports", { method: "POST", body: form });
        run.textContent = "Import";
        if (!res.ok) {
          const err = (await res.json()) as { errors?: Record<string, string> };
          dialogErrorText(dialog, err.errors?.file || "The import failed.");
          return;
        }
        const report = (await res.json()) as { counts: { created: number; merged: number; unchanged: number; orphan: number }; rows: Array<{ row: number; outcome: string; reason: string | null; filled: string[] }> };
        dialog.close();
        dialog.remove();
        announce(rosterStatus, `Import finished: ${report.counts.created} created, ${report.counts.merged} merged, ${report.counts.unchanged} unchanged, ${report.counts.orphan} orphans.`);
        const heading = el("h2", undefined, "Import report");
        reportRegion.textContent = "";
        reportRegion.appendChild(heading);
        const table = el("table");
        table.setAttribute("aria-label", "Import report");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["Row", "Outcome", "Reason", "Filled"]) headRow.appendChild(el("th", undefined, label));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const r of report.rows) {
          const row = el("tr");
          row.append(el("td", undefined, String(r.row)), el("td", undefined, r.outcome), el("td", undefined, r.reason || ""), el("td", undefined, r.filled.join(", ")));
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        reportRegion.appendChild(table);
        focusElement(heading);
      }, "primary");
      body.append(file, run);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }
  },
};

register(rosterPage);

/** Members with invitations. */
const membersPage: Page = {
  path: "/workspace/members",
  title: () => "Members",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Members"));
    const data = (await api("/api/members")) as { members: Array<{ id: string; name: string; email: string; role: string; office: string }> };
    const status = el("div", "status-live");
    main.appendChild(button("Invite member", () => {
      void openInvite();
    }, "primary"));
    const table = el("table");
    table.setAttribute("aria-label", "Members");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Name", "Email", "Role", "Office", ""]) headRow.appendChild(el("th", undefined, label));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const m of data.members) {
      const row = el("tr");
      row.append(el("td", undefined, m.name), el("td", undefined, m.email), el("td", undefined, m.role), el("td", undefined, m.office));
      const actionCell = el("td");
      const remove = button("Remove", async () => {
        try {
          await api(`/api/members/${m.id}`, { method: "DELETE" });
          await rerender();
        } catch (err) {
          const fail = err as ApiFail;
          if (fail.code === "own_membership") announce(status, "You cannot remove yourself.");
        }
      });
      actionCell.appendChild(remove);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    main.append(table, status);

    async function openInvite(): Promise<void> {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Invite member");
      const body = el("div", "dialog-body");
      body.appendChild(el("h2", undefined, "Invite member"));
      const name = makeInput("Name", "text");
      const email = makeInput("Email", "email");
      const role = makeSelect("Role", [["agency_director", "Agency director"], ["booker", "Booker"], ["accounts_lead", "Accounts lead"], ["scout", "Scout"]]);
      const office = makeSelect("Office", [["toronto", "Toronto"], ["vancouver", "Vancouver"]]);
      const send = button("Send invitation", async () => {
        send.textContent = "Sending…";
        try {
          const result = (await api("/api/invitations", {
            body: {
              name: (name.querySelector("input") as HTMLInputElement).value,
              email: (email.querySelector("input") as HTMLInputElement).value,
              role: (role.querySelector("select") as HTMLSelectElement).value,
              office: (office.querySelector("select") as HTMLSelectElement).value,
            },
          })) as { message: string };
          dialog.close();
          dialog.remove();
          announce(status, result.message);
        } catch {
          send.textContent = "Send invitation";
          dialogErrorText(dialog, "Check the details and try again.");
        }
      }, "primary");
      body.append(name, email, role, office, send);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      dialog.showModal();
    }
  },
};

register(membersPage);

/** Rate cards. */
const rateCardsPage: Page = {
  path: "/workspace/rate-cards",
  title: () => "Rate cards",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Rate cards"));
    const data = (await api("/api/rate-cards")) as { rateCards: Array<{ id: string; name: string; effectiveFrom: string; boards: Record<string, { fullDayCents: number; halfDayCents: number; overtimeQuarterHourCents: number }>; usageBaseCents: Record<string, number> }> };
    for (const card of data.rateCards) {
      main.appendChild(el("h3", undefined, card.name));
      main.appendChild(el("p", undefined, `Effective from ${formatDay(card.effectiveFrom)}`));
      const table = el("table");
      table.setAttribute("aria-label", card.name);
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Board", "Full day", "Half day", "Overtime per quarter hour"]) headRow.appendChild(el("th", undefined, label));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const [board, rates] of Object.entries(card.boards)) {
        const row = el("tr");
        row.append(el("td", undefined, board), el("td", undefined, formatDay("1970-01-01").slice(0, 0) + (rates.fullDayCents / 100).toFixed(2)), el("td", undefined, (rates.halfDayCents / 100).toFixed(2)), el("td", undefined, (rates.overtimeQuarterHourCents / 100).toFixed(2)));
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      main.appendChild(table);
    }
  },
};

register(rateCardsPage);

/** Office closures. */
const officesPage: Page = {
  path: "/workspace/offices",
  title: () => "Offices",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Offices"));
    const data = (await api("/api/offices")) as { offices: Array<{ id: string; city: string; closures: string[] }> };
    for (const office of data.offices) {
      main.appendChild(el("h3", undefined, office.city));
      const list = el("ul");
      for (const date of office.closures) list.appendChild(el("li", undefined, formatDay(date)));
      main.appendChild(list);
      const add = makeInput("Add closure", "date");
      const save = button("Add closure", async () => {
        const value = (add.querySelector("input") as HTMLInputElement).value;
        if (!value) return;
        try {
          await api(`/api/offices/${office.id}/closures`, { body: { date: value } });
          await rerender();
        } catch {
          announce(calendarStatus, "That date is already a closure.");
        }
      });
      main.append(add, save);
    }
    main.appendChild(calendarStatus);
  },
};

register(officesPage);

/** Director overview. */
const overviewPage: Page = {
  path: "/workspace/overview",
  title: () => "Overview",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Overview"));
    const data = (await api("/api/overview")) as { month: string; offices: Array<{ office: string; heldDays: number; bookingsThisMonth: number; licences: Record<string, number> }> };
    for (const office of data.offices) {
      main.appendChild(el("h3", undefined, office.office === "toronto" ? "Toronto" : "Vancouver"));
      main.appendChild(el("p", undefined, `Held days ${office.heldDays} · Bookings this month ${office.bookingsThisMonth} · Licences ${office.licences.active} active, ${office.licences.expiring} expiring, ${office.licences.expired} expired`));
    }
  },
};

register(overviewPage);

/** Talent's own calendar and statements. */
const myCalendarPage: Page = {
  path: "/workspace/me",
  title: () => "My calendar",
  workspace: true,
  render: async (main) => {
    main.appendChild(el("h1", undefined, "My calendar"));
    const status = el("div", "status-live");
    let url = "";
    try {
      const data = (await api("/api/me/calendar-feed")) as { url: string };
      url = data.url;
    } catch {
      main.appendChild(el("p", undefined, "Your calendar feed is not available yet."));
      return;
    }
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", "Feed link");
    main.appendChild(input);
    main.appendChild(button("Regenerate feed link", async () => {
      try {
        const data = (await api("/api/me/calendar-feed", { body: {} })) as { url: string };
        input.value = data.url;
        announce(status, "New feed link ready. The old link no longer works.");
      } catch {
        announce(status, "Something went wrong. Try again.");
      }
    }));
    main.appendChild(status);
    const month = new Date().toISOString().slice(0, 7);
    try {
      const me = (await api("/api/me")) as { talentId: string | null };
      if (me.talentId) {
        const statement = link(`/workspace/statements/${me.talentId}/${month}`, "Open my statement");
        main.appendChild(statement);
      }
    } catch {
      void status;
    }
  },
};

register(myCalendarPage);

/** Talent profile editor with portfolio reorder and lightbox. */
const profileEditorPage: Page = {
  path: "/workspace/talent/:id",
  title: () => "Talent profile",
  workspace: true,
  render: async (main) => {
    const id = location.pathname.split("/")[3];
    const status = el("div", "status-live");
    const talent = (await api(`/api/talent/${id}`)) as {
      displayName: string;
      version: number;
      portfolioVersion: number;
      measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
      reach: { instagram: number; tiktok: number; youtube: number };
      officeNote: string | null;
      portfolio: Array<{ photoId: string; url: string }>;
    };
    main.appendChild(el("h1", undefined, talent.displayName));

    const form = el("form");
    form.setAttribute("aria-label", "Profile");
    const fields: Array<[string, string, string, string]> = [
      ["displayName", "Display name", "text", talent.displayName],
      ["height", "Height", "number", String(talent.measurements.heightCm ?? "")],
      ["chest", "Chest", "number", String(talent.measurements.chestCm ?? "")],
      ["waist", "Waist", "number", String(talent.measurements.waistCm ?? "")],
      ["hips", "Hips", "number", String(talent.measurements.hipsCm ?? "")],
      ["instagram", "Instagram followers", "number", String(talent.reach.instagram)],
      ["tiktok", "TikTok followers", "number", String(talent.reach.tiktok)],
      ["youtube", "YouTube subscribers", "number", String(talent.reach.youtube)],
      ["officeNote", "Office note", "text", talent.officeNote ?? ""],
    ];
    for (const [name, label, type, value] of fields) {
      const wrap = el("div", "field");
      const l = el("label", undefined, label);
      l.setAttribute("for", `p-${name}`);
      const input = document.createElement("input");
      input.type = type;
      input.id = `p-${name}`;
      input.value = value;
      l.setAttribute("for", input.id);
      wrap.append(l, input);
      form.appendChild(wrap);
    }
    const save = button("Save profile", async () => {
      save.textContent = "Saving profile…";
      try {
        await api(`/api/talent/${id}`, {
          method: "PATCH",
          body: {
            version: talent.version,
            displayName: (form.querySelector("#p-displayName") as HTMLInputElement).value,
            measurements: {
              height: { value: Number((form.querySelector("#p-height") as HTMLInputElement).value) },
              chest: { value: Number((form.querySelector("#p-chest") as HTMLInputElement).value) },
              waist: { value: Number((form.querySelector("#p-waist") as HTMLInputElement).value) },
              hips: { value: Number((form.querySelector("#p-hips") as HTMLInputElement).value) },
            },
            reach: {
              instagram: Number((form.querySelector("#p-instagram") as HTMLInputElement).value),
              tiktok: Number((form.querySelector("#p-tiktok") as HTMLInputElement).value),
              youtube: Number((form.querySelector("#p-youtube") as HTMLInputElement).value),
            },
            officeNote: (form.querySelector("#p-officeNote") as HTMLInputElement).value,
          },
        });
        save.textContent = "Save profile";
        announce(status, "Profile saved.");
        save.focus();
        await rerender();
      } catch (err) {
        save.textContent = "Save profile";
        const fail = err as ApiFail;
        announce(status, fail.code === "stale_version" ? `${fail.body.savedBy} saved a newer version. Your changes were not saved.` : "Something went wrong. Try again.");
      }
    }, "primary");
    form.appendChild(save);
    main.appendChild(form);

    const portfolio = el("ul");
    portfolio.setAttribute("aria-label", "Portfolio");
    let portfolioVersion = talent.portfolioVersion;
    const photos = talent.portfolio.map((p) => p);
    photos.forEach((photo, index) => {
      const li = el("li");
      li.setAttribute("aria-label", `Photo ${index + 1} of ${photos.length}`);
      void photo;
      li.appendChild(el("span", undefined, `Photo ${index + 1} of ${photos.length}`));
      li.appendChild(button("Move earlier", () => reorder(index, -1)));
      li.appendChild(button("Move later", () => reorder(index, 1)));
      const open = button("Open", () => openLightbox(photos, index, open));
      li.appendChild(open);
      portfolio.appendChild(li);
    });
    main.appendChild(portfolio);

    const upload = document.createElement("input");
    upload.type = "file";
    upload.accept = "image/jpeg,image/png,image/webp";
    upload.setAttribute("aria-label", "Upload photo");
    const uploadBtn = button("Upload photo", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      uploadBtn.textContent = "Uploading photo…";
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/talent/${id}/photos`, { method: "POST", body: form });
      uploadBtn.textContent = "Upload photo";
      if (res.ok) announce(status, "Photo added to the portfolio.");
      else announce(status, "That file is not a JPEG, PNG or WebP photo.");
      await rerender();
    });
    main.append(upload, uploadBtn, status);

    async function reorder(index: number, delta: number): Promise<void> {
      const target = index + delta;
      if (target < 0 || target >= photos.length) return;
      const ids = photos.map((p) => p.photoId);
      const [moved] = ids.splice(index, 1);
      ids.splice(target, 0, moved);
      try {
        const result = (await api(`/api/talent/${id}/photos/order`, {
          method: "PUT",
          body: { portfolioVersion, photoIds: ids },
        })) as { portfolioVersion: number };
        portfolioVersion = result.portfolioVersion;
        announce(status, `Moved photo to position ${target + 1} of ${photos.length}.`);
        await rerender();
      } catch (err) {
        const fail = err as ApiFail;
        announce(status, fail.code === "stale_version"
          ? `${fail.body.savedBy} saved a newer order. The previous order is back.`
          : "Something went wrong. Try again.");
      }
    }

    function openLightbox(list: Array<{ url: string }>, start: number, opener: HTMLButtonElement): void {
      let current = start;
      const box = el("div", "lightbox");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Portfolio");
      const img = document.createElement("img");
      img.alt = "Portfolio photo";
      const counter = el("p", "counter", `${start + 1} of ${list.length}`);
      const prev = button("Previous photo", () => step(-1));
      const next = button("Next photo", () => step(1));
      const closeBtn = button("Close", () => {
        box.remove();
        opener.focus();
      });
      function step(delta: number): void {
        current = (current + delta + list.length) % list.length;
        img.src = list[current].url;
        counter.textContent = `${current + 1} of ${list.length}`;
      }
      img.src = list[start].url;
      box.append(img, prev, next, closeBtn, counter);
      document.body.appendChild(box);
      box.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") step(-1);
        if (event.key === "ArrowRight") step(1);
        if (event.key === "Escape") {
          box.remove();
          opener.focus();
        }
      });
      closeBtn.focus();
    }
  },
};

register(profileEditorPage);



export function registerWorkspacePages(): void {
  // pages register themselves at module load
}
