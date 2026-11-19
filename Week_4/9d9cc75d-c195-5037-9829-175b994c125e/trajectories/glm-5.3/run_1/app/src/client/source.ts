/** The source page: tables, relation, fields, entitlements, schedule. */

import { api, esc, el } from "./api.js";
import { displayUtc } from "../../src/shared/display.js";

export async function sourcePage(id: string): Promise<void> {
  const res = await api<{
    id: string;
    name: string;
    version: number;
    tables: { name: string; rows: number }[];
    relation: { left_table: string; left_key: string; right_table: string; right_key: string } | null;
    fields: { id: string; name: string; table: string; type: string; kind: string; hidden: boolean }[];
    hierarchy: { name: string; fields: string[] } | null;
    entitlements: { field: string | null; users: Record<string, string[]> };
    schedule: { every_minutes: number; kind: string; key: string | null } | null;
    notices: string[];
  }>("GET", `/api/sources/${id}`);
  if (res.status === 404) {
    document.getElementById("page")!.innerHTML = `<div class="card" style="max-width:520px;margin:48px auto;"><h1 class="headline">Not found.</h1></div>`;
    return;
  }
  const source = res.json!;
  const extractRes = await api<{ state: string; stale: boolean; last_success_at: string | null; next_run_at: string | null }>("GET", `/api/sources/${id}/extract`);
  const ex = extractRes.json;

  document.getElementById("page")!.className = "depth-raw";
  document.getElementById("page")!.innerHTML = `
    <div class="stack" style="max-width:1100px;margin:0 auto;padding:24px;">
      <h1 class="headline">${esc(source.name)}</h1>
      <p id="join-notice" role="status" aria-live="polite" class="status">${esc((source.notices ?? [])[0] ?? "")}</p>
      <div class="source-cols">
        <section class="card">
          <h3>Tables</h3>
          <ul>${source.tables.map((t) => `<li>${esc(t.name)} — ${t.rows} rows <a href="/api/sources/${esc(id)}/tables/${esc(t.name)}/file">Download ${esc(t.name)}</a></li>`).join("")}</ul>
          <button id="add-table">Add table</button>
          <button id="relate-tables">Relate tables</button>
          <h3 style="margin-top:24px">Fields</h3>
          <table class="data" aria-label="Fields">
            <thead><tr><th>Name</th><th>Table</th><th>Type</th><th>Kind</th><th>Actions</th></tr></thead>
            <tbody id="fields-body"></tbody>
          </table>
        </section>
        <div class="stack">
          <section class="card">
            <h3>Extract</h3>
            <p id="extract-state" role="status" aria-live="polite" class="status" data-source="${esc(id)}">${
              ex?.last_success_at ? `${ex.stale ? "Stale" : "Fresh"}, refreshed ${displayUtc(Date.parse(ex.last_success_at))} UTC` : "Fresh"
            }</p>
            <p id="next-refresh" role="status" aria-live="polite" class="status">${
              ex?.next_run_at ? `Next refresh ${displayUtc(Date.parse(ex.next_run_at))} UTC` : "No schedule."
            }</p>
            <div class="row">
              <label>Every minutes <input type="number" id="every-minutes" min="1" max="10080" value="${source.schedule?.every_minutes ?? 60}" aria-label="Every minutes"></label>
              <select id="refresh-kind" aria-label="Refresh kind"><option>Full</option><option>Incremental</option></select>
              <select id="refresh-key" aria-label="Key">${source.fields.filter((f) => f.type === "number" || f.type === "date").map((f) => `<option>${esc(f.name)}</option>`).join("")}</select>
              <button id="save-schedule">Save schedule</button>
              <button id="refresh-now">Refresh now</button>
            </div>
          </section>
          <section class="card">
            <h3>Entitlements</h3>
            <table class="data" aria-label="Entitlements">
              <thead><tr><th>Username</th><th>Values</th><th></th></tr></thead>
              <tbody>${Object.entries(source.entitlements.users ?? {}).map(([u, vals]) => `<tr><td>${esc(u)}</td><td>${esc(vals.join(", "))}</td><td><button data-ent-remove="${esc(u)}" aria-label="Remove entitlement for ${esc(u)}">Remove</button></td></tr>`).join("")}</tbody>
            </table>
            <div class="row">
              <select id="security-field" aria-label="Security field">${source.fields.filter((f) => f.kind === "dimension").map((f) => `<option ${source.entitlements.field === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
              <input id="entitled-username" aria-label="Entitled username" placeholder="username">
              <input id="ent-values" aria-label="Values" placeholder="North, South">
              <button id="add-entitlement">Add entitlement</button>
            </div>
          </section>
        </div>
      </div>
      <p id="announcements" role="status" aria-live="polite" class="status"></p>
    </div>`;

  const announce = (t: string): void => {
    document.getElementById("announcements")!.textContent = t;
  };

  // Fields table with per-field actions.
  const fieldsBody = document.getElementById("fields-body")!;
  function renderFields(): void {
    fieldsBody.innerHTML = "";
    for (const f of source.fields) {
      const tr = el(`<tr>
        <td>${esc(f.name)}</td>
        <td>${esc(f.table)}</td>
        <td>${esc(f.type)}</td>
        <td>${f.kind}</td>
        <td class="row">
          <button data-action="rename" data-id="${f.id}" aria-label="Rename ${esc(f.name)}">Rename</button>
          <button data-action="hide" data-id="${f.id}" aria-label="${f.hidden ? `Show ${esc(f.name)}` : `Hide ${esc(f.name)}`}">${f.hidden ? "Show" : "Hide"}</button>
          <button data-action="kind" data-id="${f.id}" aria-label="Change kind of ${esc(f.name)}">Change kind</button>
          <button data-action="bins" data-id="${f.id}" aria-label="Create bins for ${esc(f.name)}">Create bins</button>
          <button data-action="group" data-id="${f.id}" aria-label="Create group for ${esc(f.name)}">Create group</button>
        </td>
      </tr>`);
      fieldsBody.appendChild(tr);
    }
    for (const btn of fieldsBody.querySelectorAll<HTMLButtonElement>("button")) {
      btn.addEventListener("click", async () => {
        const field = source.fields.find((x) => x.id === btn.dataset.id)!;
        const action = btn.dataset.action;
        if (action === "hide") {
          const res2 = await api("PATCH", `/api/sources/${id}/fields/${field.id}`, { hidden: !field.hidden });
          if (res2.status === 200) {
            field.hidden = !field.hidden;
            announce(`${field.name} ${field.hidden ? "hidden" : "shown"}.`);
            renderFields();
          }
        } else if (action === "kind") {
          const res2 = await api("PATCH", `/api/sources/${id}/fields/${field.id}`, { kind: field.kind === "measure" ? "dimension" : "measure" });
          if (res2.status === 200) {
            field.kind = field.kind === "measure" ? "dimension" : "measure";
            renderFields();
          }
        } else if (action === "rename") {
          const dlg = el(`<dialog aria-label="Rename field">
            <form method="dialog" class="stack">
              <h3>Rename field</h3>
              <label>Name <input name="name" value="${esc(field.name)}" aria-label="Name"></label>
              <button class="primary" value="ok">Save name</button>
              <button value="cancel">Cancel</button>
            </form>
          </dialog>`) as HTMLDialogElement;
          document.body.appendChild(dlg);
          const opener = btn;
          dlg.showModal();
          dlg.addEventListener("close", async () => {
            const value = (dlg.querySelector("form") as HTMLFormElement).value;
            if (value !== "ok") {
              dlg.remove();
              opener.focus();
              return;
            }
            const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
            const newName = String(data.get("name") ?? "");
            const res2 = await api("PATCH", `/api/sources/${id}/fields/${field.id}`, { name: newName });
            dlg.remove();
            if (res2.status === 200) {
              const old = field.name;
              field.name = newName;
              announce(`Renamed ${old} to ${newName}.`);
              renderFields();
            } else {
              const msg = (res2.json as { errors?: { name?: string } } | null)?.errors?.name;
              announce(msg ?? "Name is required.");
            }
            opener.focus();
          });
        } else if (action === "bins") {
          const dlg = el(`<dialog aria-label="Bins">
            <form method="dialog" class="stack">
              <h3>Bins</h3>
              <label>Bin size <input type="number" name="size" min="1" value="3" aria-label="Bin size"></label>
              <button class="primary" value="ok">Save bins</button>
              <button value="cancel">Cancel</button>
            </form>
          </dialog>`) as HTMLDialogElement;
          document.body.appendChild(dlg);
          dlg.showModal();
          dlg.addEventListener("close", async () => {
            const value = (dlg.querySelector("form") as HTMLFormElement).value;
            if (value !== "ok") {
              dlg.remove();
              return;
            }
            const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
            const res2 = await api("POST", `/api/sources/${id}/bins`, { field: field.name, size: Number(data.get("size") ?? 1) });
            dlg.remove();
            if (res2.status === 201) {
              announce(`Created ${field.name} (bin).`);
              const fresh = await api<typeof source>("GET", `/api/sources/${id}`);
              if (fresh.json) {
                source.fields = fresh.json.fields;
                renderFields();
              }
            } else {
              const msg = (res2.json as { errors?: Record<string, string> } | null)?.errors;
              announce(msg?.size ?? msg?.name ?? "Bin size must be a whole number of at least 1.");
            }
          });
        } else if (action === "group") {
          const valuesRes = await api<{ members: string[] }>("POST", `/api/sheets/none/members`, {}).catch(() => null);
          void valuesRes;
          const members = source.fields.length ? [] : [];
          void members;
          const dlg = el(`<dialog aria-label="Group">
            <form method="dialog" class="stack">
              <h3>Group</h3>
              <label>Group name <input name="name" aria-label="Group name"></label>
              <label>Members (comma separated) <input name="members" aria-label="Members"></label>
              <button class="primary" value="ok">Save group</button>
              <button value="cancel">Cancel</button>
            </form>
          </dialog>`) as HTMLDialogElement;
          document.body.appendChild(dlg);
          dlg.showModal();
          dlg.addEventListener("close", async () => {
            const value = (dlg.querySelector("form") as HTMLFormElement).value;
            if (value !== "ok") {
              dlg.remove();
              return;
            }
            const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
            const name = String(data.get("name") ?? "");
            const members2 = String(data.get("members") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
            const res2 = await api("POST", `/api/sources/${id}/groups`, { field: field.name, groups: [{ name, members: members2 }] });
            dlg.remove();
            if (res2.status === 201) {
              announce(`Created ${field.name} (group).`);
              const fresh = await api<typeof source>("GET", `/api/sources/${id}`);
              if (fresh.json) {
                source.fields = fresh.json.fields;
                renderFields();
              }
            }
          });
        }
      });
    }
  }
  renderFields();

  // Entitlements
  document.getElementById("add-entitlement")!.addEventListener("click", async () => {
    const field = (document.getElementById("security-field") as HTMLSelectElement).value;
    const username = (document.getElementById("entitled-username") as HTMLInputElement).value.toLowerCase();
    const values = (document.getElementById("ent-values") as HTMLInputElement).value.split(",").map((v) => v.trim()).filter(Boolean);
    const users = { ...(source.entitlements.users ?? {}) };
    users[username] = values;
    const res2 = await api("PUT", `/api/sources/${id}/entitlements`, { field, users });
    if (res2.status === 200) {
      announce("Entitlements saved.");
      location.reload();
    }
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-ent-remove]")) {
    btn.addEventListener("click", async () => {
      const users = { ...(source.entitlements.users ?? {}) };
      delete users[btn.dataset.entRemove!];
      const res2 = await api("PUT", `/api/sources/${id}/entitlements`, { field: source.entitlements.field, users });
      if (res2.status === 200) {
        announce("Entitlements saved.");
        btn.closest("tr")?.remove();
      }
    });
  }

  // Schedule
  document.getElementById("save-schedule")!.addEventListener("click", async () => {
    const every = Number((document.getElementById("every-minutes") as HTMLInputElement).value);
    const kind = (document.getElementById("refresh-kind") as HTMLSelectElement).value.toLowerCase();
    const key = (document.getElementById("refresh-key") as HTMLSelectElement).value;
    const res2 = await api("PUT", `/api/sources/${id}/schedule`, { every_minutes: every, kind, key: kind === "incremental" ? key : null });
    if (res2.status === 200) {
      announce("Schedule saved.");
      location.reload();
    } else {
      const errors = (res2.json as { errors?: Record<string, string> } | null)?.errors;
      announce(errors?.every_minutes ?? errors?.key ?? "You do not have access to this.");
    }
  });
  document.getElementById("refresh-now")!.addEventListener("click", async () => {
    const res2 = await api<{ state: string }>("POST", `/api/sources/${id}/refresh`);
    if (res2.status === 200) {
      announce(res2.json!.state === "live" ? "Refresh finished." : "Refresh failed.");
      location.reload();
    } else {
      announce("You do not have access to this.");
    }
  });
}
