/** Tenants: lifecycle, inspection links, storage shelves. */

import type { Shelf, Tenant, User } from "../../shared/api-types.js";
import { DOCUMENT_KIND_LABELS } from "../../shared/api-types.js";
import { ApiClientError, apiJson } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, fallbackCopy, showActivity, showError } from "../feedback.js";
import { openDialog } from "../ui/dialog.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
}

const STATUS_WORDS: Record<string, string> = {
  applied: "Applied",
  documents_review: "Documents review",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded"
};

export async function renderTenants(root: HTMLElement, deps: ScreenDeps): Promise<void> {
  const user = deps.user;
  if (user === null || user.role !== "operator") return;
  const screen = document.createElement("div");
  screen.className = "screen";
  const title = document.createElement("h1");
  title.textContent = "Tenants";
  screen.appendChild(title);

  const tenantsWrap = document.createElement("div");
  tenantsWrap.className = "table-wrap";
  const tenantsTable = document.createElement("table");
  tenantsTable.className = "data";
  tenantsTable.setAttribute("aria-label", "Tenants");
  tenantsTable.innerHTML = `<thead><tr><th scope="col">Business</th><th scope="col">Status</th><th scope="col">Required documents</th><th scope="col">Actions</th></tr></thead>`;
  const tenantsBody = document.createElement("tbody");
  tenantsTable.appendChild(tenantsBody);
  tenantsWrap.appendChild(tenantsTable);
  screen.appendChild(tenantsWrap);

  const shelvesPanel = document.createElement("section");
  shelvesPanel.className = "panel";
  const shelvesTitle = document.createElement("h2");
  shelvesTitle.textContent = "Storage shelves";
  const shelvesWrap = document.createElement("div");
  shelvesWrap.className = "table-wrap";
  const shelvesTable = document.createElement("table");
  shelvesTable.className = "data";
  shelvesTable.setAttribute("aria-label", "Storage shelves");
  shelvesTable.innerHTML = `<thead><tr><th scope="col">Shelf</th><th scope="col">Monthly rate</th><th scope="col">Tenant</th></tr></thead>`;
  const shelvesBody = document.createElement("tbody");
  shelvesTable.appendChild(shelvesBody);
  shelvesWrap.appendChild(shelvesTable);
  shelvesPanel.append(shelvesTitle, shelvesWrap);
  screen.appendChild(shelvesPanel);
  root.replaceChildren(screen);

  async function load(): Promise<void> {
    showActivity(deps.feedback, "Loading…");
    try {
      const [tenantsRes, shelvesRes] = await Promise.all([
        apiJson<{ tenants: Tenant[] }>("GET", "/api/tenants"),
        apiJson<{ shelves: Shelf[] }>("GET", "/api/shelves")
      ]);
      clearActivity(deps.feedback);
      renderTenantsRows(tenantsRes.tenants);
      renderShelves(shelvesRes.shelves);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  function renderTenantsRows(tenants: Tenant[]): void {
    tenantsBody.replaceChildren();
    for (const tenant of tenants) {
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.dataset.label = "Business";
      nameTd.textContent = tenant.business_name;
      const statusTd = document.createElement("td");
      statusTd.dataset.label = "Status";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = STATUS_WORDS[tenant.status] ?? tenant.status;
      statusTd.appendChild(badge);
      const docsTd = document.createElement("td");
      docsTd.dataset.label = "Required documents";
      const docList = Object.entries(tenant.required_documents).map(([kind, state]) => {
        const label = DOCUMENT_KIND_LABELS[kind as keyof typeof DOCUMENT_KIND_LABELS];
        return `${label}: ${state.valid ? `valid until ${state.expires_on}` : state.expires_on === null ? "missing" : `expired ${state.expires_on}`}`;
      });
      docsTd.textContent = docList.join("; ");
      const actionTd = document.createElement("td");
      actionTd.dataset.label = "Actions";
      const actions = document.createElement("div");
      actions.className = "row-actions";
      if (tenant.status === "documents_review") {
        const activate = document.createElement("button");
        activate.className = "btn";
        activate.textContent = `Activate ${tenant.business_name}`;
        activate.addEventListener("click", () => void activateTenant(tenant, activate));
        actions.appendChild(activate);
      }
      if (tenant.status === "active" || tenant.status === "suspended") {
        const offboard = document.createElement("button");
        offboard.className = "btn";
        offboard.textContent = `Offboard ${tenant.business_name}`;
        offboard.addEventListener("click", () => openOffboardDialog(tenant));
        actions.appendChild(offboard);
      }
      const link = document.createElement("button");
      link.className = "btn";
      link.textContent = `Inspection link for ${tenant.business_name}`;
      link.addEventListener("click", () => openLinkDialog(tenant));
      actions.appendChild(link);
      actionTd.appendChild(actions);
      tr.append(nameTd, statusTd, docsTd, actionTd);
      tenantsBody.appendChild(tr);
    }
  }

  async function activateTenant(tenant: Tenant, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    showActivity(deps.feedback, "Activating…");
    try {
      await apiJson<Tenant>("POST", `/api/tenants/${tenant.id}/activate`, {});
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `${tenant.business_name} is active.`);
    } catch (e) {
      button.disabled = false;
      if (e instanceof ApiClientError) {
        if (e.detail.code === "documents_incomplete") {
          const missing = (e.detail.details["missing"] as string[] | undefined) ?? [];
          const words = missing.map((k) => DOCUMENT_KIND_LABELS[k as keyof typeof DOCUMENT_KIND_LABELS] ?? k);
          showError(deps.feedback, `${tenant.business_name} is missing an approved, valid ${words.join(" and ")}.`);
          return;
        }
        showError(deps.feedback, fallbackCopy(e));
      }
    }
  }

  function openOffboardDialog(tenant: Tenant): void {
    openDialog({
      label: `Offboard ${tenant.business_name}`,
      build: (inner, close) => {
        const text = document.createElement("p");
        text.textContent = `${tenant.business_name}'s users will no longer be able to sign in.`;
        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const offboard = document.createElement("button");
        offboard.className = "btn primary";
        offboard.textContent = "Offboard";
        offboard.addEventListener("click", async () => {
          showActivity(deps.feedback, "Offboarding…");
          try {
            await apiJson<Tenant>("POST", `/api/tenants/${tenant.id}/offboard`, {});
            close();
            await load();
            clearActivity(deps.feedback);
            showActivity(deps.feedback, `${tenant.business_name} is offboarded.`);
          } catch (e) {
            if (e instanceof ApiClientError) {
              showError(
                deps.feedback,
                e.detail.code === "open_bookings"
                  ? `${tenant.business_name} still has open bookings. Cancel or complete them first.`
                  : fallbackCopy(e)
              );
            }
          }
        });
        const keep = document.createElement("button");
        keep.className = "btn";
        keep.textContent = "Keep tenant";
        keep.addEventListener("click", () => close());
        actions.append(offboard, keep);
        inner.append(text, actions);
      }
    });
  }

  function openLinkDialog(tenant: Tenant): void {
    openDialog({
      label: `Inspection link for ${tenant.business_name}`,
      onClose: () => void load(),
      build: (inner, close) => {
        const durationField = document.createElement("div");
        durationField.className = "field";
        const durationLabel = document.createElement("label");
        durationLabel.setAttribute("for", "link-duration");
        durationLabel.textContent = "Link lasts";
        const duration = document.createElement("select");
        duration.id = "link-duration";
        duration.add(new Option("1 hour", "3600"));
        duration.add(new Option("24 hours", "86400", true));
        duration.add(new Option("7 days", "604800"));
        durationField.append(durationLabel, duration);

        const issueRow = document.createElement("div");
        issueRow.className = "row-actions";
        const issue = document.createElement("button");
        issue.className = "btn primary";
        issue.textContent = "Issue link";
        const linkField = document.createElement("div");
        linkField.className = "field";
        const linkLabel = document.createElement("label");
        linkLabel.setAttribute("for", "link-value");
        linkLabel.textContent = "Link";
        const linkValue = document.createElement("input");
        linkValue.readOnly = true;
        linkValue.id = "link-value";
        linkField.append(linkLabel, linkValue);
        const copyButton = document.createElement("button");
        copyButton.className = "btn";
        copyButton.textContent = "Copy link";
        const revokeButton = document.createElement("button");
        revokeButton.className = "btn";
        revokeButton.textContent = "Revoke link";
        issueRow.append(issue, copyButton, revokeButton);
        inner.append(durationField, issueRow, linkField);

        // Show any live link when the dialog opens.
        void apiJson<{ url: string; expires_at: string }>(
          "GET",
          `/api/tenants/${tenant.id}/inspection-link`
        ).then((res) => {
          linkValue.value = `${window.location.origin}${res.url}`;
        }).catch(() => {
          linkValue.value = "";
        });

        issue.addEventListener("click", async () => {
          showActivity(deps.feedback, "Issuing link…");
          try {
            const res = await apiJson<{ url: string; expires_at: string }>(
              "POST",
              `/api/tenants/${tenant.id}/inspection-link`,
              { expires_in_seconds: Number(duration.value) }
            );
            linkValue.value = `${window.location.origin}${res.url}`;
            const shown = res.expires_at.slice(0, 16).replace("T", " ");
            clearActivity(deps.feedback);
            showActivity(
              deps.feedback,
              `Link issued. It expires ${shown} kitchen time. Any earlier link for this tenant no longer works.`
            );
          } catch (e) {
            if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
          }
        });
        copyButton.addEventListener("click", async () => {
          if (linkValue.value === "") return;
          await navigator.clipboard.writeText(linkValue.value);
          clearActivity(deps.feedback);
        });
        revokeButton.addEventListener("click", async () => {
          showActivity(deps.feedback, "Revoking…");
          try {
            await apiJson("DELETE", `/api/tenants/${tenant.id}/inspection-link`);
            linkValue.value = "";
            clearActivity(deps.feedback);
            showActivity(deps.feedback, "Link revoked.");
          } catch (e) {
            if (e instanceof ApiClientError) {
              showError(
                deps.feedback,
                e.detail.code === "not_found" ? "There is no live link to revoke." : fallbackCopy(e)
              );
            }
          }
        });
        const closeRow = document.createElement("div");
        closeRow.className = "dialog-actions";
        const done = document.createElement("button");
        done.className = "btn";
        done.textContent = "Close";
        done.addEventListener("click", () => close());
        closeRow.appendChild(done);
        inner.appendChild(closeRow);
      }
    });
  }

  async function renderShelves(shelves: Shelf[]): Promise<void> {
    shelvesBody.replaceChildren();
    const tenantsRes = await apiJson<{ tenants: Tenant[] }>("GET", "/api/tenants");
    const activeTenants = tenantsRes.tenants.filter((t) => t.status === "active");
    for (const shelf of shelves) {
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.dataset.label = "Shelf";
      nameTd.textContent = shelf.name;
      const rateTd = document.createElement("td");
      rateTd.dataset.label = "Monthly rate";
      rateTd.textContent = `$${(shelf.monthly_rate_cents / 100).toFixed(2)}`;
      rateTd.className = "mono";
      const tenantTd = document.createElement("td");
      tenantTd.dataset.label = "Tenant";
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Tenant for ${shelf.name}`);
      select.add(new Option("Unassigned", ""));
      for (const tenant of activeTenants) {
        const option = new Option(tenant.business_name, tenant.id);
        select.add(option);
      }
      select.value = shelf.tenant_id ?? "";
      select.addEventListener("change", () => void assignShelf(shelf, select.value || null, select));
      tenantTd.appendChild(select);
      tr.append(nameTd, rateTd, tenantTd);
      shelvesBody.appendChild(tr);
    }
  }

  async function assignShelf(shelf: Shelf, tenantId: string | null, select: HTMLSelectElement): Promise<void> {
    showActivity(deps.feedback, "Saving shelf…");
    try {
      const updated = await apiJson<Shelf>("PUT", `/api/shelves/${encodeURIComponent(shelf.id)}`, {
        tenant_id: tenantId
      });
      clearActivity(deps.feedback);
      showActivity(
        deps.feedback,
        updated.tenant_id === null ? `${shelf.name} is unassigned.` : `${shelf.name} assigned to ${updated.tenant_name}.`
      );
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.detail.code === "tenant_not_active") {
          select.value = shelf.tenant_id ?? "";
          showError(deps.feedback, "Only active tenants can rent a shelf.");
          return;
        }
        showError(deps.feedback, fallbackCopy(e));
      }
    }
  }

  await load();
}
