/* The reviewer page: sign-in with its failure limit and countdown, the
   queue with status and order in the address, the details panel and the
   decision dialogs. A 403 clears every applicant detail at once. */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }

  var TOKEN_KEY = "relayo-review-token";
  var signInView = byId("sign-in-view");
  var queueView = byId("queue-view");
  var statusLine = byId("review-status");
  var alertBox = byId("review-alert");
  var signInForm = byId("staff-sign-in");
  var emailField = byId("email");
  var passwordField = byId("password");
  var signInButton = byId("sign-in-button");
  var signOutButton = byId("sign-out");
  var statusNav = byId("status-nav");
  var orderNav = byId("order-nav");
  var countsLine = byId("queue-counts");
  var tableCaption = byId("table-caption");
  var tableBody = byId("applications-body");
  var tableNode = byId("applications-table");
  var queueEmpty = byId("queue-empty");
  var queueOutage = byId("queue-outage");
  var detailsRegion = byId("application-details");
  var detailsCard = byId("details-card");
  var dialog = byId("decision-dialog");
  var dialogTitle = byId("decision-dialog-title");
  var noteField = byId("decision-note");
  var noteError = byId("decision-note-error");
  var confirmButton = byId("decision-confirm");
  var cancelButton = byId("decision-cancel");

  var token = null;
  var state = { status: "pending", sort: "submitted" };
  var decision = null;   // "approve" | "reject"
  var decisionApp = null;
  var dialogOpener = null;
  var waits = {};        // email key -> seconds remaining
  var waitTimer = null;

  /* Alerts and status */

  function setStatus(text) { statusLine.textContent = text || ""; }

  function showAlert(text) {
    alertBox.hidden = false;
    alertBox.className = "alert alert-error";
    alertBox.textContent = text;
  }

  function clearAlert() {
    alertBox.hidden = true;
    alertBox.textContent = "";
  }

  function focusAlert() {
    alertBox.setAttribute("tabindex", "-1");
    alertBox.focus();
  }

  /* Email key, exactly as the server computes it */

  function emailKey(value) {
    return value.normalize("NFC").trim().toLowerCase();
  }

  /* Sign in */

  function tokenHeader() {
    return { "Authorization": "Bearer " + token };
  }

  function showSignIn(message) {
    token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) {}
    queueView.hidden = true;
    signInView.hidden = false;
    setStatus(message || "");
    emailField.focus();
  }

  function signInSubmit(event) {
    event.preventDefault();
    if (signInButton.getAttribute("aria-disabled") === "true") { return; }
    var key = emailKey(emailField.value);
    if (waits[key] !== undefined && waits[key] > 0) { return; }
    setStatus("Signing in…");
    clearAlert();
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailField.value,
        password: passwordField.value,
      }),
    }).then(function (response) {
      if (response.status === 429) {
        var retry = parseInt(response.headers.get("Retry-After") ||
          "1", 10);
        startCountdown(key, retry);
        return null;
      }
      return response.json().then(function (payload) {
        return { status: response.status, body: payload };
      });
    }).then(function (result) {
      if (!result) { return; }
      setStatus("");
      if (result.status === 200 && result.body.access_token) {
        token = result.body.access_token;
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (err) {}
        clearAlert();
        startQueue();
      } else if (result.status === 401) {
        showAlert("That email and password don't match.");
      } else if (result.status === 503) {
        showAlert("Sign-in is unavailable right now. Try again in a minute.");
      } else if (result.status === 422) {
        var messages = [];
        var errors = result.body.errors || {};
        if (errors.email) { messages.push("Email: " + errors.email); }
        if (errors.password) {
          messages.push("Password: " + errors.password);
        }
        showAlert(messages.join(" ") || "Please correct the fields below.");
      }
    }).catch(function () {
      setStatus("");
      showAlert("Sign-in is unavailable right now. Try again in a minute.");
    });
  }

  /* The sign-in wait, counted down on the page's own clock */

  function startCountdown(key, seconds) {
    waits[key] = seconds;
    renderWait(key);
    if (!waitTimer) {
      waitTimer = window.setInterval(function () {
        Object.keys(waits).forEach(function (waitKey) {
          if (waits[waitKey] <= 0) { return; }
          waits[waitKey] -= 1;
          renderWait(waitKey);
        });
      }, 1000);
    }
  }

  function activeKey() {
    return emailKey(emailField.value);
  }

  function renderWait(key) {
    var seconds = waits[key];
    if (seconds === undefined) { return; }
    if (activeKey() !== key) { return; }
    if (seconds <= 0) {
      delete waits[key];
      clearAlert();
      setStatus("You can sign in again.");
      signInButton.setAttribute("aria-disabled", "false");
      return;
    }
    showAlert("Too many sign-in attempts. Try again in " + seconds +
      (seconds === 1 ? " second." : " seconds."));
    signInButton.setAttribute("aria-disabled", "true");
  }

  emailField.addEventListener("input", function () {
    var key = activeKey();
    if (waits[key] !== undefined && waits[key] > 0) {
      renderWait(key);
    } else {
      clearAlert();
      signInButton.setAttribute("aria-disabled", "false");
    }
  });

  signInForm.addEventListener("submit", signInSubmit);

  /* Sign out */

  signOutButton.addEventListener("click", function () {
    fetch("/api/auth/logout", {
      method: "POST",
      headers: tokenHeader(),
    }).then(function (response) {
      if (response.status === 204 || response.status === 401) {
        showSignIn("You have signed out.");
      } else if (response.status === 503) {
        showAlert("Sign-out is unavailable right now. Try again in a minute.");
      }
    }).catch(function () {
      showAlert("Sign-out is unavailable right now. Try again in a minute.");
    });
  });

  /* The queue */

  function addressFor(status, sort) {
    var params = new URLSearchParams();
    if (status) { params.set("status", status); }
    if (sort === "reply_due") { params.set("sort", sort); }
    var query = params.toString();
    return "/review" + (query ? "?" + query : "");
  }

  function readAddress() {
    var params = new URLSearchParams(window.location.search);
    var status = params.get("status");
    var sort = params.get("sort");
    var rewrite = false;
    if (status !== null &&
        ["pending", "approved", "rejected"].indexOf(status) === -1) {
      params.delete("status");
      rewrite = true;
    }
    if (sort !== null && sort !== "reply_due") {
      params.delete("sort");
      rewrite = true;
    }
    if (rewrite) {
      var query = params.toString();
      window.history.replaceState({}, "",
        "/review" + (query ? "?" + query : ""));
    }
    state.status = (status === "pending" || status === "approved" ||
      status === "rejected") ? status : "pending";
    state.sort = sort === "reply_due" ? "reply_due" : "submitted";
  }

  function markCurrent() {
    statusNav.querySelectorAll("a").forEach(function (link) {
      if (link.getAttribute("data-status") === state.status) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    orderNav.querySelectorAll("a").forEach(function (link) {
      if ((link.getAttribute("data-sort") || "") ===
          (state.sort === "reply_due" ? "reply_due" : "")) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function formatTimestamp(iso) {
    return iso.replace("T", " ").replace("Z", "");
  }

  function berlinTime(iso) {
    /* The reply-due moment as Europe/Berlin wall-clock time. */
    var moment = new Date(iso);
    var parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Berlin",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).format(moment);
    return parts + " Berlin";
  }

  function statusPill(status) {
    var span = document.createElement("span");
    span.className = "status-pill status-" + status;
    span.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    return span;
  }

  function renderQueue(payload) {
    tableBody.textContent = "";
    detailsRegion.hidden = true;
    detailsCard.textContent = "";
    countsLine.textContent = payload.counts.pending + " pending, " +
      payload.counts.approved + " approved, " +
      payload.counts.rejected + " rejected";
    var items = payload.items;
    queueEmpty.hidden = items.length > 0;
    queueOutage.hidden = true;
    if (!items.length) {
      queueEmpty.setAttribute("tabindex", "-1");
    }
    items.forEach(function (application) {
      var row = document.createElement("tr");

      var companyCell = document.createElement("td");
      var companyLink = document.createElement("a");
      companyLink.href = "#";
      companyLink.textContent = application.company_name;
      companyLink.className = "company-link";
      companyLink.addEventListener("click", function (event) {
        event.preventDefault();
        openDetails(application.id);
      });
      companyCell.appendChild(companyLink);
      row.appendChild(companyCell);

      var applicantCell = document.createElement("td");
      applicantCell.textContent = application.first_name + " " +
        application.last_name;
      row.appendChild(applicantCell);

      var emailCell = document.createElement("td");
      emailCell.textContent = application.work_email;
      row.appendChild(emailCell);

      var submittedCell = document.createElement("td");
      submittedCell.className = "mono";
      submittedCell.textContent = formatTimestamp(application.created_at);
      row.appendChild(submittedCell);

      var dueCell = document.createElement("td");
      dueCell.className = "mono";
      dueCell.textContent = berlinTime(application.reply_due_at);
      row.appendChild(dueCell);

      var statusCell = document.createElement("td");
      statusCell.appendChild(statusPill(application.status));
      row.appendChild(statusCell);

      var actionCell = document.createElement("td");
      if (application.status === "pending") {
        var approve = document.createElement("button");
        approve.type = "button";
        approve.className = "btn btn-approve";
        approve.textContent = "Approve " + application.company_name;
        approve.addEventListener("click", function () {
          openDecision("approve", application);
        });
        var reject = document.createElement("button");
        reject.type = "button";
        reject.className = "btn btn-danger";
        reject.textContent = "Reject " + application.company_name;
        reject.addEventListener("click", function () {
          openDecision("reject", application);
        });
        actionCell.appendChild(approve);
        actionCell.appendChild(document.createTextNode(" "));
        actionCell.appendChild(reject);
      }
      row.appendChild(actionCell);
      tableBody.appendChild(row);
    });
    tableNode.hidden = items.length === 0;
  }

  function loadQueue() {
    var params = new URLSearchParams();
    params.set("status", state.status);
    if (state.sort === "reply_due") { params.set("sort", "reply_due"); }
    return fetch("/api/review/partner-applications?" + params.toString(), {
      headers: tokenHeader(),
    }).then(function (response) {
      if (response.status === 401) { throw new Error("session-ended"); }
      if (response.status === 403) { throw new Error("no-access"); }
      if (response.status === 503) { throw new Error("db-down"); }
      if (!response.ok) { throw new Error("failed"); }
      return response.json();
    }).then(function (payload) {
      renderQueue(payload);
    }).catch(function (error) {
      if (error.message === "session-ended") {
        showSignIn("Your session has ended. Sign in again.");
        return;
      }
      if (error.message === "no-access") {
        withdrawAccess();
        return;
      }
      if (error.message === "db-down") {
        queueOutage.hidden = false;
        return;
      }
      queueOutage.hidden = false;
    });
  }

  function startQueue() {
    signInView.hidden = true;
    queueView.hidden = false;
    clearAlert();
    readAddress();
    markCurrent();
    loadQueue();
  }

  /* Status and order links */

  statusNav.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link) { return; }
    event.preventDefault();
    state.status = link.getAttribute("data-status");
    markCurrent();
    window.history.pushState({}, "", addressFor(state.status,
      state.sort === "reply_due" ? "reply_due" : null));
    loadQueue();
  });

  orderNav.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link) { return; }
    event.preventDefault();
    state.sort = link.getAttribute("data-sort") || "submitted";
    markCurrent();
    window.history.pushState({}, "", addressFor(
      state.status === "pending" ? "pending" : state.status,
      state.sort === "reply_due" ? "reply_due" : null));
    loadQueue();
  });

  window.addEventListener("popstate", function () {
    readAddress();
    markCurrent();
    loadQueue();
  });

  /* Details panel */

  function detailsRow(label, value) {
    var row = document.createElement("p");
    row.className = "hint";
    var strong = document.createElement("strong");
    strong.textContent = label + ": ";
    row.appendChild(strong);
    row.appendChild(document.createTextNode(value));
    return row;
  }

  function openDetails(applicationId) {
    fetch("/api/review/partner-applications/" + applicationId, {
      headers: tokenHeader(),
    }).then(function (response) {
      if (response.status === 401) { throw new Error("session-ended"); }
      if (response.status === 403) { throw new Error("no-access"); }
      if (response.status === 503) { throw new Error("db-down"); }
      return response.json();
    }).then(function (application) {
      detailsCard.textContent = "";
      var heading = document.createElement("h2");
      heading.id = "details-heading";
      heading.setAttribute("tabindex", "-1");
      heading.textContent = application.company_name;
      detailsCard.appendChild(heading);
      detailsCard.appendChild(detailsRow("Applicant",
        application.first_name + " " + application.last_name));
      detailsCard.appendChild(detailsRow("Work email",
        application.work_email));
      detailsCard.appendChild(detailsRow("Job title",
        application.job_title));
      detailsCard.appendChild(detailsRow("Website", application.website));
      detailsCard.appendChild(detailsRow("Company type",
        application.company_type));
      detailsCard.appendChild(detailsRow("Number of employees",
        application.employee_band));
      detailsCard.appendChild(detailsRow("Primary markets served",
        application.markets.join(", ")));
      detailsCard.appendChild(detailsRow("Primary customer segment",
        application.customer_segment));
      detailsCard.appendChild(detailsRow("Partnership interests",
        application.partnership_interests.join(", ")));
      var goals = document.createElement("p");
      goals.className = "hint";
      goals.appendChild(document.createTextNode("Partnership goals: "));
      goals.appendChild(document.createTextNode(application.goals));
      detailsCard.appendChild(goals);
      detailsCard.appendChild(detailsRow("Status", application.status));
      detailsCard.appendChild(detailsRow("Reviewer",
        application.reviewer || "—"));
      detailsCard.appendChild(detailsRow("Decision time",
        application.decided_at ?
          formatTimestamp(application.decided_at) : "—"));
      detailsCard.appendChild(detailsRow("Internal note",
        application.decision_note || "—"));
      detailsCard.appendChild(detailsRow("Reply due",
        berlinTime(application.reply_due_at)));
      if (application.status !== "pending") {
        detailsCard.appendChild(detailsRow("Outcome email",
          application.outcome_email_status === "sent" ? "Sent" : "Queued"));
      }
      detailsRegion.hidden = false;
      heading.focus();
    }).catch(function (error) {
      if (error.message === "session-ended") {
        showSignIn("Your session has ended. Sign in again.");
        return;
      }
      if (error.message === "no-access") {
        withdrawAccess();
        return;
      }
      queueOutage.hidden = false;
    });
  }

  /* Decision dialogs */

  function openDecision(kind, application) {
    decision = kind;
    decisionApp = application;
    dialogOpener = document.activeElement;
    dialogTitle.textContent = kind === "approve" ?
      "Approve application" : "Reject application";
    noteField.value = "";
    noteError.hidden = true;
    dialog.hidden = false;
    dialog.classList.add("open");
    noteField.focus();
  }

  function closeDecision() {
    dialog.classList.remove("open");
    dialog.hidden = true;
    decision = null;
    decisionApp = null;
    if (dialogOpener && dialogOpener.focus) { dialogOpener.focus(); }
  }

  cancelButton.addEventListener("click", closeDecision);
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) { closeDecision(); }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !dialog.hidden) {
      closeDecision();
    }
  });
  dialog.addEventListener("keydown", function (event) {
    if (event.key === "Tab") {
      var focusable = [noteField, confirmButton, cancelButton];
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  confirmButton.addEventListener("click", function () {
    if (!decision || !decisionApp) { return; }
    setStatus("Saving decision…");
    fetch("/api/review/partner-applications/" + decisionApp.id + "/decision", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" },
        tokenHeader()),
      body: JSON.stringify({ decision: decision, note: noteField.value }),
    }).then(function (response) {
      if (response.status === 401) { throw new Error("session-ended"); }
      if (response.status === 403) { throw new Error("no-access"); }
      if (response.status === 503) { throw new Error("db-down"); }
      return response.json().then(function (payload) {
        return { status: response.status, body: payload };
      });
    }).then(function (result) {
      if (result.status === 200) {
        var decided = decision;
        var applicationId = decisionApp.id;
        closeDecision();
        setStatus(decided === "approve" ?
          "Application approved. The applicant will be emailed." :
          "Application rejected. The applicant will be emailed.");
        loadQueue().then(function () {
          tableCaption.setAttribute("tabindex", "-1");
          tableCaption.focus();
          if (!tableNode.hidden) {
            openDetails(applicationId);
          }
        });
      } else if (result.status === 409) {
        closeDecision();
        showAlert("This application was already decided.");
        loadQueue();
      } else if (result.status === 422) {
        var note = (result.body.errors || {}).note;
        if (note) {
          noteError.textContent = note;
          noteError.hidden = false;
        }
      }
    }).catch(function (error) {
      if (error.message === "session-ended") {
        closeDecision();
        showSignIn("Your session has ended. Sign in again.");
        return;
      }
      if (error.message === "no-access") {
        closeDecision();
        withdrawAccess();
        return;
      }
      setStatus("");
      showAlert("Partner applications are unavailable right now. Try" +
        " again in a minute.");
    });
  });

  /* Withdrawn access: the page loses every applicant detail at once */

  function withdrawAccess() {
    tableBody.textContent = "";
    tableNode.hidden = true;
    detailsCard.textContent = "";
    detailsRegion.hidden = true;
    countsLine.textContent = "";
    queueEmpty.hidden = true;
    queueOutage.hidden = true;
    statusNav.remove();
    orderNav.remove();
    dialog.classList.remove("open");
    dialog.hidden = true;
    decision = null;
    decisionApp = null;
    setStatus("");
    showAlert("Your account does not have access to partner applications.");
    focusAlert();
    /* The token is kept: a reload asks the server again. */
  }

  /* Boot */

  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (err) { token = null; }

  if (token) {
    startQueue();
  } else {
    signInView.hidden = false;
  }
}());
