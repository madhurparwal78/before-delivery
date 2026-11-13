/**
 * Keys: create with the one-time reveal, list and revoke.
 */
import { api, ApiFail, showNotice } from "./api";
import { emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";

interface KeyInfo {
  id: string;
  name: string;
  stream_pattern: string;
  actions: string[] | string;
  expires_at: string | null;
  revoked: boolean;
  last4: string;
}

export function buildKeys(view: HTMLElement): void {
  const holder = h("div", {});
  const table = h("table", {});
  table.setAttribute("aria-label", "Keys");

  const newKey = h("button", { class: "btn-main" }, "New key");
  newKey.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "New key"));
        const name = document.createElement("input");
        name.className = "input";
        name.setAttribute("aria-label", "Key name");
        const pattern = document.createElement("input");
        pattern.className = "input mono";
        pattern.setAttribute("aria-label", "Stream pattern");
        pattern.value = "*";
        const actionsGroup = h("fieldset", { role: "group", "aria-label": "Actions" });
        const checks: Record<string, HTMLInputElement> = {};
        for (const action of ["read", "upload", "manage"]) {
          const label = h("label", { style: { display: "inline-block", marginRight: "10px" } });
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.setAttribute("aria-label", action);
          checks[action] = cb;
          label.append(cb, document.createTextNode(" " + action));
          actionsGroup.append(label);
        }
        const expires = document.createElement("input");
        expires.className = "input mono";
        expires.type = "number";
        expires.setAttribute("aria-label", "Expires in (days)");
        const create = h("button", { class: "btn-main" }, "Create key");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        const keyHolder = h("div", {});
        create.addEventListener("click", async () => {
          create.setAttribute("aria-busy", "true");
          try {
            const actions = Object.entries(checks)
              .filter(([, cb]) => cb.checked)
              .map(([a]) => a);
            const res = await api<KeyInfo & { key: string }>("/api/keys", {
              method: "POST",
              body: JSON.stringify({
                name: name.value,
                stream_pattern: pattern.value,
                actions,
                expires_in_days: expires.value === "" ? null : Number(expires.value),
              }),
              headers: { "Content-Type": "application/json" },
            });
            // One-time reveal
            keyHolder.replaceChildren();
            const note = h("div", {}, "This key is shown once. Copy it now.");
            note.className = "muted";
            const value = document.createElement("input");
            value.className = "input mono";
            value.setAttribute("aria-label", "New key value");
            value.readOnly = true;
            value.value = res.key;
            const done = h("button", { class: "btn-main" }, "Done");
            done.addEventListener("click", () => {
              close();
              void load();
            });
            keyHolder.append(note, value, done);
            create.style.display = "none";
            cancel.style.display = "none";
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            create.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(create, cancel);
        box.append(name, pattern, actionsGroup, expires, row, keyHolder);
        return box;
      },
      newKey,
      "New key",
    );
  });

  view.append(h("div", { style: { margin: "10px 0" } }, newKey), holder);

  async function load(): Promise<void> {
    try {
      const res = await api<{ keys: KeyInfo[] }>("/api/keys");
      table.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Name", "Pattern", "Actions", "Expires", "Key", ""]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const k of res.keys) {
        const tr = h("tr", {});
        const actions = Array.isArray(k.actions) ? k.actions.join(",") : String(k.actions);
        tr.append(
          h("td", {}, k.name),
          h("td", { class: "mono" }, k.stream_pattern),
          h("td", { class: "mono" }, actions),
          h("td", { class: "mono" }, k.expires_at ?? "never"),
          h("td", { class: "mono" }, `...${k.last4}`),
        );
        const td = h("td", {});
        if (!k.revoked) {
          const revoke = h("button", { class: "btn", "aria-label": `Revoke ${k.name}` }, "Revoke");
          revoke.addEventListener("click", async () => {
            try {
              await api(`/api/keys/${k.id}`, { method: "DELETE" });
              showNotice(`Key ${k.name} revoked.`);
              void load();
            } catch (err) {
              if (err instanceof ApiFail) showNotice(err.body.message);
            }
          });
          td.append(revoke);
        } else {
          td.textContent = "revoked";
        }
        tr.append(td);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.keys.length === 0) {
        const btn = h("button", { class: "btn-main" }, "New key");
        btn.addEventListener("click", () => newKey.click());
        holder.append(emptyBand("No API keys yet.", btn));
      }
    } catch (err) {
      if (err instanceof ApiFail) {
        holder.replaceChildren(namedAlert("Error", err.body.message));
      } else {
        holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
      }
    }
  }

  void load();
}
