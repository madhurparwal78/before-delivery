import { h, api, busy, showApiError, modalTrap, closeModal, announce, toast, pinCountText } from "./core";

// ---------- Dialogs, sheets and menus (DP-80) ----------
// Every dialog is a centred panel at 600px+, a bottom sheet below that.

export interface Dialog {
  el: HTMLElement;
  opener: HTMLElement | null;
  close: () => void;
}

export function openDialog(label: string, opener: HTMLElement | null, inner: (close: () => void) => HTMLElement): Dialog {
  const overlay = h("div", { class: "dialog-overlay" });
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-label": label, tabindex: "-1" });
  overlay.appendChild(dialog);
  const close = () => {
    closeModal(dialog, handler, opener);
    overlay.remove();
    document.body.classList.remove("modal-open");
  };
  const handler = modalTrap(dialog, close);
  dialog.appendChild(inner(close));
  // Outside click closes on click, not mousedown, so a touch that opened the
  // sheet does not immediately close it with the synthesised mouse events.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");
  const first = dialog.querySelector<HTMLElement>("input, button, select, textarea, a[href]");
  if (first) first.focus();
  else dialog.focus();
  return { el: dialog, opener, close };
}

// ---------- Save dialog (DP-31) ----------

export interface SaveResult { boardId: number; boardName: string }

export function openSaveDialog(pinId: number, opener: HTMLElement | null, onSaved: (result: SaveResult) => void): void {
  openDialog("Save to board", opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const search = h("input", { class: "field", type: "search", "aria-label": "Find a board", placeholder: "Find a board" }) as HTMLInputElement;
    const listboxId = "save-boards";
    const listbox = h("div", { class: "options", role: "listbox", id: listboxId, "aria-label": "Boards" });
    const createButton = h("button", { class: "btn ghost", text: "Create board" });
    let boards: Array<{ id: number; name: string; visibility: string; pin_count: number }> = [];
    let activeIndex = -1;

    const render = () => {
      const needle = search.value.trim().toLowerCase();
      const filtered = needle === ""
        ? boards
        : boards.filter(b => b.name.toLowerCase().split(/\s+/).some(w => w.startsWith(needle)));
      listbox.textContent = "";
      filtered.forEach((b) => {
        const option = h("div", {
          class: "option",
          role: "option",
          "aria-label": b.name,
          tabindex: "-1",
          onclick: () => saveTo(b),
        }, h("span", { text: b.name }), h("span", { class: "meta", text: pinCountText(b.pin_count) }));
        listbox.appendChild(option);
      });
      activeIndex = -1;
    };

    const saveTo = async (b: { id: number; name: string }) => {
      try {
        await api(`/api/pins/${pinId}/saves`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ board: b.id, section: null }),
        });
        announce(`Saved to ${b.name}`);
        toast(`Saved to ${b.name}`);
        onSaved({ boardId: b.id, boardName: b.name });
        close();
      } catch (e) {
        showApiError(e);
      }
    };

    search.addEventListener("input", render);
    search.addEventListener("keydown", (e) => {
      const options = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (options.length > 0) {
          activeIndex = Math.min(activeIndex + 1, options.length - 1);
          options[activeIndex]!.classList.add("active");
          options.forEach((o, i) => o.classList.toggle("active", i === activeIndex));
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        options.forEach((o, i) => o.classList.toggle("active", i === activeIndex));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0) {
          const b = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"))[activeIndex];
          const target = boards.find(x => x.name === b?.getAttribute("aria-label"));
          if (target) saveTo(target);
          return;
        }
        const options2 = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"));
        if (options2.length > 0 && activeIndex === -1) {
          // Enter with no active option behaves as usual (moves through the form).
          return;
        }
      }
    });
    // ArrowDown moves into the list; Enter saves to the focused board.
    listbox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const b = (e.target as HTMLElement).getAttribute("aria-label");
        const target = boards.find(x => x.name === b);
        if (target) saveTo(target);
      }
    });
    createButton.addEventListener("click", () => {
      close();
      openCreateBoardDialog(opener, async (board) => {
        boards.unshift(board);
        // After the board is created the save dialog comes back with the new board's option focused.
        openSaveDialog(pinId, opener, onSaved);
      });
    });

    wrap.append(
      h("div", { class: "dialog-head" }, h("h2", { text: "Save to board" })),
      search, listbox, h("div", { class: "dialog-actions" }, createButton),
    );
    void (async () => {
      try {
        const data = await api("/api/boards/mine") as { boards: typeof boards };
        boards = data.boards;
        render();
        search.focus();
      } catch (e) { showApiError(e); }
    })();
    return wrap;
  });
}

// ---------- Create board dialog ----------

export function openCreateBoardDialog(opener: HTMLElement | null, onCreated: (board: { id: number; name: string; visibility: string; pin_count: number }) => void): void {
  openDialog("Create board", opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const name = h("input", { class: "field", type: "text", "aria-label": "Name", placeholder: "Name" }) as HTMLInputElement;
    const radioPublic = h("input", { type: "radio", name: "visibility", value: "public" }) as HTMLInputElement;
    radioPublic.checked = true;
    const radioSecret = h("input", { type: "radio", name: "visibility", value: "secret" }) as HTMLInputElement;
    const create = h<HTMLButtonElement>("button", { class: "btn primary", text: "Create" });
    const error = h("div", { class: "field-error", role: "alert" });
    const visibilityGroup = h("div", {
      class: "radio-row",
      role: "radiogroup",
      "aria-label": "Visibility",
    },
      h("label", { class: "radio" }, radioPublic, "Public"),
      h("label", { class: "radio" }, radioSecret, "Secret"),
    );
    create.addEventListener("click", async () => {
      const visibility = radioSecret.checked ? "secret" : "public";
      const ok = await busy(create, "Creating", async () => {
        const board = await api("/api/boards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.value, visibility }),
        }) as { id: number; name: string; visibility: string };
        onCreated({ id: board.id, name: board.name, visibility: board.visibility, pin_count: 0 });
        close();
      });
      void ok;
    });
    wrap.append(
      h("div", { class: "dialog-head" }, h("h2", { text: "Create board" })),
      name, visibilityGroup, error, h("div", { class: "dialog-actions" }, create),
    );
    name.addEventListener("input", () => { error.textContent = ""; });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); create.click(); }
    });
    window.setTimeout(() => name.focus(), 0);
    return wrap;
  });
}

// ---------- Invite dialog (DP-54) ----------

export function openInviteDialog(boardId: number, opener: HTMLElement | null): void {
  openDialog("Invite collaborators", opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const email = h("input", { class: "field", type: "email", "aria-label": "Email", placeholder: "Email" }) as HTMLInputElement;
    const editor = h("input", { type: "radio", name: "invite-role", value: "editor", id: "role-editor" }) as HTMLInputElement;
    editor.checked = true;
    const viewer = h("input", { type: "radio", name: "invite-role", value: "viewer", id: "role-viewer" }) as HTMLInputElement;
    const send = h<HTMLButtonElement>("button", { class: "btn primary", text: "Send invite" });
    const error = h("div", { class: "field-error", role: "alert" });
    send.addEventListener("click", async () => {
      const role = viewer.checked ? "viewer" : "editor";
      const ok = await busy(send, "Sending", async () => {
        await api(`/api/boards/${boardId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.value, role }),
        });
        announce(`Invite sent to ${email.value}`);
        toast(`Invite sent to ${email.value}`);
        close();
      });
      void ok;
    });
    wrap.append(
      h("div", { class: "dialog-head" }, h("h2", { text: "Invite collaborators" })),
      email,
      h("div", { class: "radio-row", role: "radiogroup", "aria-label": "Role" },
        h("label", { class: "radio", for: "role-editor" }, editor, "Editor"),
        h("label", { class: "radio", for: "role-viewer" }, viewer, "Viewer"),
      ),
      error,
      h("div", { class: "dialog-actions" }, send),
    );
    email.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send.click(); } });
    window.setTimeout(() => email.focus(), 0);
    return wrap;
  });
}

// ---------- Collaborators dialog (DP-57) ----------

export function openCollaboratorsDialog(boardId: number, opener: HTMLElement | null, myRole: string | null, myUserId: number, onLeave: () => void): void {
  openDialog("Collaborators", opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const list = h("div", { class: "rows" });
    const render = async () => {
      list.textContent = "";
      const data = await api(`/api/boards/${boardId}/members`) as {
        owner: { id: number; name: string; handle: string };
        members: Array<{ user: { id: number; name: string; handle: string }; role: string }>;
        invites: Array<{ id: number; email: string; role: string; expires_at: string }>;
      };
      const ownerRow = h("div", { class: "row" },
        h("span", { text: data.owner.name }),
        h("span", { class: "meta", text: "Owner" }),
      );
      list.appendChild(ownerRow);
      for (const m of data.members) {
        const row = h("div", { class: "row" });
        row.appendChild(h("span", { text: m.user.name }));
        if (myRole === "owner") {
          const select = h("select", { class: "field slim", "aria-label": `Role for ${m.user.name}` }) as HTMLSelectElement;
          for (const role of ["editor", "viewer"]) {
            const option = h("option", { value: role, text: role === "editor" ? "Editor" : "Viewer" });
            if (m.role === role) (option as HTMLOptionElement).selected = true;
            select.appendChild(option);
          }
          select.addEventListener("change", async () => {
            try {
              await api(`/api/boards/${boardId}/members/${m.user.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: select.value }),
              });
              announce(`${m.user.name} is now a ${select.value}`);
              void render();
            } catch (e) { showApiError(e); }
          });
          const remove = h("button", { class: "btn ghost", text: `Remove ${m.user.name}` });
          remove.addEventListener("click", async () => {
            try {
              await api(`/api/boards/${boardId}/members/${m.user.id}`, { method: "DELETE" });
              announce(`${m.user.name} was removed`);
              void render();
            } catch (e) { showApiError(e); }
          });
          row.append(select, remove);
        } else {
          row.appendChild(h("span", { class: "meta", text: m.role === "editor" ? "Editor" : "Viewer" }));
        }
        if (m.user.id === myUserId && myRole !== "owner") {
          const leave = h<HTMLButtonElement>("button", { class: "btn ghost", text: "Leave board" });
          leave.addEventListener("click", async () => {
            const ok = await busy(leave, "Leaving", async () => {
              await api(`/api/boards/${boardId}/members/${myUserId}`, { method: "DELETE" });
              announce(`You left the board`);
              close();
              onLeave();
            });
            void ok;
          });
          row.appendChild(leave);
        }
        list.appendChild(row);
      }
      if (myRole === "owner") {
        for (const i of data.invites) {
          const row = h("div", { class: "row" });
          row.appendChild(h("span", { text: i.email }));
          row.appendChild(h("span", { class: "meta", text: i.role === "editor" ? "Editor" : "Viewer" }));
          const withdraw = h("button", { class: "btn ghost", text: `Withdraw invite to ${i.email}` });
          withdraw.addEventListener("click", async () => {
            try {
              await api(`/api/invites/${i.id}`, { method: "DELETE" });
              void render();
            } catch (e) { showApiError(e); }
          });
          row.appendChild(withdraw);
          list.appendChild(row);
        }
      }
    };
    wrap.append(h("div", { class: "dialog-head" }, h("h2", { text: "Collaborators" })), list);
    void render();
    return wrap;
  });
}

// ---------- Move and copy dialogs (DP-39) ----------

export function openMoveCopyDialog(kind: "move" | "copy", count: number, excludeBoardId: number | null, opener: HTMLElement | null, onDone: (boardId: number, sectionId: number | null, boardName: string) => void): void {
  const title = kind === "move" ? (count === 1 ? "Move 1 pin" : `Move ${count} pins`) : (count === 1 ? "Copy 1 pin" : `Copy ${count} pins`);
  openDialog(title, opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const listbox = h("div", { class: "options", role: "listbox", "aria-label": "Boards" });
    const action = h<HTMLButtonElement>("button", { class: "btn primary", text: kind === "move" ? "Move here" : "Copy here" });
    let selected: { id: number; name: string } | null = null;
    let boards: Array<{ id: number; name: string }> = [];
    const render = () => {
      listbox.textContent = "";
      const visible = boards.filter(b => b.id !== excludeBoardId);
      for (const b of visible) {
        const option = h("div", {
          class: "option",
          role: "option",
          "aria-label": b.name,
          tabindex: "0",
          onclick: () => { selected = b; action.click(); },
          onkeydown: (e: Event) => {
            if ((e as KeyboardEvent).key === "Enter") { selected = b; action.click(); }
          },
        }, h("span", { text: b.name }));
        listbox.appendChild(option);
      }
      // Focus the first option of the list (Interactions).
      const first = listbox.querySelector<HTMLElement>("[role=option]");
      if (first) first.focus();
    };
    action.addEventListener("click", async () => {
      if (!selected) return;
      const done = await busy(action, kind === "move" ? "Moving" : "Copying", async () => {
        onDone(selected!.id, null, selected!.name);
        close();
      });
      void done;
    });
    wrap.append(h("div", { class: "dialog-head" }, h("h2", { text: title })), listbox, h("div", { class: "dialog-actions" }, action));
    void (async () => {
      const data = await api("/api/boards/mine") as { boards: Array<{ id: number; name: string }> };
      boards = data.boards;
      render();
    })();
    return wrap;
  });
}
