import type { ShareLink } from "../../shared/types.js";
import { api, ApiFailure } from "../api.js";
import { h, formatInstant } from "../dom.js";
import { currentApp } from "../main.js";
import { feedback } from "../ui.js";

/** Settings: objectives, members and share links (DP-17, DP-30, DP-35). */
export async function renderSettings(
  _screen: HTMLElement,
  fail: (err: unknown) => void,
): Promise<HTMLElement> {
  const root = h("div", null);
  const app = currentApp()!;
  let refreshTimer: number | undefined;

  // Settings shows only to the head of product (DP-30, DP-35).
  if (app.user.role !== "head_of_product") {
    root.appendChild(
      h("p", { class: "empty-note" }, "Settings is only for the head of product."),
    );
    return root;
  }

  root.appendChild(h("h2", null, "Settings"));

  // --- Objectives ---
  const objectivesRegion = h("section", { class: "panel", role: "region", "aria-label": "Objectives" });
  objectivesRegion.appendChild(h("h3", null, "Objectives"));
  const renderObjectives = async (): Promise<void> => {
    try {
      const result = await api.objectives();
      objectivesRegion.replaceChildren(h("h3", null, "Objectives"));
      const saveAll = h("button", { class: "primary" }, "Save weights") as HTMLButtonElement;
      const error = h("span", { class: "field-error" });
      const fields: Array<{ id: string; input: HTMLInputElement }> = [];
      const form = h("form", {
        onsubmit: async (event: SubmitEvent) => {
          event.preventDefault();
          error.replaceChildren();
          feedback?.saveStatus("Saving weights…");
          let bad = false;
          for (const field of fields) {
            const value = Number.parseInt(field.input.value, 10);
            if (!Number.isInteger(value) || value < 0 || value > 100) {
              bad = true;
              error.replaceChildren("Weight must be a whole number from 0 to 100.");
              break;
            }
            await api.saveWeights(field.id, value);
          }
          if (!bad) {
            feedback?.saveStatus("Weights saved. Priorities updated.");
          } else {
            feedback?.saveStatus("");
          }
          await renderObjectives();
        },
      });
      for (const objective of result.objectives) {
        const input = h("input", {
          type: "number",
          role: "spinbutton",
          "aria-label": `${objective.name} weight`,
          min: "0",
          max: "100",
          value: String(objective.weight),
        }) as HTMLInputElement;
        fields.push({ id: objective.id, input });
        form.appendChild(h("label", null, `${objective.name} weight`));
        form.appendChild(input);
      }
      form.appendChild(error);
      form.appendChild(h("div", { class: "dialog-actions" }, saveAll));
      objectivesRegion.appendChild(form);
    } catch (err) {
      fail(err);
    }
  };
  await renderObjectives();

  // --- Members ---
  const membersRegion = h("section", { class: "panel", role: "region", "aria-label": "Members" });
  membersRegion.appendChild(h("h3", null, "Members"));
  const inviteEmail = h("input", { type: "email", "aria-label": "Invite email" }) as HTMLInputElement;
  const inviteRole = h("select", { "aria-label": "Role" }) as HTMLSelectElement;
  for (const [value, label] of [
    ["head_of_product", "Head of product"],
    ["product_manager", "Product manager"],
    ["customer_success", "Customer success"],
  ] as const) {
    inviteRole.appendChild(h("option", { value }, label));
  }
  const inviteButton = h("button", { class: "primary" }, "Send invitation") as HTMLButtonElement;
  inviteButton.addEventListener("click", async () => {
    inviteButton.textContent = "Sending invitation…";
    try {
      const result = await api.invite(inviteEmail.value.trim(), inviteRole.value);
      feedback?.saveStatus(`Invitation queued for ${result.invitation.email}.`);
      inviteEmail.value = "";
    } catch (err) {
      if (err instanceof ApiFailure) {
        feedback?.alert(err.error.error.message);
      }
    }
    inviteButton.textContent = "Send invitation";
  });
  membersRegion.appendChild(h("label", null, "Invite email"));
  membersRegion.appendChild(inviteEmail);
  membersRegion.appendChild(h("label", null, "Role"));
  membersRegion.appendChild(inviteRole);
  membersRegion.appendChild(h("div", { class: "dialog-actions" }, inviteButton));

  // --- Share links ---
  const linksRegion = h("section", { class: "panel", role: "region", "aria-label": "Share links" });
  const renderLinks = async (): Promise<void> => {
    try {
      const result = await api.shareLinks();
      linksRegion.replaceChildren(h("h3", null, "Share links"));
      const lifetime = h("input", {
        type: "number",
        role: "spinbutton",
        "aria-label": "Link lifetime (seconds)",
        placeholder: "no expiry",
      }) as HTMLInputElement;
      const lifetimeError = h("span", { class: "field-error" });
      const create = h("button", {
        class: "primary",
        onclick: async () => {
          lifetimeError.replaceChildren();
          const raw = lifetime.value.trim();
          const seconds = raw.length === 0 ? null : Number.parseInt(raw, 10);
          if (seconds !== null && (!Number.isInteger(seconds) || seconds < 30 || seconds > 31_536_000)) {
            lifetimeError.replaceChildren("Lifetime must be a whole number of seconds from 30 to 31536000.");
            return;
          }
          try {
            await api.createShareLink(seconds);
            feedback?.saveStatus("Share link created.");
            await renderLinks();
          } catch (err) {
            if (err instanceof ApiFailure) {
              lifetimeError.replaceChildren(err.error.error.fields?.expiresInSeconds ?? err.error.error.message);
            }
          }
        },
      }, "Create share link") as HTMLButtonElement;
      linksRegion.appendChild(h("label", null, "Link lifetime (seconds)"));
      linksRegion.appendChild(lifetime);
      linksRegion.appendChild(lifetimeError);
      linksRegion.appendChild(h("div", { class: "dialog-actions" }, create));

      const list = h("ul", { "aria-label": "Share links" });
      for (const link of result.shareLinks) {
        list.appendChild(renderLinkRow(link));
      }
      linksRegion.appendChild(list);
    } catch (err) {
      fail(err);
    }
  };

  const renderLinkRow = (link: ShareLink): HTMLElement => {
    const row = h("li", null,
      h("a", { href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.url),
      h("div", { class: "note-meta" },
        `Created ${formatInstant(link.createdAt, app.workspace.timeZone)}` +
        (link.expiresAt === null ? "" : ` · Expires ${formatInstant(link.expiresAt, app.workspace.timeZone)}`) +
        (link.revokedAt === null ? "" : ` · Revoked ${formatInstant(link.revokedAt, app.workspace.timeZone)}`),
      ),
      h("span", { class: "status-chip" }, link.status),
      h("div", { class: "toolbar-actions" },
        h("button", {
          onclick: async () => {
            await navigator.clipboard?.writeText(link.url).catch(() => undefined);
            feedback?.saveStatus("Link copied.");
          },
        }, "Copy link"),
        link.status === "revoked" ? null : h("button", {
          onclick: async () => {
            try {
              await api.regenerateShareLink(link.id);
              feedback?.saveStatus("New link created. The old link no longer works.");
              await renderLinks();
            } catch (err) {
              if (err instanceof ApiFailure) feedback?.alert(err.error.error.message);
            }
          },
        }, "Regenerate"),
        link.status === "revoked" ? null : h("button", {
          onclick: async () => {
            try {
              await api.revokeShareLink(link.id);
              feedback?.saveStatus("Link revoked. It no longer works.");
              await renderLinks();
            } catch (err) {
              if (err instanceof ApiFailure) feedback?.alert(err.error.error.message);
            }
          },
        }, "Revoke"),
      ),
    );
    return row;
  };

  // The share-link list reloads every 30 seconds and after every action (DP-49).
  await renderLinks();
  refreshTimer = window.setInterval(() => void renderLinks(), 30_000);
  window.addEventListener("beforeunload", () => window.clearInterval(refreshTimer));

  root.appendChild(objectivesRegion);
  root.appendChild(membersRegion);
  root.appendChild(linksRegion);
  return root;
}
