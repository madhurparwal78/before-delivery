/* Relayo: staff sign-in, the application queue and deciding once. */
(function () {
  "use strict";

  const TOKEN_KEY = "relayo:review-token";
  const WHITE_SPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

  const STATUSES = ["pending", "approved", "rejected"];
  const STATUS_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  const FIELD_ROWS = [
    ["First name", "first_name"],
    ["Last name", "last_name"],
    ["Work email", "work_email"],
    ["Job title", "job_title"],
    ["Company name", "company_name"],
    ["Website URL", "website"],
    ["Company type", "company_type"],
    ["Number of employees", "employee_band"],
    ["Primary markets served", "markets"],
    ["Primary customer segment", "customer_segment"],
    ["Partnership interests", "partnership_interests"],
    ["Partnership goals", "goals"],
    ["Consent", "consent"],
  ];

  const signinForm = document.getElementById("signin-form");
  if (!signinForm) return;
  const emailField = document.getElementById("email");
  const passwordField = document.getElementById("password");
  const signinButton = document.getElementById("signin-button");
  const reviewApp = document.getElementById("review-app");
  const reviewBody = document.getElementById("review-body");
  const identityLine = document.getElementById("review-identity");
  const signoutButton = document.getElementById("signout-button");
  const alertSlot = document.getElementById("review-alert");
  const statusRegion = document.getElementById("review-status");

  const shell = { built: false, counts: null, queueSlot: null, detailsSlot: null };
  const waits = {};
  let dialog = null;
  let openApplicationId = null;

  /* ---------- copy ---------- */

  function setStatus(text) {
    if (statusRegion) statusRegion.textContent = text;
  }

  function clearAlert() {
    if (alertSlot) alertSlot.replaceChildren();
  }

  function showAlert(text, options) {
    const settings = options || {};
    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alert");
    box.textContent = text;
    if (settings.focus) box.setAttribute("tabindex", "-1");
    alertSlot.replaceChildren(box);
    if (settings.focus) box.focus();
    return box;
  }

  /* ---------- token, kept to this tab ---------- */

  function token() {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY);
    } catch (error) {
      return null;
    }
  }

  function keepToken(value) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, value);
    } catch (error) {
      /* without session storage the staff member stays signed in for this page only */
    }
  }

  function dropToken() {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* nothing stored */
    }
  }

  function emailKey(value) {
    return String(value).normalize("NFC").replace(WHITE_SPACE, "").toLowerCase();
  }

  /* ---------- the address ---------- */

  function readView() {
    const url = new URL(window.location.href);
    const rawStatus = url.searchParams.get("status");
    const rawSort = url.searchParams.get("sort");
    const status = STATUSES.indexOf(rawStatus) === -1 ? "pending" : rawStatus;
    const sort = rawSort === "reply_due" ? "reply_due" : "submitted";
    const rewrite =
      (rawStatus !== null && STATUSES.indexOf(rawStatus) === -1) ||
      (rawSort !== null && rawSort !== "reply_due");
    return { status: status, sort: sort, rewrite: rewrite };
  }

  function viewAddress(status, sort) {
    const query = new URLSearchParams({ status: status });
    if (sort === "reply_due") query.set("sort", "reply_due");
    return "/review?" + query.toString();
  }

  function rewriteAddress() {
    // An unknown value is dropped from the address, replacing this history entry.
    const url = new URL(window.location.href);
    if (STATUSES.indexOf(url.searchParams.get("status")) === -1) url.searchParams.delete("status");
    if (url.searchParams.get("sort") !== "reply_due") url.searchParams.delete("sort");
    const text = url.searchParams.toString();
    window.history.replaceState({}, "", text ? "/review?" + text : "/review");
  }

  /* ---------- requests ---------- */

  async function call(path, options) {
    const settings = options || {};
    const headers = { Accept: "application/json" };
    const bearer = token();
    if (bearer) headers.Authorization = "Bearer " + bearer;
    if (settings.body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method: settings.method || "GET",
      headers: headers,
      body: settings.body ? JSON.stringify(settings.body) : undefined,
    });
    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
    }
    return { status: response.status, payload: payload, headers: response.headers };
  }

  function handleCommonFailure(answer) {
    if (answer.status === 401) {
      dropToken();
      showSignIn();
      setStatus("Your session has ended. Sign in again.");
      return true;
    }
    if (answer.status === 403) {
      withdrawAccess();
      return true;
    }
    if (answer.status >= 500) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return true;
    }
    return false;
  }

  /* ---------- sign in and out ---------- */

  function showSignIn() {
    reviewApp.hidden = true;
    signinForm.hidden = false;
    shell.built = false;
    if (reviewBody) reviewBody.replaceChildren();
    closeDialog(false);
  }

  function showSignedIn(email) {
    signinForm.hidden = true;
    reviewApp.hidden = false;
    if (identityLine) identityLine.textContent = email ? "Signed in as " + email : "";
  }

  function countdown(key, seconds) {
    const wait = { left: seconds, timer: null, box: null };
    waits[key] = wait;

    function tick() {
      wait.left -= 1;
      if (wait.left <= 0) {
        window.clearInterval(wait.timer);
        delete waits[key];
        if (emailKey(emailField.value) === key) {
          clearAlert();
          setStatus("You can sign in again.");
          setSignInDisabled(false);
        }
        return;
      }
      if (emailKey(emailField.value) === key) renderWait(wait);
    }

    wait.timer = window.setInterval(tick, 1000);
    renderWait(wait);
  }

  function waitCopy(seconds) {
    const unit = seconds === 1 ? "1 second" : seconds + " seconds";
    return "Too many sign-in attempts. Try again in " + unit + ".";
  }

  function renderWait(wait) {
    showAlert(waitCopy(wait.left));
    setSignInDisabled(true);
  }

  function setSignInDisabled(disabled) {
    if (!signinButton) return;
    if (disabled) signinButton.setAttribute("aria-disabled", "true");
    else signinButton.removeAttribute("aria-disabled");
  }

  function activeWait() {
    return waits[emailKey(emailField.value)];
  }

  emailField.addEventListener("input", function () {
    const wait = activeWait();
    if (wait) {
      renderWait(wait);
    } else {
      clearAlert();
      setSignInDisabled(false);
    }
  });

  signinForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (signinButton.getAttribute("aria-disabled") === "true") return;
    const email = emailField.value;
    const password = passwordField.value;
    clearAlert();
    setStatus("Signing in…");

    let answer;
    try {
      answer = await call("/api/auth/login", {
        method: "POST",
        body: { email: email, password: password },
      });
    } catch (error) {
      setStatus("");
      showAlert("Sign-in is unavailable right now. Try again in a minute.");
      return;
    }

    if (answer.status === 200 && answer.payload && answer.payload.access_token) {
      keepToken(answer.payload.access_token);
      setStatus("");
      showSignedIn(emailKey(email));
      const view = readView();
      if (view.rewrite) rewriteAddress();
      await loadQueue(view);
      return;
    }
    setStatus("");
    if (answer.status === 429) {
      const retryAfter = Number(answer.headers.get("Retry-After") || "1");
      countdown(emailKey(email), Math.max(1, retryAfter));
      return;
    }
    if (answer.status === 401) {
      showAlert("That email and password don't match.");
      return;
    }
    if (answer.status === 422) {
      showAlert("That email and password don't match.");
      return;
    }
    showAlert("Sign-in is unavailable right now. Try again in a minute.");
  });

  signoutButton.addEventListener("click", async function () {
    let answer;
    try {
      answer = await call("/api/auth/logout", { method: "POST" });
    } catch (error) {
      showAlert("Sign-out is unavailable right now. Try again in a minute.");
      return;
    }
    if (answer.status === 204 || answer.status === 401) {
      dropToken();
      clearAlert();
      showSignIn();
      setStatus("You have signed out.");
      emailField.focus();
      return;
    }
    showAlert("Sign-out is unavailable right now. Try again in a minute.");
  });

  /* ---------- access withdrawn ---------- */

  function withdrawAccess() {
    shell.built = false;
    shell.counts = null;
    shell.queueSlot = null;
    shell.detailsSlot = null;
    openApplicationId = null;
    closeDialog(false);
    if (reviewBody) reviewBody.replaceChildren();
    signinForm.hidden = true;
    reviewApp.hidden = false;
    showAlert("Your account does not have access to partner applications.", { focus: true });
  }

  /* ---------- the queue ---------- */

  function buildShell(view) {
    reviewBody.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "review-toolbar";

    const statusNav = document.createElement("nav");
    statusNav.className = "filter-nav";
    statusNav.setAttribute("aria-label", "Application status");
    STATUSES.forEach(function (name) {
      const link = document.createElement("a");
      link.href = viewAddress(name, view.sort);
      link.textContent = STATUS_LABELS[name];
      link.setAttribute("data-status", name);
      statusNav.append(link);
    });

    const orderNav = document.createElement("nav");
    orderNav.className = "filter-nav";
    orderNav.setAttribute("aria-label", "Queue order");
    [["submitted", "Newest first"], ["reply_due", "Reply due first"]].forEach(function (pair) {
      const link = document.createElement("a");
      link.href = viewAddress(view.status, pair[0]);
      link.textContent = pair[1];
      link.setAttribute("data-sort", pair[0]);
      orderNav.append(link);
    });

    const counts = document.createElement("p");
    counts.className = "results";
    counts.setAttribute("role", "status");
    counts.setAttribute("aria-label", "Queue counts");

    toolbar.append(orderNav, statusNav, counts);

    const layout = document.createElement("div");
    layout.className = "review-layout";
    const queueSlot = document.createElement("div");
    queueSlot.className = "queue-side";
    const detailsSlot = document.createElement("div");
    layout.append(queueSlot, detailsSlot);

    reviewBody.append(toolbar, layout);

    statusNav.addEventListener("click", function (event) {
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      goToView({ status: link.getAttribute("data-status"), sort: currentView.sort });
    });
    orderNav.addEventListener("click", function (event) {
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      goToView({ status: currentView.status, sort: link.getAttribute("data-sort") });
    });

    shell.built = true;
    shell.counts = counts;
    shell.queueSlot = queueSlot;
    shell.detailsSlot = detailsSlot;
    shell.statusNav = statusNav;
    shell.orderNav = orderNav;
  }

  function markView(view) {
    Array.prototype.forEach.call(shell.statusNav.querySelectorAll("a"), function (link) {
      const chosen = link.getAttribute("data-status") === view.status;
      link.href = viewAddress(link.getAttribute("data-status"), view.sort);
      if (chosen) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    Array.prototype.forEach.call(shell.orderNav.querySelectorAll("a"), function (link) {
      const chosen = link.getAttribute("data-sort") === view.sort;
      link.href = viewAddress(view.status, link.getAttribute("data-sort"));
      if (chosen) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  let currentView = { status: "pending", sort: "submitted" };

  function goToView(view) {
    window.history.pushState({}, "", viewAddress(view.status, view.sort));
    loadQueue(view);
  }

  function berlinStamp(iso) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    function part(type) {
      const found = parts.find(function (entry) {
        return entry.type === type;
      });
      return found ? found.value : "";
    }
    return (
      part("year") + "-" + part("month") + "-" + part("day") + " " +
      part("hour") + ":" + part("minute") + " Berlin"
    );
  }

  function statusPill(status) {
    const pill = document.createElement("span");
    pill.className = "status-pill status-" + status;
    pill.textContent = STATUS_LABELS[status];
    return pill;
  }

  function cell(row, label, content) {
    const td = document.createElement("td");
    td.setAttribute("data-label", label);
    if (typeof content === "string") td.textContent = content;
    else td.append(content);
    row.append(td);
    return td;
  }

  function renderQueue(items, view) {
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "queue-empty";
      empty.setAttribute("tabindex", "-1");
      empty.textContent = "No applications in this view.";
      shell.queueSlot.replaceChildren(empty);
      return empty;
    }

    const table = document.createElement("table");
    table.className = "queue-table";
    const caption = document.createElement("caption");
    caption.textContent = "Partner applications";
    caption.setAttribute("tabindex", "-1");
    table.append(caption);

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Company", "Applicant", "Work email", "Submitted", "Reply due", "Status", "Decision"]
      .forEach(function (name) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = name;
        headRow.append(th);
      });
    head.append(headRow);
    const body = document.createElement("tbody");

    items.forEach(function (item) {
      const row = document.createElement("tr");
      const companyLink = document.createElement("a");
      companyLink.href = "#application-" + item.id;
      companyLink.textContent = item.company_name;
      companyLink.addEventListener("click", function (event) {
        event.preventDefault();
        openApplication(item.id);
      });
      cell(row, "Company", companyLink);
      cell(row, "Applicant", item.first_name + " " + item.last_name);
      cell(row, "Work email", item.work_email);
      cell(row, "Submitted", berlinStamp(item.created_at)).className = "submitted";
      cell(row, "Reply due", berlinStamp(item.reply_due_at)).className = "reply-due";
      cell(row, "Status", statusPill(item.status));
      const actions = document.createElement("div");
      actions.className = "row-actions";
      if (item.status === "pending") {
        [["approve", "Approve"], ["reject", "Reject"]].forEach(function (pair) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "pill " + (pair[0] === "approve" ? "pill-solid" : "pill-ghost");
          button.textContent = pair[1] + " " + item.company_name;
          button.addEventListener("click", function () {
            openDialog(item, pair[0], button);
          });
          actions.append(button);
        });
      }
      const actionCell = cell(row, "Decision", actions);
      actionCell.className = "row-actions-cell";
      body.append(row);
    });

    table.append(head, body);
    shell.queueSlot.replaceChildren(table);
    return caption;
  }

  async function loadQueue(view, options) {
    const settings = options || {};
    currentView = { status: view.status, sort: view.sort };
    const query = new URLSearchParams({ status: view.status });
    if (view.sort === "reply_due") query.set("sort", "reply_due");

    let answer;
    try {
      answer = await call("/api/review/partner-applications?" + query.toString());
    } catch (error) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }
    if (handleCommonFailure(answer)) return;
    if (answer.status !== 200) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }

    showSignedIn(null);
    if (!shell.built) buildShell(currentView);
    markView(currentView);
    const counts = answer.payload.counts;
    shell.counts.textContent =
      counts.pending + " pending, " + counts.approved + " approved, " +
      counts.rejected + " rejected";
    const landing = renderQueue(answer.payload.items, currentView);
    if (settings.focusQueue && landing) landing.focus();
    if (openApplicationId !== null) {
      const stillListed = answer.payload.items.some(function (item) {
        return item.id === openApplicationId;
      });
      await openApplication(openApplicationId, { keepFocus: true, silent: !stillListed });
    }
  }

  /* ---------- details ---------- */

  function detailRow(list, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }

  function renderDetails(application) {
    const panel = document.createElement("section");
    panel.className = "details-panel";
    panel.setAttribute("aria-label", "Application details");
    const heading = document.createElement("h2");
    heading.textContent = "Application details";
    heading.setAttribute("tabindex", "-1");
    const list = document.createElement("dl");
    FIELD_ROWS.forEach(function (pair) {
      const value = application[pair[1]];
      detailRow(
        list,
        pair[0],
        Array.isArray(value) ? value.join(", ") : String(value)
      );
    });
    detailRow(list, "Status", STATUS_LABELS[application.status]);
    detailRow(list, "Submitted", berlinStamp(application.created_at));
    detailRow(list, "Reply due", berlinStamp(application.reply_due_at));
    detailRow(list, "Reviewer", application.reviewer === null ? "—" : application.reviewer);
    detailRow(
      list,
      "Decision time",
      application.decided_at === null ? "—" : berlinStamp(application.decided_at)
    );
    detailRow(
      list,
      "Internal note",
      application.decision_note === null ? "—" : application.decision_note
    );
    panel.append(heading, list);
    if (application.outcome_email_status !== null) {
      const line = document.createElement("p");
      line.textContent =
        "Outcome email: " + (application.outcome_email_status === "sent" ? "Sent" : "Queued");
      panel.append(line);
    }
    shell.detailsSlot.replaceChildren(panel);
    return heading;
  }

  async function openApplication(id, options) {
    const settings = options || {};
    let answer;
    try {
      answer = await call("/api/review/partner-applications/" + id);
    } catch (error) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }
    if (handleCommonFailure(answer)) return;
    if (answer.status !== 200) {
      if (!settings.silent) {
        showAlert("Partner applications are unavailable right now. Try again in a minute.");
      }
      return;
    }
    openApplicationId = id;
    const heading = renderDetails(answer.payload);
    if (!settings.keepFocus) heading.focus();
  }

  /* ---------- decisions ---------- */

  function closeDialog(returnFocus) {
    if (!dialog) return;
    const opener = dialog.opener;
    dialog.backdrop.remove();
    dialog = null;
    if (returnFocus && opener && document.contains(opener)) opener.focus();
  }

  function openDialog(application, decision, opener) {
    closeDialog(false);
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const title = decision === "approve" ? "Approve application" : "Reject application";
    box.setAttribute("aria-label", title);

    const heading = document.createElement("h2");
    heading.textContent = title;
    const company = document.createElement("p");
    company.textContent = application.company_name;

    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.setAttribute("for", "internal-note");
    label.textContent = "Internal note";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.id = "internal-note-hint";
    hint.textContent = "Up to 1000 characters. Never sent to the applicant.";
    const note = document.createElement("textarea");
    note.id = "internal-note";
    note.rows = 4;
    note.setAttribute("aria-describedby", "internal-note-hint internal-note-error");
    const noteError = document.createElement("p");
    noteError.className = "field-error";
    noteError.id = "internal-note-error";
    noteError.setAttribute("aria-live", "polite");
    field.append(label, hint, note, noteError);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "pill pill-solid";
    confirm.textContent = "Confirm";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pill pill-ghost";
    cancel.textContent = "Cancel";
    actions.append(confirm, cancel);

    box.append(heading, company, field, actions);
    backdrop.append(box);
    document.body.append(backdrop);
    dialog = { backdrop: backdrop, box: box, opener: opener, note: note, error: noteError };
    note.focus();

    cancel.addEventListener("click", function () {
      closeDialog(true);
    });
    backdrop.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeDialog(true);
        return;
      }
      if (event.key !== "Tab") return;
      const stops = box.querySelectorAll("textarea, button");
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    confirm.addEventListener("click", function () {
      decide(application, decision, note.value);
    });
  }

  async function decide(application, decision, noteText) {
    setStatus("Saving decision…");
    let answer;
    try {
      answer = await call(
        "/api/review/partner-applications/" + application.id + "/decision",
        { method: "POST", body: { decision: decision, note: noteText } }
      );
    } catch (error) {
      setStatus("");
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }

    if (answer.status === 422 && answer.payload && answer.payload.errors &&
        answer.payload.errors.note) {
      setStatus("");
      if (dialog) dialog.error.textContent = answer.payload.errors.note;
      return;
    }

    closeDialog(false);
    if (handleCommonFailure(answer)) {
      setStatus("");
      return;
    }
    if (answer.status === 409) {
      setStatus("");
      showAlert("This application was already decided.");
      await loadQueue(currentView);
      return;
    }
    if (answer.status !== 200) {
      setStatus("");
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }

    setStatus(
      decision === "approve"
        ? "Application approved. The applicant will be emailed."
        : "Application rejected. The applicant will be emailed."
    );
    clearAlert();
    await loadQueue(currentView, { focusQueue: true });
  }

  /* ---------- start ---------- */

  window.addEventListener("popstate", function () {
    if (!token()) return;
    const view = readView();
    if (view.rewrite) rewriteAddress();
    loadQueue(view);
  });

  (function start() {
    const view = readView();
    if (view.rewrite) rewriteAddress();
    if (!token()) {
      showSignIn();
      return;
    }
    showSignedIn(null);
    loadQueue(view);
  })();
})();
