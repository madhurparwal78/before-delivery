import { api, el, announce, problemText } from "../api.js";

interface StaffMember {
  id: number;
  email: string;
  name: string;
  role: string;
  organisation_id: string | null;
}

interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string | null;
}

export async function renderAdmin(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Admin" }));
  const statusNode = el("div", { role: "status", "aria-label": "Admin status", text: "" });
  wrap.append(statusNode);

  // Staff
  const staffPanel = el("section", { class: "panel" });
  staffPanel.append(el("h2", { text: "Staff" }));
  const staffTable = el("table", { class: "ruled", "aria-label": "Staff" });
  const loadStaff = async (): Promise<StaffMember[]> => {
    const staff = (await api<{ users: StaffMember[] }>("/api/admin/staff")).users;
    staffTable.replaceChildren();
    const head = el("thead");
    const headRow = el("tr");
    for (const col of ["Email", "Name", "Role"]) headRow.append(el("th", { text: col }));
    head.append(headRow);
    staffTable.append(head);
    const tbody = el("tbody");
    for (const member of staff) {
      const tr = el("tr");
      tr.append(el("td", { text: member.email }), el("td", { text: member.name }));
      const roleCell = el("td");
      const select = el("select", { "aria-label": `Role for ${member.name}` }) as HTMLSelectElement;
      for (const role of ["visitor", "group_booker", "artist", "curator", "box_office", "finance", "admin"]) {
        select.append(el("option", { value: role, text: role }));
      }
      select.value = member.role;
      select.addEventListener("change", async () => {
        try {
          await api(`/api/admin/staff/${member.id}`, {
            method: "PATCH",
            body: JSON.stringify({ role: select.value }),
          });
          announce(statusNode, "Saved.");
          await loadStaff();
        } catch (err) {
          announce(statusNode, problemText(err));
        }
      });
      roleCell.append(select);
      tr.append(roleCell);
      tbody.append(tr);
    }
    staffTable.append(tbody);
    return staff;
  };
  const addStaffBtn = el("button", { text: "Add staff member" });
  addStaffBtn.addEventListener("click", () => {
    const dialog = document.createElement("dialog");
    const inner = el("div", { class: "dialog-inner" });
    inner.append(el("h2", { text: "Add staff member" }));
    const fields: Record<string, HTMLInputElement> = {};
    for (const [label, type] of [["Email", "email"], ["Name", "text"], ["Password", "password"], ["Role", "text"], ["Organisation id", "text"]]) {
      const input = el("input", { type, "aria-label": label }) as HTMLInputElement;
      fields[label] = input;
      const lab = el("label", { text: label });
      lab.append(input);
      inner.append(lab);
    }
    const create = el("button", { text: "Create" });
    create.addEventListener("click", async () => {
      try {
        await api("/api/admin/staff", {
          method: "POST",
          body: JSON.stringify({
            email: fields["Email"].value,
            name: fields["Name"].value,
            password: fields["Password"].value,
            role: fields["Role"].value,
            organisation_id: fields["Organisation id"].value === "" ? null : fields["Organisation id"].value,
          }),
        });
        announce(statusNode, "Saved.");
        dialog.close();
        dialog.remove();
        await loadStaff();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });
    inner.append(create);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
  });
  await loadStaff();
  staffPanel.append(addStaffBtn, staffTable);
  wrap.append(staffPanel);

  // Venues
  const venuePanel = el("section", { class: "panel" });
  venuePanel.append(el("h2", { text: "Venues" }));
  const venueTable = el("table", { class: "ruled", "aria-label": "Venues" });
  const loadVenues = async (): Promise<void> => {
    const venues = (await api<{ venues: Array<{ id: string; name: string }> }>("/api/admin/venues")).venues;
    venueTable.replaceChildren();
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", { text: "Id" }), el("th", { text: "Name" }));
    head.append(headRow);
    venueTable.append(head);
    const tbody = el("tbody");
    for (const venue of venues) {
      const tr = el("tr");
      tr.append(el("td", { text: venue.id }), el("td", { text: venue.name }));
      tbody.append(tr);
    }
    venueTable.append(tbody);
  };
  await loadVenues();
  const addVenueBtn = el("button", { text: "Add venue" });
  addVenueBtn.addEventListener("click", async () => {
    const dialog = document.createElement("dialog");
    const inner = el("div", { class: "dialog-inner" });
    inner.append(el("h2", { text: "Add venue" }));
    const idInput = el("input", { type: "text", "aria-label": "Venue id" }) as HTMLInputElement;
    const nameInput = el("input", { type: "text", "aria-label": "Venue name" }) as HTMLInputElement;
    const idLabel = el("label", { text: "Venue id" });
    idLabel.append(idInput);
    const nameLabel = el("label", { text: "Venue name" });
    nameLabel.append(nameInput);
    const create = el("button", { text: "Create" });
    create.addEventListener("click", async () => {
      try {
        await api("/api/admin/venues", { method: "POST", body: JSON.stringify({ id: idInput.value, name: nameInput.value }) });
        announce(statusNode, "Saved.");
        dialog.close();
        dialog.remove();
        await loadVenues();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });
    inner.append(idLabel, nameLabel, create);
    dialog.append(inner);
    document.body.append(dialog);
    dialog.showModal();
  });
  venuePanel.append(addVenueBtn, venueTable);
  wrap.append(venuePanel);

  // Edition
  const editionPanel = el("section", { class: "panel" });
  editionPanel.append(el("h2", { text: "Edition" }));
  const edition = await api<{ name: string; first_day: string; last_day: string }>("/api/admin/edition");
  const nameInput = el("input", { type: "text", "aria-label": "Edition name", value: edition.name }) as HTMLInputElement;
  const firstInput = el("input", { type: "text", "aria-label": "First festival day", value: edition.first_day }) as HTMLInputElement;
  const lastInput = el("input", { type: "text", "aria-label": "Last festival day", value: edition.last_day }) as HTMLInputElement;
  const saveEdition = el("button", { text: "Save edition" });
  saveEdition.addEventListener("click", async () => {
    try {
      await api("/api/admin/edition", {
        method: "PUT",
        body: JSON.stringify({ name: nameInput.value, first_day: firstInput.value, last_day: lastInput.value }),
      });
      announce(statusNode, "Saved.");
    } catch (err) {
      announce(statusNode, problemText(err));
    }
  });
  const nameLabel = el("label", { text: "Edition name" });
  nameLabel.append(nameInput);
  const firstLabel = el("label", { text: "First festival day" });
  firstLabel.append(firstInput);
  const lastLabel = el("label", { text: "Last festival day" });
  lastLabel.append(lastInput);
  editionPanel.append(nameLabel, firstLabel, lastLabel, saveEdition);
  wrap.append(editionPanel);

  // Price policy
  const policyPanel = el("section", { class: "panel" });
  policyPanel.append(el("h2", { text: "Price policy" }));
  const policy = await api<{ full_festival_full_cents: number; full_festival_reduced_cents: number; day_full_cents: number; day_reduced_cents: number; group_discount_percent: number; version: number }>("/api/admin/price-policy");
  const fields: Record<string, HTMLInputElement> = {};
  for (const [label, value] of [
    ["Full-festival pass, full rate", policy.full_festival_full_cents],
    ["Full-festival pass, reduced rate", policy.full_festival_reduced_cents],
    ["Day pass, full rate", policy.day_full_cents],
    ["Day pass, reduced rate", policy.day_reduced_cents],
    ["Group discount percent", policy.group_discount_percent],
  ] as const) {
    const input = el("input", { type: "number", "aria-label": label, value: String(value) }) as HTMLInputElement;
    fields[label] = input;
    const lab = el("label", { text: label });
    lab.append(input);
    policyPanel.append(lab);
  }
  const savePrices = el("button", { text: "Save prices" });
  savePrices.addEventListener("click", async () => {
    try {
      await api("/api/admin/price-policy", {
        method: "PUT",
        headers: { "If-Match": String(policy.version) },
        body: JSON.stringify({
          full_festival_full_cents: Number(fields["Full-festival pass, full rate"].value),
          full_festival_reduced_cents: Number(fields["Full-festival pass, reduced rate"].value),
          day_full_cents: Number(fields["Day pass, full rate"].value),
          day_reduced_cents: Number(fields["Day pass, reduced rate"].value),
          group_discount_percent: Number(fields["Group discount percent"].value),
        }),
      });
      announce(statusNode, "Saved.");
    } catch (err) {
      if ((err as { body?: Record<string, unknown> }).body?.error === "stale_version") {
        announce(statusNode, "Someone else changed these prices. Reload to see their version.");
      } else {
        announce(statusNode, problemText(err));
      }
    }
  });
  policyPanel.append(savePrices);
  wrap.append(policyPanel);

  // Audit trail
  const auditPanel = el("section", { class: "panel" });
  auditPanel.append(el("h2", { text: "Audit trail" }));
  const auditTable = el("table", { class: "ruled", "aria-label": "Audit trail" });
  const loadAudit = async (): Promise<void> => {
    const entries = (await api<{ entries: AuditEntry[] }>("/api/admin/audit")).entries;
    auditTable.replaceChildren();
    const head = el("thead");
    const headRow = el("tr");
    for (const col of ["At", "Actor", "Action", "Target"]) headRow.append(el("th", { text: col }));
    head.append(headRow);
    auditTable.append(head);
    const tbody = el("tbody");
    for (const entry of entries) {
      const tr = el("tr");
      tr.append(
        el("td", { text: entry.at }),
        el("td", { text: `${entry.actor} (${entry.actor_role})` }),
        el("td", { text: entry.action }),
        el("td", { text: `${entry.target_type} ${entry.target_id}${entry.detail ? ` — ${entry.detail}` : ""}` }),
      );
      tbody.append(tr);
    }
    auditTable.append(tbody);
  };
  await loadAudit();
  auditPanel.append(auditTable);
  wrap.append(auditPanel);

  root.append(wrap);
}
