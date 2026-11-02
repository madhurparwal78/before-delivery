/* The partner application form: a tab-scoped draft, an Idempotency-Key per
   attempt, in-place validation messages and the error summary of named
   links. */
(function () {
  "use strict";

  var form = document.getElementById("partner-form");
  if (!form) { return; }

  function byId(id) { return document.getElementById(id); }

  var DRAFT_KEY = "relayo-partner-draft";
  var IDEMPOTENCY_KEY = "relayo-partner-key";
  var FIELDS = [
    { name: "first_name", label: "First name", type: "text" },
    { name: "last_name", label: "Last name", type: "text" },
    { name: "work_email", label: "Work email", type: "text" },
    { name: "job_title", label: "Job title", type: "text" },
    { name: "company_name", label: "Company name", type: "text" },
    { name: "website", label: "Website URL", type: "text" },
    { name: "company_type", label: "Company type", type: "select" },
    { name: "employee_band", label: "Number of employees", type: "select" },
    { name: "markets", label: "Primary markets served", type: "group" },
    { name: "customer_segment", label: "Primary customer segment",
      type: "select" },
    { name: "partnership_interests", label: "Partnership interests",
      type: "group" },
    { name: "goals", label: "Partnership goals", type: "textarea" },
    { name: "consent",
      label: "I consent to Relayo contacting me about this application.",
      type: "checkbox" },
  ];

  var status = byId("form-status");
  var alertBox = byId("form-alert");
  var received = byId("application-received");
  var receivedThanks = byId("received-thanks");
  var submitButton = byId("submit-application");
  var goalsField = byId("goals");
  var goalsCount = byId("goals-count");
  var GOALS_LIMIT = 2000;

  var submitting = false;
  var idempotencyKey = null;

  /* The counting rule: code points after trimming Unicode white space and
     NFC normalisation, exactly as the server counts. */

  function trim(value) {
    var edges = new RegExp(
      "^[\\t-\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a" +
      "\\u2028\\u2029\\u202f\\u205f\\u3000]+|" +
      "[\\t-\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a" +
      "\\u2028\\u2029\\u202f\\u205f\\u3000]+$", "g"
    );
    return value.replace(edges, "");
  }

  function normalise(value) {
    return trim(value).normalize("NFC");
  }

  function countGoals() {
    return Array.from(normalise(goalsField.value)).length;
  }

  function updateCounter() {
    goalsCount.textContent = countGoals() + " / " + GOALS_LIMIT;
  }

  /* Draft: the thirteen values and the attempt's key, in this tab's session
     storage only. */

  function values() {
    var payload = {};
    FIELDS.forEach(function (field) {
      if (field.type === "group") {
        payload[field.name] = Array.prototype.slice.call(
          form.querySelectorAll('input[name="' + field.name + '"]:checked')
        ).map(function (box) { return box.value; });
      } else if (field.type === "checkbox") {
        payload[field.name] = byId("consent").checked;
      } else {
        payload[field.name] = byId(field.name).value;
      }
    });
    return payload;
  }

  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values()));
      if (idempotencyKey) {
        sessionStorage.setItem(IDEMPOTENCY_KEY, idempotencyKey);
      }
    } catch (err) { /* storage unavailable */ }
  }

  function dropKey() {
    idempotencyKey = null;
    try { sessionStorage.removeItem(IDEMPOTENCY_KEY); } catch (err) {}
  }

  function eraseDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(IDEMPOTENCY_KEY);
    } catch (err) { /* storage unavailable */ }
  }

  function restoreDraft() {
    var raw = null;
    try { raw = sessionStorage.getItem(DRAFT_KEY); } catch (err) { raw = null; }
    if (!raw) { return; }
    var draft = null;
    try { draft = JSON.parse(raw); } catch (err) { draft = null; }
    if (!draft) { return; }
    FIELDS.forEach(function (field) {
      var value = draft[field.name];
      if (field.type === "group") {
        Array.prototype.slice.call(
          form.querySelectorAll('input[name="' + field.name + '"]')
        ).forEach(function (box) {
          box.checked = Array.isArray(value) && value.indexOf(box.value) !== -1;
        });
      } else if (field.type === "checkbox") {
        byId("consent").checked = value === true;
      } else if (value !== undefined && value !== null) {
        byId(field.name).value = value;
      }
    });
    var key = null;
    try { key = sessionStorage.getItem(IDEMPOTENCY_KEY); } catch (err) {}
    idempotencyKey = key;
    updateCounter();
  }

  form.addEventListener("input", function (event) {
    if (event.target.name === "goals") { updateCounter(); }
    if (idempotencyKey) { dropKey(); }
    saveDraft();
  });
  form.addEventListener("change", function (event) {
    if (idempotencyKey) { dropKey(); }
    saveDraft();
  });

  /* Validation display */

  function fieldControl(field) {
    if (field.type === "group") {
      return byId(field.name === "markets" ? "market-1" : "interest-1");
    }
    if (field.type === "checkbox") { return byId("consent"); }
    return byId(field.name);
  }

  function fieldMessage(field) { return byId(field.name + "-error"); }

  function clearErrors() {
    FIELDS.forEach(function (field) {
      var control = fieldControl(field);
      var message = fieldMessage(field);
      if (control) { control.removeAttribute("aria-invalid"); }
      if (message) { message.hidden = true; message.textContent = ""; }
    });
    alertBox.hidden = true;
    alertBox.textContent = "";
  }

  function showErrors(errors) {
    var failing = [];
    FIELDS.forEach(function (field) {
      var message = errors[field.name];
      if (!message) { return; }
      failing.push({ field: field, message: message });
    });
    failing.forEach(function (entry) {
      var control = fieldControl(entry.field);
      var message = fieldMessage(entry.field);
      if (control) {
        control.setAttribute("aria-invalid", "true");
        if (entry.field.type === "group") {
          control.closest("fieldset").setAttribute("aria-invalid", "true");
        }
      }
      if (message) {
        message.textContent = entry.message;
        message.hidden = false;
        if (control && control.setAttribute) {
          var described = control.getAttribute("aria-describedby") || "";
          var id = message.id;
          if (described.indexOf(id) === -1) {
            control.setAttribute("aria-describedby",
              (described + " " + id).trim());
          }
        }
      }
    });
    /* The error summary: one link per failing field, in form order. */
    alertBox.hidden = false;
    alertBox.className = "alert alert-error form-summary";
    var heading = document.createElement("h2");
    heading.textContent = "Please correct the fields below.";
    var list = document.createElement("ul");
    list.id = "error-summary-list";
    failing.forEach(function (entry) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + entry.field.name;
      link.textContent = entry.field.label + ": " + entry.message;
      link.addEventListener("click", function (event) {
        event.preventDefault();
        focusField(entry.field);
      });
      item.appendChild(link);
      list.appendChild(item);
    });
    alertBox.textContent = "";
    alertBox.appendChild(heading);
    alertBox.appendChild(list);
    if (failing.length) {
      focusField(failing[0].field);
    }
  }

  function focusField(field) {
    var control = fieldControl(field);
    if (!control) { return; }
    control.focus();
    var header = document.querySelector(".site-header");
    var headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    var box = control.getBoundingClientRect();
    var panel = document.getElementById("cookie-panel");
    var panelTop = panel && !panel.hidden ?
      panel.getBoundingClientRect().top : window.innerHeight;
    var top = Math.max(headerBottom + 12, box.top - 12);
    if (box.top < headerBottom + 12 ||
        box.bottom > Math.min(panelTop - 12, window.innerHeight)) {
      window.scrollTo({
        top: window.scrollY + box.top - headerBottom - 12,
        behavior: "auto",
      });
    }
  }

  /* Submission */

  function pending() {
    submitting = true;
    status.textContent = "Submitting your application…";
    submitButton.textContent = "Submitting your application…";
    submitButton.setAttribute("aria-disabled", "true");
  }

  function idle() {
    submitting = false;
    status.textContent = "";
    submitButton.textContent = "Submit application";
    submitButton.setAttribute("aria-disabled", "false");
  }

  function showReceived(companyName) {
    eraseDraft();
    form.hidden = true;
    clearErrors();
    received.hidden = false;
    receivedThanks.textContent = "Thank you, " + companyName + ". Our partner" +
      " team reviews every application and replies by email.";
    byId("received-heading").setAttribute("tabindex", "-1");
    byId("received-heading").focus();
    status.textContent = "";
    idle();
  }

  function newKey() {
    idempotencyKey = (crypto.randomUUID && crypto.randomUUID()) ||
      ("key-" + Date.now() + "-" +
        Math.random().toString(36).slice(2));
    try { sessionStorage.setItem(IDEMPOTENCY_KEY, idempotencyKey); }
    catch (err) { /* storage unavailable */ }
    return idempotencyKey;
  }

  function send() {
    var key = idempotencyKey || newKey();
    pending();
    return fetch("/api/partner-applications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(values()),
    }).then(function (response) {
      return response.json().then(function (payload) {
        return { status: response.status, body: payload,
          replayed: response.headers.get("Idempotent-Replayed") === "true" };
      }).catch(function () {
        return { status: response.status, body: null, replayed: false };
      });
    });
  }

  var inProgressRetries = 0;

  function submit() {
    if (submitting) { return; }
    clearErrors();
    send().then(function (result) {
      if (result.status === 201) {
        showReceived(normalise(byId("company_name").value));
        return;
      }
      idle();
      if (result.status === 422) {
        showErrors(result.body.errors || {});
        saveDraft();
        return;
      }
      if (result.status === 409 &&
          result.body && result.body.error === "duplicate_application") {
        alertBox.hidden = false;
        alertBox.className = "alert alert-error";
        alertBox.textContent = "We already have an application from this work" +
          " email. Our partner team will be in touch.";
        saveDraft();
        return;
      }
      if (result.status === 409 &&
          result.body && result.body.error === "request_in_progress") {
        if (inProgressRetries < 3) {
          inProgressRetries += 1;
          window.setTimeout(function () { submit(); }, 2000);
        }
        return;
      }
      outage();
    }).catch(function () {
      idle();
      outage();
    });
  }

  function outage() {
    alertBox.hidden = false;
    alertBox.className = "alert alert-error";
    alertBox.textContent = "";
    var text = document.createElement("span");
    text.textContent = "We couldn't reach Relayo. Your answers are still here. ";
    var retry = document.createElement("button");
    retry.className = "btn btn-quiet";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", function () {
      clearErrors();
      submit();
    });
    alertBox.appendChild(text);
    alertBox.appendChild(retry);
    saveDraft();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    inProgressRetries = 0;
    submit();
  });

  restoreDraft();
  updateCounter();
}());
