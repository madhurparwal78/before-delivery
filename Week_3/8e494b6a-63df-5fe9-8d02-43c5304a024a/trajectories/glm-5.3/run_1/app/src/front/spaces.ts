/**
 * Spaces, members and saved searches with the copy dialog.
 */
import { addLiveHandler, api, ApiFail, displayIso, showNotice } from "./api";
import { namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";

interface SavedSearch {
  id: string;
  name: string;
  stream: string;
  q: string;
  needs_attention: boolean;
  problem?: string;
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function buildSpaces(view: HTMLElement): void {
  const wrap = h("div", {});
  const spacesTable = h("table", {});
  spacesTable.setAttribute("aria-label", "Spaces");
  const membersTable = h("table", {});
  membersTable.setAttribute("aria-label", "Members");
  const savedList = h("div", { role: "list", "aria-label": "Saved searches" });
  const copiedStatus = h("div", { role: "status", "aria-label": "Copied" });

  const newSpace = h("button", { class: "btn-main" }, "New space");
  newSpace.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "New space"));
        const name = document.createElement("input");
        name.className = "input";
        name.setAttribute("aria-label", "Space name");
        const slug = document.createElement("input");
        slug.className = "input mono";
        slug.setAttribute("aria-label", "Space slug");
        const create = h("button", { class: "btn-main" }, "Create space");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        create.addEventListener("click", async () => {
          create.setAttribute("aria-busy", "true");
          try {
            await api("/api/spaces", {
              method: "POST",
              body: JSON.stringify({ slug: slug.value, name: name.value }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Space ${name.value} created.`);
            close();
            void load();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            create.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(create, cancel);
        box.append(name, slug, row);
        return box;
      },
      newSpace,
      "New space",
    );
  });

  const addMember = h("button", { class: "btn" }, "Add member");
  addMember.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Add member"));
        const username = document.createElement("input");
        username.className = "input mono";
        username.setAttribute("aria-label", "Member username");
        const role = h("select", { class: "input", "aria-label": "Role" }) as HTMLSelectElement;
        for (const r of ["viewer", "editor", "admin"]) {
          role.append(Object.assign(document.createElement("option"), { value: r, textContent: r }));
        }
        const add = h("button", { class: "btn-main" }, "Add");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        add.addEventListener("click", async () => {
          add.setAttribute("aria-busy", "true");
          try {
            const res = await api<{ username: string; role: string }>("/api/spaces/current/members", {
              method: "POST",
              body: JSON.stringify({ username: username.value, role: role.value }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`${res.username} added as ${res.role}.`);
            close();
            void load();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            add.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(add, cancel);
        box.append(username, role, row);
        return box;
      },
      addMember,
      "Add member",
    );
  });

  wrap.append(
    h("div", { style: { margin: "10px 0", display: "flex", gap: "10px" } }, newSpace, addMember),
    h("h3", {}, "Spaces"),
    spacesTable,
    h("h3", {}, "Members"),
    membersTable,
    h("h3", {}, "Saved searches"),
    savedList,
    copiedStatus,
  );
  view.append(wrap);

  async function load(): Promise<void> {
    try {
      const res = await api<{ spaces: { slug: string; name: string; role: string }[] }>("/api/spaces");
      spacesTable.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Slug", "Name", "Role"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const sp of res.spaces) {
        tbody.append(h("tr", {}, h("td", { class: "mono" }, sp.slug), h("td", {}, sp.name), h("td", {}, sp.role)));
      }
      spacesTable.append(thead, tbody);
    } catch {
      spacesTable.replaceChildren();
    }
    try {
      const res = await api<{ spaces: { slug: string; name: string; role: string }[] }>("/api/spaces");
      membersTable.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Slug", "Name", "Role"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const sp of res.spaces) {
        tbody.append(h("tr", {}, h("td", { class: "mono" }, sp.slug), h("td", {}, sp.name), h("td", {}, sp.role)));
      }
      membersTable.append(thead, tbody);
    } catch {
      membersTable.replaceChildren();
    }
    try {
      const res = await api<{ saved_searches: SavedSearch[] }>("/api/saved-searches");
      savedList.replaceChildren();
      for (const s of res.saved_searches) {
        const item = h("div", { role: "listitem", class: "card", style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } });
        const link = document.createElement("a");
        link.href = "#";
        link.textContent = s.name;
        link.addEventListener("click", (e) => {
          e.preventDefault();
          void openSavedSearch(s);
        });
        item.append(link);
        if (s.needs_attention) {
          item.append(Object.assign(document.createElement("span"), { textContent: "Needs attention", className: "mono", style: { color: "var(--warning)" } }));
        }
        const copy = h("button", { class: "btn" }, "Copy to space");
        copy.addEventListener("click", () => openCopyDialog(s, copy));
        item.append(copy);
        savedList.append(item);
      }
    } catch {
      savedList.replaceChildren();
    }
  }

  async function openSavedSearch(s: SavedSearch): Promise<void> {
    try {
      const detail = await api<{ stream: string; q: string; from: string; to: string; problem?: string }>(
        `/api/saved-searches/${s.id}`,
      );
      if (detail.problem) {
        const alert = namedAlert("Saved search error", detail.problem);
        wrap.prepend(alert);
        return;
      }
      const params = new URLSearchParams();
      params.set("stream", detail.stream);
      params.set("from", detail.from);
      params.set("to", detail.to);
      goTo(`/explore?${params.toString()}`);
    } catch (err) {
      if (err instanceof ApiFail) showNotice(err.body.message);
    }
  }

  function openCopyDialog(s: SavedSearch, opener: HTMLElement): void {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Copy to space"));
        const combo = h("select", { class: "input", "aria-label": "Target space" }) as HTMLSelectElement;
        void (async () => {
          const res = await api<{ spaces: { slug: string }[] }>("/api/spaces");
          for (const sp of res.spaces) {
            combo.append(Object.assign(document.createElement("option"), { value: sp.slug, textContent: sp.slug }));
          }
        })();
        const copyBtn = h("button", { class: "btn-main" }, "Copy");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        copyBtn.addEventListener("click", async () => {
          copyBtn.setAttribute("aria-busy", "true");
          try {
            const res = await api<{ message: string }>(`/api/saved-searches/${s.id}/copy`, {
              method: "POST",
              body: JSON.stringify({ space: combo.value }),
              headers: { "Content-Type": "application/json" },
            });
            copiedStatus.textContent = res.message;
            showNotice(res.message);
            close();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            copyBtn.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(copyBtn, cancel);
        box.append(combo, row);
        return box;
      },
      opener,
      "Copy to space",
    );
  }

  void load();
}
