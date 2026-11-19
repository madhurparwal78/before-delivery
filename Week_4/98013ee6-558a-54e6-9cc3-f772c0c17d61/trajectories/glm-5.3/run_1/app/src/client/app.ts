import {
  h, api, apiJson, announce, busy, clearAlert, closeModal, detectMotion, errorAlert,
  failureText, modalTrap, parseRoute, relativeTime, setBusinessNow, showApiError,
  state, timeElement, toast, undoDone, operationExpired, ApiFailure,
  pinCountText, followerText, followingText, saveText, commentText, reactionText,
} from "./core";
import type { PinJson, BoardJson, AppConfig, Me } from "./core";
import { PinGrid, lampCarry } from "./grid";
import { live, connectLive } from "./live";
import {
  openDialog, openSaveDialog, openCreateBoardDialog, openInviteDialog,
  openCollaboratorsDialog, openMoveCopyDialog,
} from "./dialogs";

// ---------- App shell (DP-78) ----------
// Every signed-in screen: top bar (wordmark, Primary nav, Search), exactly one main.
// Below 600px: Primary is replaced by Tabs fixed at the bottom.

let mainEl: HTMLElement;

export function shell(me: Me | null): void {
  document.body.textContent = "";
  const root = h("div", { class: "app" });
  const topbar = h("header", { class: "topbar" });
  topbar.appendChild(h("a", { class: "wordmark", href: "/", text: "MOTHLIGHT" }));
  if (me) {
    const nav = h("nav", { class: "primary", "aria-label": "Primary" },
      navLink("Home", "/"),
      navLink("Search", "/search"),
      navLink("Create", "/create"),
      navLink("Boards", "/boards"),
      navLink("Profile", `/u/${me.handle}`),
    );
    topbar.appendChild(nav);
    const tabs = h("nav", { class: "tabs", "aria-label": "Tabs" },
      navLink("Home", "/"),
      navLink("Search", "/search"),
      navLink("Create", "/create"),
      navLink("Boards", "/boards"),
      navLink("Profile", `/u/${me.handle}`),
    );
    const search = h("form", { class: "topbar-search", onsubmit: (e: Event) => {
      e.preventDefault();
      const value = (document.querySelector<HTMLInputElement>('[role="searchbox"] input, input[aria-label="Search pins"]')?.value ?? "").trim();
      location.assign(`/search?q=${encodeURIComponent(value)}`);
    } });
    const searchbox = h("div", { class: "searchbox", role: "searchbox", "aria-label": "Search pins" },
      h("input", { class: "field", type: "search", "aria-label": "Search pins", placeholder: "Search pins" }),
    );
    search.appendChild(searchbox);
    topbar.appendChild(search);

    const menu = h("div", { class: "menu" });
    const menuButton = h("button", { class: "btn ghost", "aria-haspopup": "menu", text: me.name });
    const dropdown = h("div", { class: "dropdown", role: "menu", hidden: "true" },
      h("a", { class: "menu-item", role: "menuitem", href: `/u/${me.handle}`, text: me.name }),
      h("button", { class: "menu-item", role: "menuitem", text: "Sign out", onclick: async () => {
        await api("/api/session", { method: "DELETE" });
        location.assign("/");
      } }),
    );
    menuButton.addEventListener("click", () => {
      const open = dropdown.hasAttribute("hidden");
      if (open) { dropdown.removeAttribute("hidden"); menuButton.focus(); } else dropdown.setAttribute("hidden", "true");
    });
    menu.append(menuButton, dropdown);
    topbar.appendChild(menu);
    root.append(topbar);
    root.appendChild(tabs);
  } else {
    root.append(topbar);
    topbar.appendChild(h("div", { class: "topbar-actions" },
      h("a", { class: "btn ghost", href: "/signin", text: "Sign in" }),
      h("a", { class: "btn primary", href: "/signup", text: "Sign up" }),
    ));
  }
  mainEl = h("main", { class: "main", id: "main" });
  root.appendChild(mainEl);
  // One polite live region and one alert for every screen (DP-79).
  root.appendChild(h("div", { class: "visually-hidden", role: "status", "aria-label": "Announcements" }));
  root.appendChild(h("div", { class: "toasts", role: "status", "aria-label": "Notices" }));
  root.appendChild(h("div", { class: "alert", id: "ml-alert", role: "alert", hidden: "true" }));
  document.body.appendChild(root);
  detectMotion();
}

function navLink(text: string, href: string): HTMLElement {
  const a = h("a", { class: "nav-link", href, text });
  return a;
}

// ---------- Exhibit view (Pin screen content) ----------

export interface Exhibit {
  overlay: HTMLElement;
  dialog: HTMLElement;
  img: HTMLImageElement;
  close: () => void;
  refresh: () => Promise<void>;
}


let currentExhibit: Exhibit | null = null;

export function openPinExhibit(pin: PinJson, fromCard: HTMLElement | null, onSavedCount: (n: number) => void, onClose: () => void): Exhibit {
  // Only one exhibit is open at a time; opening a pin closes the previous one.
  if (currentExhibit) currentExhibit.close();
  const overlay = h("div", { class: "exhibit-overlay" });
  const dialog = h("div", {
    class: "exhibit",
    role: "dialog",
    "aria-label": pin.title,
    tabindex: "-1",
  });
  const figure = h("div", { class: "exhibit-figure" });
  const img = h("img", { class: "exhibit-img", src: pin.image.original_url, alt: pin.alt }) as HTMLImageElement;
  figure.appendChild(img);
  const aside = h("div", { class: "exhibit-aside" });
  const imgWrap = h("div", { class: "exhibit-figure-wrap" }, figure);

  const ids = {
    saves: `saves-${pin.id}`,
    comments: `comments-${pin.id}`,
    reactions: `reactions-${pin.id}`,
  };
  const title = h("h1", { class: "exhibit-title", text: pin.title });
  const description = pin.description ? h("p", { class: "exhibit-desc", text: pin.description }) : null;
  const tags = h("div", { class: "tags" });
  for (const tag of pin.tags) {
    tags.appendChild(h("a", { class: "tag", href: `/search?tag=${encodeURIComponent(tag)}`, text: `#${tag}` }));
  }
  const source = pin.source_host
    ? h("a", { class: "source link", href: pin.source!, text: pin.source_host })
    : null;
  const credit = creditElement(pin);
  const alt = h("p", { class: "exhibit-alt", text: pin.alt });
  const countsRow = h("div", { class: "counts" });
  const savesCount = h("span", { class: "meta", id: ids.saves, text: saveText(pin.saves) });
  const commentsCount = h("span", { class: "meta", id: ids.comments, text: commentText(pin.comments) });
  const reactionsCount = h("span", { class: "meta", id: ids.reactions, text: reactionText(pin.reactions) });
  countsRow.append(savesCount, commentsCount, reactionsCount);

  const actions = h("div", { class: "exhibit-actions" });
  const reactButton = h("button", { class: "btn ghost", text: "React", onclick: () => {
    openReactionsMenu(pin, reactButton, (mine) => {
      if (mine === null) {
        pin.my_reaction = null;
      } else {
        pin.my_reaction = mine;
      }
      void refreshCounts();
    });
  } });
  const saveButton = h("button", { class: "btn primary", text: "Save", onclick: () => {
    openSaveDialog(pin.id, saveButton, () => { void refreshCounts(); });
  } });
  actions.append(reactButton, saveButton);
  const closeBtn = h("button", { class: "btn ghost exhibit-close", text: "Close" });

  const commentsWrap = h("div", { class: "comments" });
  const sectionAside = h("div", { class: "exhibit-aside-inner" });

  // Pin owner controls.
  const controls = h("div", { class: "exhibit-controls" });
  if (state.me && pin.owner.id === state.me.id) {
    const edit = h("button", { class: "btn ghost", text: "Edit pin", onclick: () => openEditPinDialog(pin, dialog, async () => { await build(); }) });
    controls.appendChild(edit);
  }

  aside.append(
    ...(description ? [description] : []),
    tags,
    ...(source ? [source] : []),
    ...(credit ? [credit] : []),
    alt,
    countsRow,
    controls,
    actions,
    commentsWrap,
  );

  const inner = h("div", { class: "exhibit-grid" }, imgWrap, aside);
  dialog.appendChild(closeBtn);
  dialog.appendChild(inner);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");

  let comments: Array<CommentJson> = [];
  let commentCount = 0;

  async function loadComments(): Promise<void> {
    const data = await apiJson<{ count: number; comments: CommentJson[] }>(`/api/pins/${pin.id}/comments`);
    comments = data.comments;
    commentCount = data.count;
    renderComments();
    commentsCount.textContent = commentText(commentCount);
  }

  function renderComments(): void {
    commentsWrap.textContent = "";
    const commentBox = h("div", { class: "comment-box" });
    const input = h("input", { class: "field", type: "text", "aria-label": "Add a comment", placeholder: "Add a comment", maxlength: String(state.config?.limits.comment_max ?? 500) }) as HTMLInputElement;
    const counter = h("span", { class: "counter meta", text: `0 / ${state.config?.limits.comment_max ?? 500}` });
    const post = h<HTMLButtonElement>("button", { class: "btn ghost", text: "Post" });
    const update = () => {
      const max = state.config?.limits.comment_max ?? 500;
      const used = [...input.value].length;
      counter.textContent = used > max ? `${used - max} over the limit` : `${used} / ${max}`;
      post.disabled = used > max || used === 0;
    };
    input.addEventListener("input", update);
    post.addEventListener("click", async () => {
      const ok = await busy(post, "Posting", async () => {
        await api(`/api/pins/${pin.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: input.value, parent: null }),
        });
        input.value = "";
        update();
        await loadComments();
      });
      void ok;
    });
    commentBox.append(input, counter, post);
    commentsWrap.appendChild(commentBox);
    for (const c of comments) {
      commentsWrap.appendChild(commentNode(c, false));
      for (const r of c.replies ?? []) {
        commentsWrap.appendChild(commentNode(r, true));
      }
    }
  }

  function commentNode(c: CommentJson, isReply: boolean): HTMLElement {
    const node = h("div", { class: "comment" + (isReply ? " reply" : "") });
    const head = h("div", { class: "comment-head" });
    head.appendChild(h("a", { class: "link", href: `/u/${c.author.handle}`, text: c.author.name }));
    head.appendChild(timeElement(c.created_at));
    const body = c.deleted
      ? h("p", { class: "comment-text meta", text: "This comment was deleted." })
      : h("p", { class: "comment-text", text: c.text ?? "" });
    const actions = h("div", { class: "comment-actions" });
    if (state.me) {
      const reply = h("button", { class: "link", text: `Reply to ${c.author.name}` });
      reply.addEventListener("click", () => {
        const existing = commentsWrap.querySelector(`[data-reply-for="${c.id}"]`);
        if (existing) { (existing.querySelector("input") as HTMLInputElement).focus(); return; }
        const box = h("div", { class: "comment-box", "data-reply-for": String(c.id) });
        const input = h("input", { class: "field", type: "text", "aria-label": `Reply to ${c.author.name}`, placeholder: `Reply to ${c.author.name}`, maxlength: String(state.config?.limits.comment_max ?? 500) }) as HTMLInputElement;
        const counter = h("span", { class: "counter meta", text: `0 / ${state.config?.limits.comment_max ?? 500}` });
        const send = h<HTMLButtonElement>("button", { class: "btn ghost", text: "Post reply" });
        const update = () => {
          const max = state.config?.limits.comment_max ?? 500;
          const used = [...input.value].length;
          counter.textContent = used > max ? `${used - max} over the limit` : `${used} / ${max}`;
          send.disabled = used > max || used === 0;
        };
        input.addEventListener("input", update);
        send.addEventListener("click", async () => {
          const ok = await busy(send, "Posting", async () => {
            await api(`/api/pins/${pin.id}/comments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: input.value, parent: c.id }),
            });
            await loadComments();
          });
          void ok;
        });
        box.append(input, counter, send);
        node.after(box);
        input.focus();
      });
      actions.appendChild(reply);
      const isAuthor = state.me.id === c.author.id;
      const isPinOwner = state.me.id === pin.owner.id;
      if (!c.deleted && (isAuthor || isPinOwner)) {
        const del = h("button", { class: "link", text: "Delete comment" });
        del.addEventListener("click", async () => {
          try {
            await api(`/api/comments/${c.id}`, { method: "DELETE" });
            await loadComments();
          } catch (e) { showApiError(e); }
        });
        actions.appendChild(del);
      }
    }
    node.append(head, body, actions);
    return node;
  }

  async function refreshCounts(): Promise<void> {
    const fresh = await apiJson<PinJson>(`/api/pins/${pin.id}`);
    pin.saves = fresh.saves;
    pin.comments = fresh.comments;
    pin.reactions = fresh.reactions;
    pin.my_reaction = fresh.my_reaction;
    pin.saved_from = fresh.saved_from;
    savesCount.textContent = saveText(pin.saves);
    commentsCount.textContent = commentText(pin.comments);
    reactionsCount.textContent = reactionText(pin.reactions);
    onSavedCount(pin.saves);
    const newCredit = creditElement(pin);
    if (credit && newCredit) {
      credit.replaceWith(newCredit);
    }
  }

  async function build(): Promise<void> {
    const fresh = await apiJson<PinJson>(`/api/pins/${pin.id}`);
    title.textContent = fresh.title;
    img.src = fresh.image.original_url;
    img.alt = fresh.alt;
    alt.textContent = fresh.alt;
    description?.remove();
    if (fresh.description) {
      const descEl = h("p", { class: "exhibit-desc", text: fresh.description });
      sectionAside.prepend(descEl);
    }
    pin.tags = fresh.tags;
    tags.textContent = "";
    for (const tag of fresh.tags) {
      tags.appendChild(h("a", { class: "tag", href: `/search?tag=${encodeURIComponent(tag)}`, text: `#${tag}` }));
    }
  }

  const trapClose = modalTrap(dialog, () => close());
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  function close(): void {
    if (currentExhibit === exhibit) currentExhibit = null;
    closeModal(dialog, trapClose, null);
    overlay.remove();
    document.body.classList.remove("modal-open");
    onClose();
  }

  const exhibit: Exhibit = {
    overlay, dialog, img,
    close,
    refresh: refreshCounts,
  };
  currentExhibit = exhibit;

  void loadComments();
  closeBtn.focus();
  // Lamp-carry: the image travels from the grid rectangle to the exhibit rectangle (DP-75).
  if (fromCard) {
    const gridImgs = Array.from(document.querySelectorAll<HTMLElement>(".card"));
    lampCarry(fromCard, img, gridImgs, state.motion === "full");
  }
  live.watch(undefined, pin.id);
  const handler = (msg: Record<string, unknown>) => {
    if (msg.type === "counts" && msg.pin_id === pin.id) {
      pin.saves = msg.saves as number;
      pin.comments = msg.comments as number;
      pin.reactions = msg.reactions as number;
      savesCount.textContent = saveText(pin.saves);
      commentsCount.textContent = commentText(pin.comments);
      reactionsCount.textContent = reactionText(pin.reactions);
      onSavedCount(pin.saves);
    }
    if (msg.type === "pin_changed" && msg.pin_id === pin.id) {
      void build();
      void refreshCounts();
    }
  };
  live.on(handler);
  return exhibit;
}

interface CommentJson {
  id: number;
  author: { id: number; name: string; handle: string };
  text: string | null;
  deleted: boolean;
  created_at: string;
  replies?: CommentJson[];
}

function creditElement(pin: PinJson): HTMLElement | null {
  if (!pin.saved_from) return h("span", { class: "meta credit-line", text: pin.owner.name });
  if (pin.saved_from.removed) {
    return h("span", { class: "meta credit-line", text: `Saved from ${pin.saved_from.user_name} · Original removed` });
  }
  if (pin.saved_from.pin_id === null) {
    return h("span", { class: "meta credit-line", text: `Saved from ${pin.saved_from.user_name}` });
  }
  return h("a", { class: "credit-line link", href: `/pin/${pin.saved_from.pin_id}`, text: `Saved from ${pin.saved_from.user_name}` });
}

function openReactionsMenu(pin: PinJson, opener: HTMLElement, onChange: (mine: string | null) => void): void {
  const options = [
    { type: "love", label: "Love" },
    { type: "idea", label: "Idea" },
    { type: "wow", label: "Wow" },
    { type: "thanks", label: "Thanks" },
  ];
  const menu = h("div", { class: "menu-pop", role: "menu", "aria-label": "Reactions" });
  let focusIndex = options.findIndex(o => o.type === pin.my_reaction);
  if (focusIndex === -1) focusIndex = 0;
  const items = options.map((o, i) => {
    const item = h("div", {
      class: "menu-pop-item",
      role: "menuitemradio",
      "aria-label": o.label,
      tabindex: "-1",
      onclick: async () => {
        try {
          const result = await api(`/api/pins/${pin.id}/reaction`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: o.type }),
          }) as { mine: string | null; reactions: number };
          onChange(result.mine);
          close();
        } catch (e) { showApiError(e); }
      },
    }, h("span", { text: o.label }));
    if (pin.my_reaction === o.type) item.setAttribute("aria-checked", "true");
    else item.setAttribute("aria-checked", "false");
    menu.appendChild(item);
    void i;
    return item;
  });
  const close = () => {
    menu.remove();
    opener.focus();
  };
  const trap = modalTrap(menu, close);
  menu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex = e.key === "ArrowDown" ? (focusIndex + 1) % items.length : (focusIndex - 1 + items.length) % items.length;
      items[focusIndex]!.focus();
    }
  });
  document.body.appendChild(menu);
  const rect = opener.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = (rect.bottom + 8) + "px";
  menu.style.left = Math.max(16, rect.left) + "px";
  items[focusIndex]!.focus();
  void trap;
}

function openEditPinDialog(pin: PinJson, opener: HTMLElement, onSaved: () => Promise<void>): void {
  openDialog("Edit pin", opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const title = h("input", { class: "field", type: "text", "aria-label": "Title", value: pin.title }) as HTMLInputElement;
    const description = h("textarea", { class: "field", "aria-label": "Description" }) as HTMLTextAreaElement;
    description.value = pin.description;
    const alt = h("input", { class: "field", type: "text", "aria-label": "Alt text", value: pin.alt }) as HTMLInputElement;
    const source = h("input", { class: "field", type: "url", "aria-label": "Source link", value: pin.source ?? "" }) as HTMLInputElement;
    const save = h<HTMLButtonElement>("button", { class: "btn primary", text: "Save changes" });
    const del = h("button", { class: "btn ghost", text: "Delete pin" });
    const conflict = h("div", { class: "field-error", role: "alert" });
    save.addEventListener("click", async () => {
      try {
        save.disabled = true;
        save.textContent = "Saving";
        const updated = await api(`/api/pins/${pin.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: pin.version,
            title: title.value,
            description: description.value,
            alt: alt.value,
            source: source.value || null,
          }),
        }) as PinJson;
        pin.version = updated.version;
        announce("Pin updated");
        close();
        await onSaved();
      } catch (e) {
        // The conflict offer with Load latest (DP-68); field errors as for Publish.
        if (e instanceof ApiFailure && e.code === "version_conflict") {
          conflict.textContent = "";
          conflict.appendChild(h("span", { text: "This pin was changed somewhere else. " }));
          const load = h("button", { class: "link", text: "Load latest" });
          load.addEventListener("click", async () => {
            const fresh = await apiJson<PinJson>(`/api/pins/${pin.id}`);
            pin.version = fresh.version;
            title.value = fresh.title;
            description.value = fresh.description;
            alt.value = fresh.alt;
            source.value = fresh.source ?? "";
            conflict.textContent = "";
          });
          conflict.appendChild(load);
        } else {
          showApiError(e);
        }
      } finally {
        save.disabled = false;
        save.textContent = "Save changes";
      }
    });
    wrap.append(
      h("div", { class: "dialog-head" }, h("h2", { text: "Edit pin" })),
      title, description, alt, source,
      conflict,
      h("div", { class: "dialog-actions" }, save, del),
    );
    del.addEventListener("click", () => {
      close();
      openDeleteConfirm(pin, opener, onSaved);
    });
    return wrap;
  });
}

function openDeleteConfirm(pin: PinJson, opener: HTMLElement, onSaved: () => Promise<void>): void {
  openDialog(`Delete ${pin.title}?`, opener, close => {
    const wrap = h("div", { class: "dialog-body" });
    const confirm = h<HTMLButtonElement>("button", { class: "btn primary", text: "Delete pin" });
    const cancel = h("button", { class: "btn ghost", text: "Cancel" });
    confirm.addEventListener("click", async () => {
      const op = await busy(confirm, "Deleting", async () => {
        return api(`/api/pins/${pin.id}`, { method: "DELETE" }) as Promise<{ id: number; deadline: string }>;
      });
      if (op) {
        const text = "1 pin deleted · Undo";
        toast(text, { undo: { operationId: op.id, deadline: op.deadline, onUndo: async () => {
          try {
            await api(`/api/operations/${op.id}/undo`, { method: "POST" });
            announce("Undone");
            toast("Undone");
            undoDone(op.id);
            await onSaved();
          } catch (e) {
            const f = e as ApiFailure;
            errorAlert(failureText(f));
          }
        } } });
        announce(text);
        close();
      }
    });
    cancel.addEventListener("click", close);
    wrap.append(
      h("div", { class: "dialog-head" }, h("h2", { text: `Delete ${pin.title}?` })),
      h("div", { class: "dialog-actions" }, confirm, cancel),
    );
    return wrap;
  });
}

// ---------- Landing (DP-83) ----------

function renderLanding(): void {
  mainEl.textContent = "";
  const hero = h("div", { class: "landing" });
  const prints = h("div", { class: "hero-prints" });
  prints.appendChild(mothPrint());
  prints.appendChild(fernPrint());
  const words = h("div", { class: "hero-words" });
  const h1 = h("h1", { class: "hero-h1" });
  h1.appendChild(h("span", { text: "Keep what you find." }));
  h1.appendChild(h("span", { class: "hero-h1-line2", text: "Leave the rest in the dark." }));
  const sentence = h("p", { class: "hero-sentence", text: "Every pin keeps its source, its alt text and its credit." });
  words.append(h1, sentence);
  const actions = h("div", { class: "hero-actions" },
    h("a", { class: "btn primary", href: "/signin", text: "Save a pin" }),
    h("a", { class: "btn ghost", href: "/signin", text: "Sign in" }),
    h("a", { class: "btn ghost", href: "/signup", text: "Sign up" }),
  );
  const closing = h("p", { class: "hero-closing", text: "KEEP THE SOURCE. KEEP THE CREDIT." });
  hero.append(prints, words, actions, closing);
  mainEl.appendChild(hero);
}

/** The larger print: a moth on a lit window sash, bone lines on green-black, upright 4:5. */
function mothPrint(): HTMLElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 400 500");
  svg.setAttribute("class", "print print-moth");
  svg.setAttribute("aria-hidden", "true");
  const stroke = "#e8e2d2";
  const thin = "1.5";
  const lines: string[] = [];
  // The window sash: a lit rectangle with bars.
  lines.push(`<rect x="40" y="30" width="320" height="440" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<rect x="70" y="60" width="260" height="380" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<line x1="200" y1="60" x2="200" y2="440" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<line x1="70" y1="250" x2="330" y2="250" stroke="${stroke}" stroke-width="${thin}"/>`);
  // The moth, centred on the sash's lower-left pane.
  const cx = 152, cy = 338;
  lines.push(`<circle cx="${cx}" cy="${cy - 58}" r="6" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  // Antennae.
  lines.push(`<path d="M ${cx - 3} ${cy - 62} Q ${cx - 18} ${cy - 84} ${cx - 26} ${cy - 76}" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<path d="M ${cx + 3} ${cy - 62} Q ${cx + 18} ${cy - 84} ${cx + 26} ${cy - 76}" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  // Body.
  lines.push(`<line x1="${cx}" y1="${cy - 52}" x2="${cx}" y2="${cy + 24}" stroke="${stroke}" stroke-width="3"/>`);
  // Left wing.
  lines.push(`<path d="M ${cx - 2} ${cy - 44} C ${cx - 70} ${cy - 92}, ${cx - 96} ${cy - 20}, ${cx - 30} ${cy + 20} Z" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<path d="M ${cx - 2} ${cy - 30} C ${cx - 50} ${cy - 34}, ${cx - 66} ${cy + 6}, ${cx - 26} ${cy + 22}" fill="none" stroke="${stroke}" stroke-width="1"/>`);
  // Right wing.
  lines.push(`<path d="M ${cx + 2} ${cy - 44} C ${cx + 70} ${cy - 92}, ${cx + 96} ${cy - 20}, ${cx + 30} ${cy + 20} Z" fill="none" stroke="${stroke}" stroke-width="${thin}"/>`);
  lines.push(`<path d="M ${cx + 2} ${cy - 30} C ${cx + 50} ${cy - 34}, ${cx + 66} ${cy + 6}, ${cx + 26} ${cy + 22}" fill="none" stroke="${stroke}" stroke-width="1"/>`);
  svg.innerHTML = lines.join("");
  return svg as unknown as HTMLElement;
}

/** The smaller square print: a fern frond drawn the same way, dimmed to 70 percent. */
function fernPrint(): HTMLElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 300 300");
  svg.setAttribute("class", "print print-fern");
  svg.setAttribute("aria-hidden", "true");
  const stroke = "#e8e2d2";
  const lines: string[] = [];
  // The frond stem arcs up the square.
  lines.push(`<path d="M 60 250 Q 130 200 190 120 Q 210 90 220 60" fill="none" stroke="${stroke}" stroke-width="2"/>`);
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const x = 60 + t * 130;
    const y = 250 - t * 165;
    const len = 34 - t * 20;
    lines.push(`<path d="M ${x} ${y} Q ${x + len * 0.5} ${y - len * 0.6} ${x + len} ${y - len * 0.4}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`);
    lines.push(`<path d="M ${x} ${y} Q ${x - len * 0.5} ${y + len * 0.5} ${x - len} ${y + len * 0.6}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`);
  }
  svg.innerHTML = lines.join("");
  return svg as unknown as HTMLElement;
}

// ---------- Sign up and sign in (DP-05) ----------

function renderSignup(): void {
  mainEl.textContent = "";
  const column = h("div", { class: "auth" });
  const name = h("input", { class: "field", type: "text", "aria-label": "Name", placeholder: "Name" }) as HTMLInputElement;
  const email = h("input", { class: "field", type: "email", "aria-label": "Email", placeholder: "Email" }) as HTMLInputElement;
  const handle = h("input", { class: "field", type: "text", "aria-label": "Handle", placeholder: "Handle" }) as HTMLInputElement;
  const password = h("input", { class: "field", type: "password", "aria-label": "Password", placeholder: "Password" }) as HTMLInputElement;
  const create = h<HTMLButtonElement>("button", { class: "btn primary", text: "Create account" });
  const fieldError = h("div", { class: "field-error", role: "alert" });

  create.addEventListener("click", async () => {
    const ok = await busy(create, "Creating account", async () => {
      await api("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value, password: password.value, name: name.value, handle: handle.value }),
      });
    });
    if (ok !== null) {
      // The same page shows the code step.
      renderCodeStep(email.value);
    }
  });
  for (const input of [name, email, handle, password]) {
    input.addEventListener("input", () => { fieldError.textContent = ""; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") create.click(); });
  }
  column.append(
    h("h1", { class: "auth-title", text: "Sign up" }),
    name, email, handle, password, fieldError,
    h("div", { class: "dialog-actions" }, create),
    h("p", { class: "meta" }, h("a", { class: "link", href: "/signin", text: "Sign in" })),
  );
  mainEl.appendChild(column);
  name.focus();
}

function renderCodeStep(sentTo: string): void {
  mainEl.textContent = "";
  const column = h("div", { class: "auth" });
  const code = h("input", { class: "field", type: "text", "aria-label": "Code", placeholder: "Code", inputmode: "numeric" }) as HTMLInputElement;
  const confirm = h<HTMLButtonElement>("button", { class: "btn primary", text: "Confirm" });
  const fieldError = h("div", { class: "field-error", role: "alert" });
  confirm.addEventListener("click", async () => {
    const ok = await busy(confirm, "Confirming", async () => {
      await api("/api/accounts/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentTo, code: code.value }),
      });
    });
    if (ok !== null) location.assign("/");
  });
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm.click(); });
  column.append(
    h("h1", { class: "auth-title", text: "Check your email" }),
    h("p", { class: "meta", text: `We sent a code to ${sentTo}.` }),
    code, fieldError,
    h("div", { class: "dialog-actions" }, confirm),
  );
  mainEl.appendChild(column);
  code.focus();
}

function renderSignin(next?: string): void {
  mainEl.textContent = "";
  const column = h("div", { class: "auth" });
  const email = h("input", { class: "field", type: "email", "aria-label": "Email", placeholder: "Email" }) as HTMLInputElement;
  const password = h("input", { class: "field", type: "password", "aria-label": "Password", placeholder: "Password" }) as HTMLInputElement;
  const signin = h<HTMLButtonElement>("button", { class: "btn primary", text: "Sign in" });
  const fieldError = h("div", { class: "field-error", role: "alert" });
  signin.addEventListener("click", async () => {
    const ok = await busy(signin, "Signing in", async () => {
      await api("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
    });
    if (ok !== null) {
      // Signing in returns to the next path (sign-in gate).
      location.assign(next ?? "/");
    }
  });
  for (const input of [email, password]) {
    input.addEventListener("input", () => { fieldError.textContent = ""; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") signin.click(); });
  }
  column.append(
    h("h1", { class: "auth-title", text: "Sign in" }),
    email, password, fieldError,
    h("div", { class: "dialog-actions" }, signin),
    h("p", { class: "meta" }, h("a", { class: "link", href: "/signup", text: "Sign up" })),
  );
  mainEl.appendChild(column);
  email.focus();
}

// ---------- Home feed (DP-13, DP-14, DP-15, DP-17) ----------

function renderHome(): void {
  mainEl.textContent = "";
  const feedWrap = h("div", { class: "screen" });
  const newPinsButton = h("button", { class: "btn ghost new-pins", text: "", hidden: "true" });
  feedWrap.appendChild(newPinsButton);
  const gridHost = h("div", {});
  feedWrap.appendChild(gridHost);
  mainEl.appendChild(feedWrap);

  let pins: Array<PinJson & { group?: { size: number; owners: string[] } }> = [];
  let waiting: number[] = [];
  const grid = new PinGrid(gridHost, {
    label: "Pins",
    editable: false,
    showGroup: true,
    onOpen: (card, opener) => openFromGrid(card.data.pin, opener),
    onSave: (pin, opener) => openSaveDialog(pin.id, opener, () => { void reload(); }),
  });

  async function reload(): Promise<void> {
    const data = await apiJson<{ pins: typeof pins }>("/api/feed");
    pins = data.pins;
    if (pins.length === 0) {
      gridHost.textContent = "";
      emptyPrint(gridHost, "Follow people or boards to fill your feed.");
      return;
    }
    grid.setCards(pins.map(p => ({ pin: p, group: p.group })));
    grid.makeFirstTabbable();
  }

  function openFromGrid(pin: PinJson, opener: HTMLElement): void {
    const scrollY = window.scrollY;
    const exhibit = openPinExhibit(pin, opener, () => { void reload(); }, () => {
      // Escape or Back: the scroll position is restored and focus returns to the same card.
      window.scrollTo(0, scrollY);
      const card = grid.cardByPin(pin.id);
      if (card) {
        if (card.placement.top + window.scrollY < window.scrollY || card.placement.top > window.scrollY + window.innerHeight) {
          card.article.scrollIntoView({ block: "center" });
        }
        grid.focusCard(card);
      }
      void exhibit;
    });
    history.pushState({}, "", `/pin/${pin.id}`);
    const onPop = () => { exhibit.close(); };
    window.addEventListener("popstate", onPop, { once: true });
  }

  live.watch(undefined, undefined, undefined, true);
  live.on((msg) => {
    if (msg.type === "feed") {
      const ids = msg.pin_ids as number[];
      waiting.push(...ids);
      const count = waiting.length;
      // New pins wait behind the button, never shifting the feed (DP-15).
      newPinsButton.hidden = false;
      newPinsButton.textContent = count === 1 ? "Show 1 new pin" : `Show ${count} new pins`;
      announce(count === 1 ? "1 new pin" : `${count} new pins`);
    }
  });

  newPinsButton.addEventListener("click", async () => {
    const ids = waiting;
    waiting = [];
    newPinsButton.hidden = true;
    await reload();
    // Inserting them focuses the first new card (DP-15).
    const first = ids.map(id => grid.cardByPin(id)).find(c => c !== undefined);
    if (first) grid.focusCard(first, true);
  });

  void reload();
}

function emptyPrint(host: HTMLElement, sentence: string): void {
  const wrap = h("div", { class: "empty" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 220 280");
  svg.setAttribute("class", "print print-empty");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<rect x="26" y="22" width="168" height="236" fill="none" stroke="#e8e2d2" stroke-width="1.5"/>
    <circle cx="110" cy="118" r="30" fill="none" stroke="#e8e2d2" stroke-width="1.5"/>
    <path d="M 96 150 Q 110 176 124 150" fill="none" stroke="#e8e2d2" stroke-width="1.5"/>
    <path d="M 74 214 Q 110 192 146 214" fill="none" stroke="#e8e2d2" stroke-width="1"/>`;
  wrap.appendChild(svg);
  wrap.appendChild(h("p", { class: "meta", text: sentence }));
  host.appendChild(wrap);
}

function notFoundView(kind: "board" | "pin" | "page"): void {
  mainEl.textContent = "";
  const wrap = h("div", { class: "empty" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 220 280");
  svg.setAttribute("class", "print print-empty");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<rect x="26" y="22" width="168" height="236" fill="none" stroke="#e8e2d2" stroke-width="1.5"/>`;
  wrap.appendChild(svg);
  wrap.appendChild(h("h1", { class: "notfound-title", text: kind === "board" ? "Board not found" : kind === "pin" ? "Pin not found" : "Page not found" }));
  mainEl.appendChild(wrap);
}

// ---------- Composer (DP-18 to DP-30) ----------

function renderComposer(): void {
  mainEl.textContent = "";
  const wrap = h("div", { class: "screen composer" });
  const well = h("div", { class: "image-well" });
  const fields = h("div", { class: "composer-fields" });

  const chooseWrap = h("div", { class: "choose-wrap" });
  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg", class: "visually-hidden", "aria-label": "Image" }) as HTMLInputElement;
  const choose = h("button", { class: "btn ghost", text: "Choose image" });
  choose.addEventListener("click", () => fileInput.click());
  chooseWrap.append(fileInput, choose);

  const title = h("input", { class: "field", type: "text", "aria-label": "Title", placeholder: "Title" }) as HTMLInputElement;
  const titleCounter = h("span", { class: "counter meta" });
  const description = h("textarea", { class: "field", "aria-label": "Description", placeholder: "Description", "aria-expanded": "false", "aria-activedescendant": "" }) as HTMLTextAreaElement;
  const descriptionCounter = h("span", { class: "counter meta" });
  const alt = h("input", { class: "field", type: "text", "aria-label": "Alt text", placeholder: "Alt text" }) as HTMLInputElement;
  const source = h("input", { class: "field", type: "url", "aria-label": "Source link", placeholder: "Source link" }) as HTMLInputElement;
  const boardSelect = h("select", { class: "field", "aria-label": "Board" }) as HTMLSelectElement;
  const sectionSelect = h("select", { class: "field", "aria-label": "Section" }) as HTMLSelectElement;
  const publish = h<HTMLButtonElement>("button", { class: "btn primary", text: "Publish" });
  const fieldError = h("div", { class: "field-error", role: "alert" });

  // Live code-point counters (DP-18).
  const wireCounter = (input: HTMLInputElement | HTMLTextAreaElement, counter: HTMLElement, max: number): boolean => {
    const used = [...input.value].length;
    const over = used > max;
    counter.textContent = over ? `${used - max} over the limit` : `${used} / ${max}`;
    counter.classList.toggle("over", over);
    return over;
  };
  const updateAll = () => {
    const limits = state.config?.limits;
    const over = wireCounter(title, titleCounter, limits?.title_max ?? 100)
      || wireCounter(description, descriptionCounter, limits?.description_max ?? 500);
    publish.disabled = over;
  };
  title.addEventListener("input", updateAll);
  description.addEventListener("input", () => { updateAll(); tagSuggest(); });

  // Tag suggestions while typing a hashtag fragment (DP-88).
  const suggestBox = h("div", { class: "options suggestions", role: "listbox", "aria-label": "Tag suggestions", hidden: "true" });
  let suggestItems: string[] = [];
  let suggestActive = -1;
  const tagSuggest = async () => {
    const value = description.value.slice(0, description.selectionStart ?? 0);
    const m = /(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})$/u.exec(value);
    if (!m) { suggestBox.hidden = true; description.removeAttribute("aria-activedescendant"); return; }
    try {
      const data = await api(`/api/tags/suggest?prefix=${encodeURIComponent(m[1]!)}`) as { tags: Array<{ tag: string; count: number }> };
      suggestItems = data.tags.map(t => t.tag);
      suggestBox.textContent = "";
      if (suggestItems.length === 0) { suggestBox.hidden = true; return; }
      for (const tag of suggestItems) {
        const idx = data.tags.findIndex(t => t.tag === tag);
        suggestBox.appendChild(h("div", { class: "option", role: "option", "aria-label": `#${tag} (${data.tags[idx]!.count})`, text: `#${tag} (${data.tags[idx]!.count})` }));
      }
      suggestBox.hidden = false;
      description.setAttribute("aria-expanded", "true");
      suggestActive = -1;
    } catch { suggestBox.hidden = true; }
  };
  description.addEventListener("keydown", (e) => {
    if (suggestBox.hidden) {
      description.setAttribute("aria-expanded", "false");
      return;
    }
    const items = Array.from(suggestBox.querySelectorAll<HTMLElement>("[role=option]"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestActive = Math.min(suggestActive + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle("active", i === suggestActive));
      if (items[suggestActive]) description.setAttribute("aria-activedescendant", items[suggestActive]!.id);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestActive = Math.max(suggestActive - 1, 0);
      items.forEach((el, i) => el.classList.toggle("active", i === suggestActive));
      if (items[suggestActive]) description.setAttribute("aria-activedescendant", items[suggestActive]!.id);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (suggestActive >= 0) {
        e.preventDefault();
        const before = description.value.slice(0, description.selectionStart ?? 0);
        const after = description.value.slice(description.selectionEnd ?? 0);
        const m = /(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})$/u.exec(before);
        if (m) {
          const start = before.length - m[1]!.length;
          description.value = before.slice(0, start) + suggestItems[suggestActive]! + " " + after;
          description.selectionStart = description.selectionEnd = start + suggestItems[suggestActive]!.length + 1;
        }
        suggestBox.hidden = true;
        updateAll();
      }
      return;
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      suggestBox.hidden = true;
    }
  });

  publish.addEventListener("click", async () => {
    fieldError.textContent = "";
    const form = new FormData();
    if (fileInput.files && fileInput.files.length > 0) form.append("image", fileInput.files[0]!);
    form.append("title", title.value);
    form.append("description", description.value);
    form.append("alt", alt.value);
    form.append("source", source.value);
    form.append("board", boardSelect.value);
    if (sectionSelect.value && sectionSelect.value !== "0") form.append("section", sectionSelect.value);
    try {
      publish.disabled = true;
      publish.textContent = "Publishing";
      const pin = await api("/api/pins", { method: "POST", body: form }) as PinJson;
      announce("Pin published");
      location.assign(`/pin/${pin.id}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "storage_unavailable") {
        // The composer keeps every field of the draft and shows the outage alert (DP-29).
        errorAlert("Images can't be uploaded right now. Your draft is kept.");
      } else {
        showApiError(e);
      }
      publish.disabled = false;
      publish.textContent = "Publish";
    }
  });

  void (async () => {
    const data = await api("/api/boards/mine") as { boards: Array<{ id: number; name: string; pin_count: number }> };
    boardSelect.textContent = "";
    for (const b of data.boards) {
      boardSelect.appendChild(h("option", { value: String(b.id), text: b.name }));
    }
    if (data.boards.length === 0) {
      fieldError.textContent = "Create a board first.";
    }
  })();
  boardSelect.addEventListener("change", async () => {
    sectionSelect.textContent = "";
    sectionSelect.appendChild(h("option", { value: "0", text: "No section" }));
    const board = await apiJson<BoardJson>(`/api/boards/${boardSelect.value}`);
    for (const s of board.order.sections) {
      sectionSelect.appendChild(h("option", { value: String(s.id), text: s.name }));
    }
  });

  well.append(chooseWrap);
  fields.append(
    h("div", { class: "field-row" }, title, titleCounter),
    h("div", { class: "field-row stack" }, description, descriptionCounter, suggestBox),
    alt,
    source,
    h("div", { class: "field-row" }, boardSelect),
    h("div", { class: "field-row" }, sectionSelect),
    fieldError,
    h("div", { class: "dialog-actions" }, publish),
  );
  sectionSelect.appendChild(h("option", { value: "0", text: "No section" }));
  wrap.append(well, fields);
  mainEl.appendChild(wrap);
  updateAll();
}

// ---------- Board screen (DP-38 to DP-60) ----------

function renderBoard(id: number): void {
  mainEl.textContent = "";
  const wrap = h("div", { class: "screen" });
  const header = h("div", { class: "board-header" });
  const gridHost = h("div", { class: "board-body" });
  wrap.append(header, gridHost);
  mainEl.appendChild(wrap);

  let board: BoardJson;
  let grid: PinGrid;
  let sectionGrids: PinGrid[] = [];
  let seq = 0;
  let hasMembers = false;

  const canEdit = (): boolean => board.role === "owner" || board.role === "editor";
  const isOwner = (): boolean => board.role === "owner";

  const toolbar = h("div", { class: "toolbar", role: "toolbar", "aria-label": "Selection", hidden: "true" });
  const toolbarCount = h("span", { class: "meta" });
  const moveBtn = h<HTMLButtonElement>("button", { class: "btn ghost", text: "Move" });
  const copyBtn = h<HTMLButtonElement>("button", { class: "btn ghost", text: "Copy" });
  const deleteBtn = h<HTMLButtonElement>("button", { class: "btn primary", text: "Delete" });
  toolbar.append(toolbarCount, moveBtn, copyBtn, deleteBtn);
  wrap.appendChild(toolbar);

  const viewersList = h("ul", { class: "viewers", "aria-label": "Viewing now", hidden: "true" });
  const viewersCount = h("span", { class: "meta", hidden: "true" });
  const viewingWrap = h("div", { class: "viewing" }, viewersList, viewersCount);

  function updateToolbar(): void {
    const selected = grid ? grid.selectedPins().length + sectionGrids.reduce((n, g) => n + g.selectedPins().length, 0) : 0;
    if (selected === 0) {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    toolbarCount.textContent = selected === 1 ? "1 pin selected" : `${selected} pins selected`;
    announce(selected === 1 ? "1 pin selected" : `${selected} pins selected`);
  }

  async function load(): Promise<void> {
    try {
      board = await apiJson<BoardJson>(`/api/boards/${id}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) {
        notFoundView("board");
        return;
      }
      throw e;
    }
    seq = board.seq;
    header.textContent = "";
    const h1 = h("h1", { class: "board-title", text: board.name });
    const vis = h("span", { class: "meta", text: board.visibility === "secret" ? "Secret" : "" });
    const pinCount = h("span", { class: "meta", id: `board-pins-${id}`, text: pinCountText(board.pin_count) });
    const followerCount = h("span", { class: "meta", id: `board-followers-${id}`, text: followerText(board.followers) });

    const controls = h("div", { class: "board-controls" });
    if (state.me && board.owner.id !== state.me.id) {
      const follow = h("button", { class: "btn ghost", text: board.following ? "Following" : "Follow", "aria-pressed": String(board.following) });
      follow.addEventListener("click", async () => {
        const method = board.following ? "DELETE" : "PUT";
        const result = await api(`/api/follows/boards/${id}`, { method }) as { following: boolean; followers: number };
        board.following = result.following;
        follow.textContent = result.following ? "Following" : "Follow";
        follow.setAttribute("aria-pressed", String(result.following));
        followerCount.textContent = followerText(result.followers);
      });
      controls.appendChild(follow);
    }
    if (canEdit()) {
      const addPin = h("button", { class: "btn ghost", text: "Add pin", onclick: () => { location.assign("/create"); } });
      const addSection = h("button", { class: "btn ghost", text: "Add section", onclick: () => openAddSection() });
      controls.append(addPin, addSection);
    }
    if (isOwner()) {
      const edit = h("button", { class: "btn ghost", text: "Edit board", onclick: () => openEditBoard() });
      const invite = h("button", { class: "btn ghost", text: "Invite", onclick: (e: Event) => openInviteDialog(id, e.target as HTMLElement) });
      controls.append(edit, invite);
    }
    if (board.role) {
      const collab = h("button", { class: "btn ghost", text: "Collaborators", onclick: (e: Event) => openCollaboratorsDialog(id, e.target as HTMLElement, board.role, state.me!.id, () => location.assign("/")) });
      controls.appendChild(collab);
    }
    header.append(h1, h("div", { class: "board-meta" }, vis, pinCount, followerCount), viewingWrap, controls);

    // The unsectioned grid and each section.
    gridHost.textContent = "";
    sectionGrids = [];
    const pinById = new Map<number, PinJson>((board.pins ?? []).map(p => [p.id, p]));

    if (board.order.unsectioned.length === 0 && board.order.sections.length === 0) {
      emptyPrint(gridHost, "No pins yet");
      return;
    }
    const mkGrid = (label: string, host: HTMLElement, sectionId: number | null): PinGrid => {
      const g = new PinGrid(host, {
        label,
        editable: canEdit(),
        showGroup: false,
        reorderable: canEdit(),
        onOpen: (card, opener) => {
          const scrollY = window.scrollY;
          const exhibit = openPinExhibit(card.data.pin, opener, () => {}, () => {
            window.scrollTo(0, scrollY);
            g.focusCard(g.cardByPin(card.data.pin.id)!);
          });
          history.pushState({}, "", `/pin/${card.data.pin.id}`);
          window.addEventListener("popstate", () => exhibit.close(), { once: true });
        },
        onSave: (pin, opener) => openSaveDialog(pin.id, opener, () => {}),
        onSelectChange: updateToolbar,
        onReorder: async (pinId, targetOrder) => {
          const containerPins = sectionId === null ? board.order.unsectioned : board.order.sections.find(s => s.id === sectionId)!.pins;
          const currentIndex = containerPins.indexOf(pinId);
          const clamped = Math.max(1, Math.min((targetOrder ?? 0) + 1, containerPins.length));
          if (clamped === currentIndex + 1) return;
          try {
            const result = await api(`/api/boards/${id}/moves`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "pin", id: pinId, section: sectionId, position: clamped, base_seq: seq }),
            }) as { seq: number; rebased: boolean };
            seq = result.seq;
            announce(`Moved ${pinById.get(pinId)!.title} to position ${clamped} of ${containerPins.length}`);
            await load();
            const gAfter = sectionId === null ? grid : sectionGrids.find(sg => sg.options.label === label);
            void gAfter;
          } catch (e) { showApiError(e); }
        },
      });
      return g;
    };

    if (board.order.unsectioned.length > 0 || board.order.sections.length === 0) {
      const host = h("div", {});
      gridHost.appendChild(host);
      grid = mkGrid("Pins", host, null);
      grid.setCards(board.order.unsectioned.map(pid => ({ pin: pinById.get(pid)! })).filter(Boolean));
      grid.makeFirstTabbable();
    }
    for (const section of board.order.sections) {
      const region = h("section", { class: "board-section", role: "region", "aria-label": section.name });
      const h2 = h("h2", { class: "section-title", text: section.name, tabindex: canEdit() ? "0" : "-1" });
      if (canEdit()) {
        h2.addEventListener("keydown", async (e) => {
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const currentPosition = board.order.sections.findIndex(s => s.id === section.id) + 1;
            const target = e.key === "ArrowUp" ? currentPosition - 1 : currentPosition + 1;
            if (target < 1 || target > board.order.sections.length) return;
            try {
              const result = await api(`/api/boards/${id}/moves`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "section", id: section.id, position: target, base_seq: seq }),
              }) as { seq: number };
              seq = result.seq;
              announce(`Moved section ${section.name} to position ${target} of ${board.order.sections.length}`);
              await load();
              const h2s = Array.from(gridHost.querySelectorAll<HTMLElement>(".section-title"));
              h2s[target - 1]?.focus();
            } catch (err) { showApiError(err); }
          }
        });
      }
      region.appendChild(h2);
      const host = h("div", {});
      region.appendChild(host);
      gridHost.appendChild(region);
      const sectionGrid = mkGrid(section.name, host, section.id);
      sectionGrids.push(sectionGrid);
      if (section.pins.length === 0) {
        emptyPrint(host, "No pins yet");
      } else {
        sectionGrid.setCards(section.pins.map(pid => ({ pin: pinById.get(pid)! })).filter(Boolean));
      }
    }

    // Who is viewing (DP-90).
    void refreshViewers();
  }

  async function refreshViewers(): Promise<void> {
    try {
      const data = await apiJson<{ viewers: Array<{ id: number; name: string }> }>(`/api/boards/${id}/viewers`);
      const members = await apiJson<{ members: unknown[] }>(`/api/boards/${id}/members`).catch(() => ({ members: [] }));
      hasMembers = members.members.length > 0;
      if (!hasMembers) {
        viewersList.hidden = true;
        viewersCount.hidden = true;
        return;
      }
      viewersList.hidden = false;
      viewersCount.hidden = false;
      viewersList.textContent = "";
      for (const v of data.viewers) {
        viewersList.appendChild(h("li", { text: v.name }));
      }
      viewersCount.textContent = data.viewers.length === 1 ? "1 person viewing" : `${data.viewers.length} people viewing`;
    } catch { /* the board may be hidden from us now */ }
  }

  function openAddSection(): void {
    openDialog("Add section", null, close => {
      const wrap = h("div", { class: "dialog-body" });
      const name = h("input", { class: "field", type: "text", "aria-label": "Name", placeholder: "Name" }) as HTMLInputElement;
      const create = h<HTMLButtonElement>("button", { class: "btn primary", text: "Create" });
      const fieldError = h("div", { class: "field-error", role: "alert" });
      create.addEventListener("click", async () => {
        const ok = await busy(create, "Creating", async () => {
          await api(`/api/boards/${id}/sections`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.value }),
          });
          close();
          await load();
        });
        void ok;
      });
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") create.click(); });
      wrap.append(h("div", { class: "dialog-head" }, h("h2", { text: "Add section" })), name, fieldError, h("div", { class: "dialog-actions" }, create));
      window.setTimeout(() => name.focus(), 0);
      return wrap;
    });
  }

  function openEditBoard(): void {
    openDialog("Edit board", null, close => {
      const wrap = h("div", { class: "dialog-body" });
      const name = h("input", { class: "field", type: "text", "aria-label": "Name", value: board.name }) as HTMLInputElement;
      const publicRadio = h("input", { type: "radio", name: "board-visibility", value: "public", id: "vis-public" }) as HTMLInputElement;
      const secretRadio = h("input", { type: "radio", name: "board-visibility", value: "secret", id: "vis-secret" }) as HTMLInputElement;
      (board.visibility === "secret" ? secretRadio : publicRadio).checked = true;
      const cover = h("select", { class: "field", "aria-label": "Cover" }) as HTMLSelectElement;
      cover.appendChild(h("option", { value: "", text: "Automatic" }));
      for (const p of board.pins ?? []) {
        const option = h("option", { value: String(p.id), text: p.title });
        if (board.cover === p.id) (option as HTMLOptionElement).selected = true;
        cover.appendChild(option);
      }
      const save = h<HTMLButtonElement>("button", { class: "btn primary", text: "Save changes" });
      const del = h("button", { class: "btn ghost", text: "Delete board" });
      const fieldError = h("div", { class: "field-error", role: "alert" });
      save.addEventListener("click", async () => {
        const ok = await busy(save, "Saving", async () => {
          await api(`/api/boards/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.value,
              visibility: secretRadio.checked ? "secret" : "public",
              cover: cover.value === "" ? null : Number(cover.value),
            }),
          });
          close();
          await load();
        });
        void ok;
      });
      del.addEventListener("click", () => {
        close();
        openDialog(`Delete ${board.name}?`, null, closeConfirm => {
          const w = h("div", { class: "dialog-body" });
          const confirmBtn = h<HTMLButtonElement>("button", { class: "btn primary", text: "Delete board" });
          const cancel = h("button", { class: "btn ghost", text: "Cancel" });
          confirmBtn.addEventListener("click", async () => {
            const ok = await busy(confirmBtn, "Deleting", async () => {
              await api(`/api/boards/${id}`, { method: "DELETE" });
              announce("Board deleted");
              location.assign("/boards");
            });
            void ok;
          });
          cancel.addEventListener("click", closeConfirm);
          w.append(
            h("div", { class: "dialog-head" }, h("h2", { text: `Delete ${board.name}?` })),
            h("div", { class: "dialog-actions" }, confirmBtn, cancel),
          );
          return w;
        });
      });
      wrap.append(
        h("div", { class: "dialog-head" }, h("h2", { text: "Edit board" })),
        name,
        h("div", { class: "radio-row", role: "radiogroup", "aria-label": "Visibility" },
          h("label", { class: "radio", for: "vis-public" }, publicRadio, "Public"),
          h("label", { class: "radio", for: "vis-secret" }, secretRadio, "Secret"),
        ),
        cover, fieldError,
        h("div", { class: "dialog-actions" }, save, del),
      );
      window.setTimeout(() => name.focus(), 0);
      return wrap;
    });
  }

  // Bulk operations: one server operation, toast with Undo and the server deadline (DP-41).
  const runBulk = async (kind: "move" | "copy" | "delete", target?: { board: number; name: string }): Promise<void> => {
    const pins: PinJson[] = [];
    if (grid) pins.push(...grid.selectedPins());
    for (const g of sectionGrids) pins.push(...g.selectedPins());
    if (pins.length === 0) return;
    const pinIds = pins.map(p => p.id);
    const button = kind === "move" ? moveBtn : kind === "copy" ? copyBtn : deleteBtn;
    const ok = await busy(button as HTMLButtonElement, kind === "move" ? "Moving" : kind === "copy" ? "Copying" : "Deleting", async () => {
      const op = await api("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, pins: pinIds, board: target?.board ?? null, section: null }),
      }) as { id: number; deadline: string };
      const one = pins.length === 1;
      const text = kind === "delete"
        ? (one ? "1 pin deleted · Undo" : `${pins.length} pins deleted · Undo`)
        : one
          ? (kind === "move" ? `1 pin moved to ${target!.name} · Undo` : `1 pin copied to ${target!.name} · Undo`)
          : (kind === "move" ? `${pins.length} pins moved to ${target!.name} · Undo` : `${pins.length} pins copied to ${target!.name} · Undo`);
      toast(text, { undo: { operationId: op.id, deadline: op.deadline, onUndo: async () => {
        try {
          await api(`/api/operations/${op.id}/undo`, { method: "POST" });
          announce("Undone");
          toast("Undone");
          undoDone(op.id);
          await load();
        } catch (e) {
          errorAlert(failureText(e as ApiFailure));
        }
      } } });
      announce(text);
      await load();
    });
    void ok;
  };

  moveBtn.addEventListener("click", () => {
    const count = countSelected();
    openMoveCopyDialog("move", count, id, moveBtn, (boardId, _sectionId, boardName) => {
      void runBulk("move", { board: boardId, name: boardName });
    });
  });
  copyBtn.addEventListener("click", () => {
    const count = countSelected();
    openMoveCopyDialog("copy", count, id, copyBtn, (boardId, _sectionId, boardName) => {
      void runBulk("copy", { board: boardId, name: boardName });
    });
  });
  deleteBtn.addEventListener("click", () => { void runBulk("delete"); });

  function countSelected(): number {
    let n = 0;
    if (grid) n += grid.selectedPins().length;
    for (const g of sectionGrids) n += g.selectedPins().length;
    return n;
  }

  // Live board updates (DP-50) and member role changes (DP-58, DP-59).
  live.watch(id);
  live.on(async (msg) => {
    if (msg.type === "board" && msg.board_id === id) {
      if (msg.actor && (msg.actor as { id: number }).id !== state.me?.id) {
        const actorName = (msg.actor as { name: string }).name;
        const pin = msg.pin as { id: number; title: string } | null;
        const section = msg.section as { id: number; name: string } | null;
        let text: string | null = null;
        switch (msg.change) {
          case "moved": text = pin ? `${actorName} moved ${pin.title}` : null; break;
          case "added": text = pin ? `${actorName} added ${pin.title}` : null; break;
          case "removed": text = pin ? `${actorName} removed ${pin.title}` : null; break;
          case "section_moved": text = section ? `${actorName} moved section ${section.name}` : null; break;
          default: text = null;
        }
        if (text) { announce(text); toast(text); }
      }
      seq = msg.seq as number;
      await load();
    }
    if (msg.type === "membership" && msg.board_id === id) {
      const role = msg.role as string | null;
      if (role === null) {
        // Removal: the open board page becomes not found without a reload (DP-59).
        notFoundView("board");
      } else {
        board.role = role as "editor" | "viewer";
        if (role === "viewer") {
          announce("You can now only view this board");
          toast("You can now only view this board");
        }
        await load();
      }
    }
    if (msg.type === "viewers" && msg.board_id === id) {
      const viewers = msg.viewers as Array<{ id: number; name: string }>;
      if (hasMembers) {
        viewersList.hidden = false;
        viewersCount.hidden = false;
        const previous = new Set(Array.from(viewersList.children).map(li => li.textContent));
        for (const v of viewers) {
          if (!previous.has(v.name)) announce(`${v.name} opened this board`);
        }
        for (const name of previous) {
          if (!viewers.some(v => v.name === name) && name !== state.me?.name) announce(`${name} left this board`);
        }
        viewersList.textContent = "";
        for (const v of viewers) viewersList.appendChild(h("li", { text: v.name }));
        viewersCount.textContent = viewers.length === 1 ? "1 person viewing" : `${viewers.length} people viewing`;
      }
    }
    if (msg.type === "follow" && msg.target === "board" && msg.id === id) {
      const followers = msg.followers as number;
      const el = document.getElementById(`board-followers-${id}`);
      if (el) el.textContent = followerText(followers);
    }
    if (msg.type === "operation_expired") {
      operationExpired(msg.id as number);
    }
  });

  void load();
}

// ---------- Boards screen ----------

async function renderBoards(): Promise<void> {
  mainEl.textContent = "";
  const wrap = h("div", { class: "screen" });
  const create = h("button", { class: "btn primary", text: "Create board" });
  const list = h("div", { class: "board-cards" });
  create.addEventListener("click", () => {
    openCreateBoardDialog(create, async (board) => {
      location.assign(`/b/${board.id}`);
    });
  });
  wrap.append(h("h1", { class: "screen-title", text: "Boards" }), create, list);
  mainEl.appendChild(wrap);

  // Cards for the viewer's own boards and the boards they are a member of.
  const mine = await api("/api/boards/mine") as { boards: Array<{ id: number; name: string; visibility: string; pin_count: number }> };
  const members = await api(`/api/users/${state.me!.handle}`) as { boards: Array<{ id: number; name: string; visibility: string; pin_count: number; cover: { url: string } | null }> };
  const seen = new Set<number>();
  const boards = [...mine.boards.filter(b => !seen.has(b.id) && seen.add(b.id)), ...[]];
  const memberBoards = members.boards.filter(b => b.visibility === "public" && !seen.has(b.id));
  list.textContent = "";
  for (const b of boards) {
    const board = members.boards.find(mb => mb.id === b.id);
    list.appendChild(boardCard(b.id, b.name, b.visibility, b.pin_count, board?.cover?.url ?? null));
  }
  for (const b of memberBoards) {
    list.appendChild(boardCard(b.id, b.name, b.visibility, b.pin_count, b.cover?.url ?? null));
  }
  if (boards.length + memberBoards.length === 0) {
    emptyPrint(list, "No pins yet");
  }
}

function boardCard(id: number, name: string, visibility: string, pinCount: number, coverUrl: string | null): HTMLElement {
  const card = h("a", { class: "board-card", href: `/b/${id}` });
  const cover = coverUrl
    ? h("img", { class: "board-cover", src: coverUrl, alt: "" })
    : h("div", { class: "board-cover empty-cover" });
  card.append(
    cover,
    h("div", { class: "board-card-meta" },
      h("span", { text: name }),
      h("span", { class: "meta", text: `${pinCountText(pinCount)}${visibility === "secret" ? " · Secret" : ""}` }),
    ),
  );
  return card;
}

// ---------- Profile (DP-64) ----------

async function renderProfile(handle: string, tab: "boards" | "pins", sort: string): Promise<void> {
  mainEl.textContent = "";
  const wrap = h("div", { class: "screen" });
  let data: {
    user: { id: number; name: string; handle: string };
    followers: number; following: number; pin_total: number; board_total: number;
    boards: Array<{ id: number; name: string; visibility: string; pin_count: number; cover: { pin_id: number; url: string } | null }>;
    following_user: boolean;
  };
  try {
    data = await api(`/api/users/${handle}?sort=${sort}`) as typeof data;
  } catch {
    notFoundView("page");
    return;
  }
  const head = h("div", { class: "profile-head" });
  head.append(
    h("h1", { class: "profile-name", text: data.user.name }),
    h("p", { class: "meta", text: `@${data.user.handle}` }),
    h("div", { class: "profile-counts" },
      h("span", { class: "meta", id: `user-followers-${data.user.id}`, text: followerText(data.followers) }),
      h("span", { class: "meta", text: followingText(data.following) }),
      h("span", { class: "meta", text: pinCountText(data.pin_total) }),
      h("span", { class: "meta", text: `${data.board_total === 1 ? "1 board" : `${data.board_total} boards`}` }),
    ),
  );
  if (state.me && data.user.id !== state.me.id) {
    const follow = h("button", { class: "btn ghost", text: data.following_user ? "Following" : "Follow", "aria-pressed": String(data.following_user) });
    follow.addEventListener("click", async () => {
      const result = await api(`/api/follows/users/${data.user.id}`, { method: data.following_user ? "DELETE" : "PUT" }) as { following: boolean; followers: number };
      data.following_user = result.following;
      follow.textContent = result.following ? "Following" : "Follow";
      follow.setAttribute("aria-pressed", String(result.following));
      const el = document.getElementById(`user-followers-${data.user.id}`);
      if (el) el.textContent = followerText(result.followers);
    });
    head.appendChild(follow);
  }

  const tabs = h("div", { class: "tabs-row", role: "tablist" });
  const tabBoards = h("button", { class: "btn ghost", role: "tab", "aria-selected": String(tab === "boards"), text: "Boards" });
  const tabPins = h("button", { class: "btn ghost", role: "tab", "aria-selected": String(tab === "pins"), text: "Pins" });
  tabBoards.addEventListener("click", () => navigate(`/u/${handle}?tab=boards&sort=${sort}`));
  tabPins.addEventListener("click", () => navigate(`/u/${handle}?tab=pins&sort=${sort}`));
  tabs.append(tabBoards, tabPins);

  const body = h("div", { class: "profile-body" });
  if (tab === "boards") {
    const sortSelect = h("select", { class: "field slim", "aria-label": "Sort boards" }) as HTMLSelectElement;
    for (const [value, label] of [["last_saved", "Last saved to"], ["az", "A to Z"], ["newest", "Newest"]] as const) {
      const option = h("option", { value, text: label });
      if (sort === value) (option as HTMLOptionElement).selected = true;
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener("change", () => navigate(`/u/${handle}?tab=boards&sort=${sortSelect.value}`));
    const boardsWrap = h("div", { class: "board-cards" });
    for (const b of data.boards) {
      boardsWrap.appendChild(boardCard(b.id, b.name, b.visibility, b.pin_count, b.cover?.url ?? null));
    }
    if (data.boards.length === 0) emptyPrint(boardsWrap, "No pins yet");
    body.append(sortSelect, boardsWrap);
  } else {
    const gridHost = h("div", {});
    body.appendChild(gridHost);
    try {
      const pins = await api(`/api/users/${handle}/pins`) as { pins: PinJson[] };
      if (pins.pins.length === 0) {
        emptyPrint(gridHost, "No pins yet");
      } else {
        const grid = new PinGrid(gridHost, {
          label: "Pins",
          editable: false,
          showGroup: false,
          onOpen: (card, opener) => {
            const scrollY = window.scrollY;
            const exhibit = openPinExhibit(card.data.pin, opener, () => {}, () => {
              window.scrollTo(0, scrollY);
              grid.focusCard(grid.cardByPin(card.data.pin.id)!);
            });
            history.pushState({}, "", `/pin/${card.data.pin.id}`);
            window.addEventListener("popstate", () => exhibit.close(), { once: true });
          },
          onSave: (pin, opener) => openSaveDialog(pin.id, opener, () => {}),
        });
        grid.setCards(pins.pins.map(p => ({ pin: p })));
        grid.makeFirstTabbable();
      }
    } catch { emptyPrint(gridHost, "No pins yet"); }
  }
  wrap.append(head, tabs, body);
  mainEl.appendChild(wrap);
  live.watch(undefined, undefined, data.user.id);
  live.on((msg) => {
    if (msg.type === "follow" && msg.target === "user" && msg.id === data.user.id) {
      const el = document.getElementById(`user-followers-${data.user.id}`);
      if (el) el.textContent = followerText(msg.followers as number);
    }
  });
}

// ---------- Search (DP-65, DP-66) ----------

async function renderSearch(q: string, tag: string, board: number | null): Promise<void> {
  mainEl.textContent = "";
  const wrap = h("div", { class: "screen" });
  const tagSelect = h("select", { class: "field slim", "aria-label": "Tag" }) as HTMLSelectElement;
  const boardSelect = h("select", { class: "field slim", "aria-label": "Board" }) as HTMLSelectElement;
  tagSelect.appendChild(h("option", { value: "", text: "All tags" }));
  boardSelect.appendChild(h("option", { value: "", text: "All boards" }));
  const filters = h("div", { class: "search-filters" }, tagSelect, boardSelect);
  const gridHost = h("div", {});
  const message = h("p", { class: "meta" });
  wrap.append(h("h1", { class: "screen-title", text: "Search" }), filters, message, gridHost);
  mainEl.appendChild(wrap);

  const search = new URLSearchParams();
  search.set("q", q);
  if (tag) search.set("tag", tag);
  if (board !== null) search.set("board", String(board));
  const data = await api(`/api/search?${search.toString()}`) as {
    pins: PinJson[];
    tags: Array<{ tag: string; count: number }>;
    boards: Array<{ id: number; name: string; count: number }>;
  };
  for (const t of data.tags) {
    const option = h("option", { value: t.tag, text: `#${t.tag} (${t.count})` });
    if (t.tag === tag) (option as HTMLOptionElement).selected = true;
    tagSelect.appendChild(option);
  }
  for (const b of data.boards) {
    const option = h("option", { value: String(b.id), text: `${b.name} (${b.count})` });
    if (b.id === board) (option as HTMLOptionElement).selected = true;
    boardSelect.appendChild(option);
  }
  tagSelect.addEventListener("change", () => navigate(`/search?q=${encodeURIComponent(q)}&tag=${tagSelect.value}&board=${boardSelect.value}`));
  boardSelect.addEventListener("change", () => navigate(`/search?q=${encodeURIComponent(q)}&tag=${tagSelect.value}&board=${boardSelect.value}`));

  if (q.trim() === "" && !tag) {
    message.textContent = "";
    return;
  }
  if (data.pins.length === 0) {
    // The published sentence, character for character (DP-66).
    const trimmed = q.trim();
    message.textContent = tag && !trimmed
      ? `No pins match "#${tag}".`
      : `No pins match "${trimmed}".`;
    return;
  }
  const grid = new PinGrid(gridHost, {
    label: "Pins",
    editable: false,
    showGroup: false,
    onOpen: (card, opener) => {
      const scrollY = window.scrollY;
      const exhibit = openPinExhibit(card.data.pin, opener, () => {}, () => {
        window.scrollTo(0, scrollY);
        grid.focusCard(grid.cardByPin(card.data.pin.id)!);
      });
      history.pushState({}, "", `/pin/${card.data.pin.id}`);
      window.addEventListener("popstate", () => exhibit.close(), { once: true });
    },
    onSave: (pin, opener) => openSaveDialog(pin.id, opener, () => {}),
  });
  grid.setCards(data.pins.map(p => ({ pin: p })));
  grid.makeFirstTabbable();
}

// ---------- Invite page (DP-55) ----------

async function renderInvite(token: string): Promise<void> {
  mainEl.textContent = "";
  const column = h("div", { class: "auth" });
  let data: { board: { id: number; name: string }; inviter: { name: string }; role: string; status: string };
  try {
    data = await api(`/api/invites/${token}`) as typeof data;
  } catch {
    column.append(
      h("h1", { class: "auth-title", text: "Invite" }),
      h("p", { class: "meta", text: "This invite link isn't valid." }),
    );
    mainEl.appendChild(column);
    return;
  }
  const heading = h("h1", { class: "auth-title", text: `Join ${data.board.name}` });
  let body: HTMLElement;
  if (data.status !== "pending") {
    const copy = data.status === "expired" ? "This invite has expired."
      : data.status === "accepted" ? "This invite has already been used."
      : "This invite was withdrawn.";
    body = h("p", { class: "meta", text: copy });
  } else if (!state.me) {
    body = h("div", {},
      h("p", { class: "meta" },
        h("a", { class: "link", href: `/signin?next=/invites/${token}`, text: "Sign in" }),
        " or ",
        h("a", { class: "link", href: `/signup`, text: "Sign up" }),
      ));
  } else {
    const join = h<HTMLButtonElement>("button", { class: "btn primary", text: "Join board" });
    join.addEventListener("click", async () => {
      const ok = await busy(join, "Joining", async () => {
        try {
          await api(`/api/invites/${token}/accept`, { method: "POST" });
          announce(`You joined ${data.board.name}`);
          location.assign(`/b/${data.board.id}`);
        } catch (e) {
          errorAlert(failureText(e as ApiFailure));
          throw e;
        }
      });
      void ok;
    });
    body = h("div", { class: "dialog-actions" }, join);
  }
  column.append(heading, body);
  mainEl.appendChild(column);
}

// ---------- Pin page (direct open) ----------

async function renderPinPage(id: number): Promise<void> {
  mainEl.textContent = "";
  try {
    const pin = await apiJson<PinJson>(`/api/pins/${id}`);
    // Opened directly, the same content is the page's main content.
    const exhibit = openPinExhibit(pin, null, () => {}, () => { history.back(); });
    void exhibit;
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) {
      notFoundView("pin");
      return;
    }
    throw e;
  }
}

// ---------- Router ----------

function navigate(path: string): void {
  history.pushState({}, "", path);
  void route();
}

export async function route(): Promise<void> {
  const { pathname, search } = location;
  const parsed = parseRoute(pathname, search, state.me !== null);
  state.route = parsed;
  clearAlert();
  switch (parsed.kind) {
    case "landing": renderLanding(); return;
    case "signup": renderSignup(); return;
    case "signin": renderSignin(parsed.next); return;
    case "home": renderHome(); return;
    case "pin": await renderPinPage(parsed.id); return;
    case "create": renderComposer(); return;
    case "board": renderBoard(parsed.id); return;
    case "boards": await renderBoards(); return;
    case "profile": await renderProfile(parsed.handle, parsed.tab, parsed.sort); return;
    case "search": await renderSearch(parsed.q, parsed.tag, parsed.board); return;
    case "invite": await renderInvite(parsed.token); return;
    case "notfound": notFoundView("page"); return;
  }
}

// ---------- Boot (DP-01, DP-02) ----------

async function boot(): Promise<void> {
  state.config = await apiJson<AppConfig>("/api/config");
  setBusinessNow(state.config.now);
  try {
    const me = await apiJson<{ user: Me }>("/api/me");
    state.me = me.user;
  } catch {
    state.me = null;
  }
  shell(state.me);
  if (state.me) connectLive();
  // Times re-render at least every 60 seconds (DP-71).
  window.setInterval(() => {
    document.querySelectorAll<HTMLElement>("time[data-instant]").forEach(el => {
      el.textContent = relativeTime(el.dataset.instant!);
    });
  }, 60_000);
  window.addEventListener("popstate", () => void route());
  // The sign-in gate: a signed-out visit to a signed-in screen goes to /signin?next=<path>.
  const gate = parseRoute(location.pathname, location.search, state.me !== null);
  const needsAuth = ["create", "boards", "profile", "board"];
  if (!state.me && needsAuth.includes(gate.kind)) {
    location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  await route();
}

window.addEventListener("DOMContentLoaded", () => { void boot(); });
if (document.readyState !== "loading") void boot();
