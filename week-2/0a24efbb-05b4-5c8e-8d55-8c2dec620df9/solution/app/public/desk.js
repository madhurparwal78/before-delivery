// The live parts of the server-drawn desk: announcements, the state chips, the filter sheet, the expandable rows,
// the draft row, the decision controls, the sharing controls, the policy form and the queue's count re-read.
import { queueHref, queueValues } from "/queue-query.mjs";
import { graphemeCount } from "/text.mjs";
import { businessDate, clockOf } from "/time.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const NO_SERVER = "The desk could not reach the server. Try again.";
const QUEUE_FAILED = "The queue could not be loaded. Try again.";
const CARRY = "rostara.announcement";
const RETURN_TO = "rostara.return";
const PAGED = "rostara.paged";

/* Announcements: one polite and one assertive region; a new message replaces the old; the toast mirrors it. */

const polite = $("[data-polite]");
const assertive = $("[data-assertive]");
const toast = $("[data-toast]");
let toastTimer = 0;

function write(region, text) {
  region.textContent = "";
  queueMicrotask(() => {
    region.textContent = text;
  });
}

function hideToast() {
  clearTimeout(toastTimer);
  if (toast.hidden) return;
  if (reduced.matches) {
    toast.hidden = true;
    return;
  }
  toast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "cubic-bezier(.4,0,1,1)" })
    .finished.then(() => {
      toast.hidden = true;
    });
}

function holdToast() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function mirror(text) {
  $("[data-toast-text]", toast).textContent = text;
  toast.hidden = false;
  holdToast();
}

/** Work in progress, counts and page changes. */
function say(text, { quiet = false } = {}) {
  write(polite, text);
  if (!quiet) mirror(text);
}

/** Outcomes, refusals and validation summaries. */
function shout(text) {
  write(assertive, text);
  mirror(text);
}

toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
toast.addEventListener("focusin", () => clearTimeout(toastTimer));
toast.addEventListener("mouseleave", holdToast);
toast.addEventListener("focusout", holdToast);
$("[data-toast-dismiss]", toast).addEventListener("click", hideToast);

/** Keep the current announcement across a navigation the desk makes itself. */
function carry(kind, text) {
  sessionStorage.setItem(CARRY, JSON.stringify({ kind, text }));
}

const carried = sessionStorage.getItem(CARRY);
if (carried) {
  sessionStorage.removeItem(CARRY);
  const { kind, text } = JSON.parse(carried);
  (kind === "alert" ? shout : say)(text);
}

/* Calls to the API. Every refusal arrives as {error, field?}. */

async function call(method, url, { body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: NO_SERVER };
  }
  const data = await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data };
  return { ok: false, status: response.status, data, error: data?.error ?? NO_SERVER, field: data?.field };
}

/** The busy arc beside a control's own text, only while its send is in flight. */
function spin(control) {
  const arc = document.createElement("span");
  arc.className = "arc";
  arc.setAttribute("aria-hidden", "true");
  control.append(arc);
  return () => arc.remove();
}

/** A refusal beside the control that was refused; an ended session links back through sign-in to this page. */
function inline(box, refusal) {
  box.replaceChildren(refusal.error);
  if (refusal.status === 401) {
    const link = document.createElement("a");
    link.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    link.textContent = "Sign in again";
    box.append(" ", link);
  }
  box.hidden = false;
}

/** The same page drawn again by the server, for the parts that changed after an answer. */
async function redraw(url = location.href) {
  try {
    const response = await fetch(url, { credentials: "same-origin", headers: { accept: "text/html" } });
    return response.ok ? new DOMParser().parseFromString(await response.text(), "text/html") : null;
  } catch {
    return null;
  }
}

/* Dialogs: focus moves in, Tab and Shift+Tab stay inside, Escape closes, focus returns to the opener.
   Adapted from kit/modules/a11y_dialog. */

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function openDialog(dialog, opener, leave) {
  dialog.showModal();
  const items = () => $$(FOCUSABLE, dialog).filter((el) => el.getClientRects().length);
  items()[0]?.focus();
  let open = true;
  const onKey = (event) => {
    if (event.key !== "Tab") return;
    const els = items();
    const edge = event.shiftKey ? els[0] : els.at(-1);
    if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? els.at(-1) : els[0]).focus();
    }
  };
  const onCancel = (event) => {
    event.preventDefault();
    close();
  };
  // The dialog closes at once and focus is back on its opener; a hidden, inert copy plays the leaving motion.
  function close() {
    if (!open) return;
    open = false;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    const ghost = leave && !reduced.matches ? dialog.cloneNode(true) : null;
    dialog.close();
    opener.focus();
    if (!ghost) return;
    for (const el of [ghost, ...$$("[id]", ghost)]) el.removeAttribute("id");
    ghost.classList.add("leaving");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.setAttribute("open", "");
    dialog.after(ghost);
    ghost.animate(leave(), { duration: 180, easing: "cubic-bezier(.4,0,1,1)" }).finished.then(() => ghost.remove());
  }
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  return { close };
}

/* Sign out from the top bar. */

$("[data-signout]")?.addEventListener("click", async () => {
  await call("DELETE", "/api/session");
  carry("status", "You are signed out.");
  location.assign("/login");
});

/* Sign in. */

const login = $("[data-login]");
if (login) {
  const address = $("#login-address");
  const password = $("#login-password");
  const button = $("[data-signin]");
  const label = $("[data-signin-label]");
  const refused = $("[data-login-alert]");
  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    label.textContent = "Signing in";
    say("Signing in");
    const settle = spin(button);
    const answer = await call("POST", "/api/session", {
      body: { work_address: address.value, password: password.value },
    });
    settle();
    if (answer.ok) {
      location.assign(login.dataset.next ?? "/requests");
      return;
    }
    password.value = "";
    refused.textContent = answer.error;
    refused.hidden = false;
    shout(answer.error);
    button.disabled = false;
    label.textContent = "Sign in";
  });
}

/* The queue. */

const queue = $("[data-queue]");
if (queue) {
  const path = location.pathname;
  const values = queueValues(location.search);
  const go = (next) => location.replace(queueHref(path, { ...next, page: undefined }));
  const heading = $("#queue-title");

  const states = $("[data-states]");
  const chips = $$("[role=radio]", states);
  states.addEventListener("keydown", (event) => {
    const at = chips.indexOf(document.activeElement);
    const to = {
      ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: chips.length - 1,
    }[event.key];
    if (at < 0 || to === undefined) return;
    event.preventDefault();
    const next = chips[(to + chips.length) % chips.length];
    for (const chip of chips) chip.tabIndex = chip === next ? 0 : -1;
    next.focus();
  });
  for (const chip of chips) chip.addEventListener("click", () => location.replace(chip.dataset.href));

  $("[data-search]").addEventListener("submit", (event) => {
    event.preventDefault();
    go({ ...values, q: $("#queue-q").value });
  });
  $("[data-sort]").addEventListener("change", (event) => go({ ...values, sort: event.target.value }));

  const sheet = $("[data-sheet]");
  const opener = $("[data-filters]");
  let sheetDialog = null;
  const narrow = matchMedia("(max-width: 639px)");
  opener.addEventListener("click", () => {
    sheetDialog = openDialog(sheet, opener, () => narrow.matches
      ? [{ transform: "none", opacity: 1 }, { transform: "translateY(40px)", opacity: 0 }]
      : [{ transform: "none", opacity: 1 }, { transform: "translateX(32px)", opacity: 0 }]);
  });
  $("[data-sheet-close]").addEventListener("click", () => sheetDialog?.close());
  $("[data-sheet-clear]").addEventListener("click", () => go({ sort: values.sort }));
  $("[data-sheet-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    go({ ...values, type: form.get("type"), person: form.get("person") ?? undefined, month: form.get("month") });
  });

  for (const link of $$("[data-page-link]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      sessionStorage.setItem(PAGED, "1");
      location.replace(link.href);
    });
  }
  queue.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open]");
    if (open) sessionStorage.setItem(RETURN_TO, open.dataset.open);
    const expand = event.target.closest("[data-expand]");
    if (!expand) return;
    const opening = expand.getAttribute("aria-expanded") !== "true";
    for (const other of $$("[data-expand]", queue)) {
      other.setAttribute("aria-expanded", "false");
      $(`[data-more="${other.dataset.expand}"]`).hidden = true;
    }
    if (opening) {
      expand.setAttribute("aria-expanded", "true");
      $(`[data-more="${expand.dataset.expand}"]`).hidden = false;
    }
  });

  const caption = $("[data-caption]");
  const pagerText = $("[data-pager-text]");
  const busy = $("[data-busy]");

  /** Read the counts again with the page's own query; a failed read replaces the table panel. */
  queue.reread = async () => {
    busy.hidden = false;
    say("Loading requests", { quiet: true });
    const query = queue.dataset.queue;
    const answer = await call("GET", query ? `/api/requests?${query}` : "/api/requests");
    busy.hidden = true;
    if (!answer.ok) {
      const panel = $("[data-table-panel]");
      const message = document.createElement("p");
      message.textContent = QUEUE_FAILED;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => location.reload());
      const box = document.createElement("div");
      box.className = "empty";
      box.append(message, retry);
      panel.replaceChildren(box);
      write(polite, "");
      return null;
    }
    const { matched, total, page, pages } = answer.data;
    caption.textContent = `${matched} of ${total} requests`;
    pagerText.textContent = `Page ${page} of ${pages}`;
    say(caption.textContent, { quiet: true });
    return answer.data;
  };

  const arrive = () => {
    const back = sessionStorage.getItem(RETURN_TO);
    if (path === "/requests" && back) {
      sessionStorage.removeItem(RETURN_TO);
      ($(`[data-open="${back}"]`) ?? heading).focus();
    }
  };
  addEventListener("pageshow", (event) => {
    if (event.persisted) arrive();
  });
  arrive();
  queue.reread().then((counts) => {
    if (counts && sessionStorage.getItem(PAGED)) {
      sessionStorage.removeItem(PAGED);
      heading.focus();
      say(`Page ${counts.page} of ${counts.pages}`, { quiet: true });
    }
  });
}

/* The detail pane: decisions and withdrawals change nothing until the server answers. */

function settleRow(row, fresh) {
  if (!row || !fresh) return;
  const cells = [...row.cells];
  [...fresh.cells].forEach((cell, index) => {
    if (index > 0) cells[index].innerHTML = cell.innerHTML;
  });
  const chip = $(".chip", cells[0]);
  const next = $(".chip", fresh.cells[0]);
  if (chip.dataset.state !== next.dataset.state) {
    chip.replaceWith(next);
    if (!reduced.matches) next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.4,0,.2,1)" });
  }
  row.dataset.state = fresh.dataset.state;
}

/** The server's drawing of a row; a decided row may have left this page's order, so it is found by its own query. */
async function freshRow(id, page) {
  const here = $(`tr[data-request="${id}"]`, page);
  if (here) return here;
  const detail = await call("GET", `/api/requests/${id}`);
  if (!detail.ok) return null;
  const { request } = detail.data;
  const values = { state: request.state, person: request.work_address, month: request.day.slice(0, 7), sort: "day" };
  for (let n = 1, pages = 1; n <= pages; n += 1) {
    const read = await call("GET", queueHref("/api/requests", { ...values, page: String(n) }));
    if (!read.ok) return null;
    pages = read.data.pages;
    if (read.data.rows.some((row) => String(row.id) === id)) {
      const narrowed = await redraw(queueHref(`/requests/${id}`, { ...values, page: String(n) }));
      return narrowed && $(`tr[data-request="${id}"]`, narrowed);
    }
  }
  return null;
}

async function redrawRequest(id) {
  const page = await redraw();
  if (!page) return;
  const fresh = $(`[data-pane="${id}"]`, page);
  settleRow($(`tr[data-request="${id}"]`), await freshRow(id, page));
  const more = $(`[data-more="${id}"]`);
  const freshMore = $(`[data-more="${id}"]`, page);
  if (more && freshMore) more.firstElementChild.innerHTML = freshMore.firstElementChild.innerHTML;
  if (fresh) {
    $("[data-pane]").replaceWith(document.adoptNode(fresh));
    wirePane();
  }
  await queue?.reread();
  $("#pane-title")?.focus();
}

function wirePane() {
  const decision = $("[data-decide]");
  if (decision) {
    const id = decision.dataset.decide;
    const day = $("#pane-title").textContent.replace("Correction for ", "");
    const buttons = $$("[data-outcome]", decision);
    const note = $("#decide-note");
    const refusal = $("[data-inline]", decision);
    for (const button of buttons) {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        for (const b of buttons) b.disabled = true;
        refusal.hidden = true;
        say("Saving decision");
        const outcome = button.dataset.outcome;
        const settle = spin(button);
        const answer = await call("POST", `/api/requests/${id}/decision`, { body: { outcome, note: note.value } });
        settle();
        if (answer.ok || answer.status === 409) {
          shout(answer.ok
            ? outcome === "approve"
              ? `Correction approved. The attendance record for ${day} now reads the claimed times.`
              : "Correction rejected."
            : answer.error);
          await redrawRequest(id);
          return;
        }
        inline(refusal, answer);
        shout(answer.error);
        for (const b of buttons) b.disabled = false;
      });
    }
  }
  const withdrawal = $("[data-withdraw]");
  if (withdrawal) {
    const id = withdrawal.dataset.withdraw;
    const button = $("[data-withdraw-button]", withdrawal);
    const refusal = $("[data-inline]", withdrawal);
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      refusal.hidden = true;
      say("Withdrawing request");
      const settle = spin(button);
      const answer = await call("POST", `/api/requests/${id}/cancel`);
      settle();
      if (answer.ok || answer.status === 409) {
        shout(answer.ok ? "Request withdrawn. That day is free to claim again." : answer.error);
        await redrawRequest(id);
        return;
      }
      inline(refusal, answer);
      shout(answer.error);
      button.disabled = false;
    });
  }
}

if ($("[data-pane]")) {
  wirePane();
  $("#pane-title").focus();
}

/* The draft row: checked cell by cell, sent with one idempotency key for the life of the draft. */

const draft = $("[data-draft-form]");
if (draft) {
  const key = crypto.randomUUID();
  const control = (name) => $(`#draft-${name}`);
  const cell = (name) => $(`[data-field="${name}"]`);
  const type = control("correction_type");
  const reason = control("reason");
  const count = $("[data-count]");
  const send = $("[data-send]");
  const refusal = document.createElement("p");
  refusal.className = "inline-alert";
  refusal.hidden = true;
  $(".draft-actions", draft).before(refusal);
  const FIELDS = ["day", "correction_type", "claimed_in", "claimed_out", "reason"];

  // At the middle tier the Correction and Claimed columns leave the table, so their fields join the reason beneath.
  const middle = matchMedia("(min-width: 640px) and (max-width: 1023px)");
  const moved = $("[data-draft-moved]", draft);
  const homes = [$("[data-draft] .col-correction"), $("[data-draft] .col-claimed")];
  const fields = homes.map((home) => [...home.children]);
  const place = () => homes.forEach((home, i) => (middle.matches ? moved : home).append(...fields[i]));
  middle.addEventListener("change", place);
  place();

  const showTimes = () => {
    cell("claimed_in").hidden = type.value === "missed_out";
    cell("claimed_out").hidden = type.value === "missed_in";
    $("[data-night-help]").hidden = type.value !== "night_shift";
  };
  type.addEventListener("change", showTimes);
  showTimes();
  reason.addEventListener("input", () => {
    count.textContent = `${graphemeCount(reason.value)} / 280`;
  });

  const mark = (name, message) => {
    const error = $(`#draft-${name}-error`);
    control(name).setAttribute("aria-invalid", String(Boolean(message)));
    error.textContent = message ?? "";
    error.hidden = !message;
  };
  const problem = (name) => {
    if (cell(name).hidden) return null;
    const value = control(name).value.trim();
    if (!value) return "This is required.";
    if (name === "reason" && graphemeCount(value) < 20) return "This needs at least 20 characters.";
    return null;
  };
  for (const name of FIELDS) {
    control(name).addEventListener("blur", () => mark(name, problem(name)));
    control(name).addEventListener("input", () => {
      if (control(name).getAttribute("aria-invalid") === "true" && !problem(name)) mark(name, null);
    });
  }

  draft.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (send.disabled) return;
    const invalid = FIELDS.filter((name) => {
      const message = problem(name);
      mark(name, message);
      return message;
    });
    if (invalid.length) {
      control(invalid[0]).focus();
      shout(`Fields needing attention: ${invalid.length}.`);
      return;
    }
    send.disabled = true;
    refusal.hidden = true;
    say("Sending for approval");
    const time = (name) => (cell(name).hidden ? null : control(name).value);
    const settle = spin(send);
    const answer = await call("POST", "/api/requests", {
      headers: { "Idempotency-Key": key },
      body: {
        day: control("day").value,
        correction_type: type.value,
        claimed_in: time("claimed_in"),
        claimed_out: time("claimed_out"),
        reason: reason.value,
      },
    });
    settle();
    if (answer.ok) {
      carry("alert", `Correction for ${answer.data.day} is waiting for a decision.`);
      sessionStorage.setItem(RETURN_TO, String(answer.data.id));
      location.assign(queueHref("/requests", queueValues(location.search)));
      return;
    }
    send.disabled = false;
    inline(refusal, answer);
    shout(answer.error);
    if (answer.field && FIELDS.includes(answer.field)) {
      mark(answer.field, answer.error);
      control(answer.field).focus();
    }
  });
}

/* Sharing a month: mint a link for the person and month the grid shows, show it once, revoke it. */

const share = $("[data-share]");
if (share) {
  const shared = $("[data-shared]");
  const field = $("#shared-link");
  const revoke = $("[data-revoke]");
  const refusal = $("[data-share-refusal]");
  const base = share.dataset.publicUrl ?? location.origin;
  let link = null;

  const clear = () => {
    link = null;
    field.value = "";
    shared.hidden = true;
  };

  share.addEventListener("click", async () => {
    if (share.disabled) return;
    share.disabled = true;
    refusal.hidden = true;
    say("Creating shared link");
    const settle = spin(share);
    const answer = await call("POST", "/api/share-links", {
      body: { person_id: Number(share.dataset.share), month: share.dataset.month },
    });
    settle();
    share.disabled = false;
    if (!answer.ok) {
      inline(refusal, answer);
      shout(answer.error);
      return;
    }
    link = answer.data;
    field.value = `${base}/share/${link.token}`;
    shared.hidden = false;
    if (!reduced.matches) shared.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.4,0,.2,1)" });
    field.focus();
    field.select();
    const expires = `${businessDate(link.expires_at)} ${clockOf(link.expires_at)}`;
    shout(`Shared link created. It works until ${expires}. Any earlier link for this month no longer works.`);
  });

  revoke.addEventListener("click", async () => {
    if (revoke.disabled || !link) return;
    revoke.disabled = true;
    refusal.hidden = true;
    say("Revoking link");
    const settle = spin(revoke);
    const answer = await call("DELETE", `/api/share-links/${link.id}`);
    settle();
    revoke.disabled = false;
    if (answer.ok) {
      clear();
      shout("Shared link revoked.");
      share.focus();
      return;
    }
    if (answer.status === 409) {
      clear();
      share.focus();
    }
    inline(refusal, answer);
    shout(answer.error);
  });
}

/* The policy form: remembers the version it changes and sends it as If-Match. */

const policy = $("[data-policy]");
if (policy) {
  let version = Number(policy.dataset.version);
  const save = $("[data-save]");
  const confirm = $("[data-confirm]");
  const confirmSave = $("[data-confirm-save]");
  const colleague = $("[data-colleague]");
  const boxes = $$("input[name=enabled_types]", policy);
  const FIELD_CONTROLS = {
    monthly_cap: ["policy-cap", [$("#policy-cap")]],
    lookback_days: ["policy-lookback", [$("#policy-lookback")]],
    enabled_types: ["policy-types", [$("#policy-types"), ...boxes]],
    require_note_on_approve: ["policy-note", [$("#policy-note")]],
    self_approval_allowed: ["policy-self", [$("#policy-self")]],
  };
  let dialog = null;

  const clearMarks = () => {
    for (const [id, controls] of Object.values(FIELD_CONTROLS)) {
      for (const el of controls) el.removeAttribute("aria-invalid");
      $(`#${id}-error`).hidden = true;
    }
  };
  const markField = (field, message) => {
    const [id, controls] = FIELD_CONTROLS[field];
    for (const el of controls) el.setAttribute("aria-invalid", "true");
    const error = $(`#${id}-error`);
    error.textContent = message;
    error.hidden = false;
    (field === "enabled_types" ? boxes[0] : controls[0]).focus();
  };
  const reread = async () => {
    const page = await redraw("/policy");
    if (!page) return;
    for (const part of ["[data-history]", "[data-whole-trail]"]) $(part).replaceWith(document.adoptNode($(part, page)));
    $("[data-footer-version]").textContent = $("[data-footer-version]", page).textContent;
  };
  const number = (input) => (input.value === "" ? null : Number(input.value));

  save.addEventListener("click", () => {
    $("[data-next-version]", confirm).textContent = String(version + 1);
    dialog = openDialog(confirm, save);
  });
  $("[data-keep]", confirm).addEventListener("click", () => dialog?.close());
  confirmSave.addEventListener("click", async () => {
    if (confirmSave.disabled) return;
    confirmSave.disabled = true;
    clearMarks();
    colleague.hidden = true;
    say("Saving policy");
    const settle = spin(confirmSave);
    const answer = await call("PUT", "/api/policy", {
      headers: { "If-Match": `"${version}"` },
      body: {
        monthly_cap: number($("#policy-cap")),
        lookback_days: number($("#policy-lookback")),
        enabled_types: boxes.filter((box) => box.checked).map((box) => box.value),
        require_note_on_approve: $("#policy-note").checked,
      },
    });
    settle();
    confirmSave.disabled = false;
    await dialog.close();
    if (answer.ok) {
      version = answer.data.version;
      $("[data-footer-version]").textContent = String(version);
      shout(`Policy version ${version} is now in force.`);
      await reread();
      save.focus();
      return;
    }
    shout(answer.error);
    if (answer.status === 412) {
      const current = await call("GET", "/api/policy");
      if (current.ok) {
        version = current.data.version;
        colleague.textContent = `Version ${version} was saved by ${current.data.created_by}. Your changes are still in the form.`;
        colleague.hidden = false;
      }
      await reread();
    }
    if (answer.status === 400 && answer.field in FIELD_CONTROLS) markField(answer.field, answer.error);
    else save.focus();
  });
}
