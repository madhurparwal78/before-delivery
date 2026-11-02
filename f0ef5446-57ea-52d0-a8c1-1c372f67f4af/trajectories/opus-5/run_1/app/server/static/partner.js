/* Relayo: the partner application form, its draft and its Idempotency-Key. */
(function () {
  "use strict";

  const DRAFT_KEY = "relayo:partner-draft";
  const WHITE_SPACE = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

  const FIELDS = [
    "first_name", "last_name", "work_email", "job_title", "company_name", "website",
    "company_type", "employee_band", "markets", "customer_segment",
    "partnership_interests", "goals", "consent",
  ];

  const FIELD_NAMES = {
    first_name: "First name",
    last_name: "Last name",
    work_email: "Work email",
    job_title: "Job title",
    company_name: "Company name",
    website: "Website URL",
    company_type: "Company type",
    employee_band: "Number of employees",
    markets: "Primary markets served",
    customer_segment: "Primary customer segment",
    partnership_interests: "Partnership interests",
    goals: "Partnership goals",
    consent: "I consent to Relayo contacting me about this application.",
  };

  const TEXT_FIELDS = [
    "first_name", "last_name", "work_email", "job_title", "company_name", "website", "goals",
  ];
  const SELECT_FIELDS = ["company_type", "employee_band", "customer_segment"];
  const LIST_FIELDS = ["markets", "partnership_interests"];

  const form = document.getElementById("partner-form");
  if (!form) return;

  const formSlot = document.getElementById("form-slot");
  const alertSlot = document.getElementById("form-alert");
  const statusRegion = document.getElementById("form-status");
  const counter = document.getElementById("goals-count");
  const goals = document.getElementById("goals");
  const submitButton = document.getElementById("submit-application");
  const received = document.getElementById("received");
  const receivedCompany = document.getElementById("received-company");
  const receivedHeading = document.getElementById("received-heading");

  let draft = { values: null, key: null, keyValues: null };

  /* ---------- the counting rule, as the server counts ---------- */

  function countCodePoints(value) {
    const normalised = String(value).normalize("NFC").replace(WHITE_SPACE, "");
    return Array.from(normalised).length;
  }

  function readValues() {
    const values = {};
    TEXT_FIELDS.forEach(function (name) {
      values[name] = document.getElementById(name).value;
    });
    SELECT_FIELDS.forEach(function (name) {
      values[name] = document.getElementById(name).value;
    });
    LIST_FIELDS.forEach(function (name) {
      values[name] = Array.prototype.map.call(
        form.querySelectorAll('input[name="' + name + '"]:checked'),
        function (box) {
          return box.value;
        }
      );
    });
    values.consent = document.getElementById("consent").checked;
    return values;
  }

  function writeValues(values) {
    TEXT_FIELDS.concat(SELECT_FIELDS).forEach(function (name) {
      if (typeof values[name] === "string") document.getElementById(name).value = values[name];
    });
    LIST_FIELDS.forEach(function (name) {
      const chosen = Array.isArray(values[name]) ? values[name] : [];
      Array.prototype.forEach.call(
        form.querySelectorAll('input[name="' + name + '"]'),
        function (box) {
          box.checked = chosen.indexOf(box.value) !== -1;
        }
      );
    });
    document.getElementById("consent").checked = Boolean(values.consent);
  }

  function saveDraft() {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      /* a tab without session storage keeps the values on screen only */
    }
  }

  function eraseDraft() {
    draft = { values: null, key: null, keyValues: null };
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      /* nothing to erase */
    }
  }

  function restoreDraft() {
    let stored = null;
    try {
      stored = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
    } catch (error) {
      stored = null;
    }
    if (!stored || !stored.values) return;
    draft = stored;
    writeValues(stored.values);
  }

  function updateCounter() {
    if (counter && goals) counter.textContent = countCodePoints(goals.value) + " / 2000";
  }

  function onChange() {
    const values = readValues();
    const fingerprint = JSON.stringify(values);
    if (draft.key && draft.keyValues !== fingerprint) {
      draft.key = null;
      draft.keyValues = null;
    }
    draft.values = values;
    saveDraft();
    updateCounter();
  }

  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);

  /* ---------- field messages ---------- */

  function describedBy(name) {
    if (name === "goals") return "goals-hint goals-count";
    if (TEXT_FIELDS.indexOf(name) !== -1) return name + "-hint";
    return name + "-error";
  }

  function controlFor(name) {
    if (LIST_FIELDS.indexOf(name) !== -1) {
      return form.querySelector('input[name="' + name + '"]');
    }
    return document.getElementById(name);
  }

  function clearMessages() {
    FIELDS.forEach(function (name) {
      const message = document.getElementById(name + "-error");
      if (message) message.textContent = "";
      const control = controlFor(name);
      if (!control) return;
      control.removeAttribute("aria-invalid");
      const described = describedBy(name);
      if (LIST_FIELDS.indexOf(name) === -1) control.setAttribute("aria-describedby", described);
    });
    if (alertSlot) alertSlot.replaceChildren();
  }

  function showFieldErrors(errors) {
    clearMessages();
    const failing = FIELDS.filter(function (name) {
      return Object.prototype.hasOwnProperty.call(errors, name);
    });
    failing.forEach(function (name) {
      const message = document.getElementById(name + "-error");
      if (message) message.textContent = errors[name];
      const control = controlFor(name);
      if (!control) return;
      control.setAttribute("aria-invalid", "true");
      if (LIST_FIELDS.indexOf(name) === -1) {
        control.setAttribute("aria-describedby", describedBy(name) + " " + name + "-error");
      }
    });

    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alert");
    const heading = document.createElement("p");
    heading.textContent = "Please correct the fields below.";
    const list = document.createElement("ul");
    failing.forEach(function (name) {
      const entry = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + name;
      link.textContent = FIELD_NAMES[name] + ": " + errors[name];
      link.addEventListener("click", function (event) {
        event.preventDefault();
        focusField(name);
      });
      entry.append(link);
      list.append(entry);
    });
    box.append(heading, list);
    if (alertSlot) alertSlot.replaceChildren(box);

    if (failing.length) focusField(failing[0]);
  }

  function focusField(name) {
    const control = controlFor(name);
    if (!control) return;
    control.focus({ preventScroll: true });
    if (window.relayoEnsureVisible) window.relayoEnsureVisible(control);
  }

  function setStatus(text) {
    if (statusRegion) statusRegion.textContent = text;
  }

  function showAlert(text, withRetry) {
    if (!alertSlot) return;
    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alert");
    const line = document.createElement("p");
    line.textContent = text;
    box.append(line);
    if (withRetry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "pill pill-ghost";
      retry.textContent = "Try again";
      retry.addEventListener("click", function () {
        send();
      });
      box.append(retry);
    }
    alertSlot.replaceChildren(box);
  }

  function setPending(pending) {
    if (!submitButton) return;
    if (pending) {
      submitButton.setAttribute("aria-disabled", "true");
      submitButton.textContent = "Submitting your application…";
    } else {
      submitButton.removeAttribute("aria-disabled");
      submitButton.textContent = "Submit application";
    }
  }

  function showReceived(companyName) {
    setStatus(
      "Thank you, " + companyName +
      ". Our partner team reviews every application and replies by email."
    );
    eraseDraft();
    if (formSlot) formSlot.hidden = true;
    if (received) {
      received.hidden = false;
      if (receivedCompany) receivedCompany.textContent = companyName;
      if (receivedHeading) receivedHeading.focus();
    }
  }

  /* ---------- sending ---------- */

  function keyFor(values) {
    const fingerprint = JSON.stringify(values);
    if (!draft.key || draft.keyValues !== fingerprint) {
      draft.key = crypto.randomUUID();
      draft.keyValues = fingerprint;
    }
    draft.values = values;
    saveDraft();
    return draft.key;
  }

  async function send(attempt) {
    const tries = attempt || 0;
    const values = readValues();
    const key = keyFor(values);
    setPending(true);
    setStatus("Submitting your application…");

    let response;
    try {
      response = await fetch("/api/partner-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(values),
      });
    } catch (error) {
      setPending(false);
      setStatus("");
      showAlert("We couldn't reach Relayo. Your answers are still here.", true);
      return;
    }

    if (response.status >= 500) {
      setPending(false);
      setStatus("");
      showAlert("We couldn't reach Relayo. Your answers are still here.", true);
      return;
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }

    if (response.status === 201) {
      setPending(false);
      showReceived(values.company_name.normalize("NFC").replace(WHITE_SPACE, ""));
      return;
    }

    if (response.status === 409 && payload.error === "request_in_progress") {
      if (tries >= 3) {
        setPending(false);
        setStatus("");
        showAlert("We couldn't reach Relayo. Your answers are still here.", true);
        return;
      }
      window.setTimeout(function () {
        send(tries + 1);
      }, 2000);
      return;
    }

    setPending(false);
    setStatus("");

    if (response.status === 422 && payload.errors) {
      showFieldErrors(payload.errors);
      return;
    }
    if (response.status === 409 && payload.error === "duplicate_application") {
      showAlert(
        "We already have an application from this work email. Our partner team will be in touch.",
        false
      );
      return;
    }
    showAlert("We couldn't reach Relayo. Your answers are still here.", true);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitButton && submitButton.getAttribute("aria-disabled") === "true") return;
    send();
  });

  restoreDraft();
  updateCounter();
})();
