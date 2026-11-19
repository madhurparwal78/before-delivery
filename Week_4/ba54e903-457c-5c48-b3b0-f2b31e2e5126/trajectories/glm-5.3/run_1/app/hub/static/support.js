/* Support form: keyboard order, field errors, stable status (DP-48, DP-67). */
"use strict";
(() => {
  const form = document.getElementById("supportForm");
  const email = document.getElementById("supEmail");
  const category = document.getElementById("supCategory");
  const subject = document.getElementById("supSubject");
  const desc = document.getElementById("supDesc");
  const submit = document.getElementById("supSubmit");
  const status = document.getElementById("requestStatus");
  if (!form) return;

  const fields = [
    { input: email, error: "supEmailError", text: "Enter a valid email address." },
    { input: category, error: "supCategoryError", text: "Choose a category." },
    { input: subject, error: "supSubjectError", text: "Subject must be 3 to 120 characters." },
    { input: desc, error: "supDescError", text: "Description must be 10 to 5000 characters." },
  ];

  function mark(field, message) {
    const errorEl = document.getElementById(field.error);
    if (message) {
      field.input.setAttribute("aria-invalid", "true");
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      field.input.removeAttribute("aria-invalid");
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function firstError() {
    for (const field of fields) {
      if (!field.input.getAttribute("aria-invalid")) continue;
      return field;
    }
    return null;
  }

  async function submitForm(e) {
    e.preventDefault();
    let bad = false;
    for (const field of fields) mark(field, null);
    const emailValue = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+\.[^@\s]+$/.test(emailValue) &&
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailValue)) {
      mark(fields[0], fields[0].text);
      bad = true;
    }
    if (!category.value) { mark(fields[1], fields[1].text); bad = true; }
    if (subject.value.length < 3 || subject.value.length > 120) { mark(fields[2], fields[2].text); bad = true; }
    if (desc.value.length < 10 || desc.value.length > 5000) { mark(fields[3], fields[3].text); bad = true; }
    const firstBad = firstError();
    if (firstBad) firstBad.input.focus();
    if (bad) return;

    submit.disabled = true;
    submit.textContent = "Sending request…";
    try {
      const resp = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, category: category.value, subject: subject.value, body: desc.value }),
      });
      const data = await resp.json();
      if (resp.ok) {
        status.textContent = `Request received. Your reference is ${data.reference}.`;
      } else if (resp.status === 429) {
        status.textContent = "Too many requests from this email. Try again later.";
      } else if (data && data.error && data.error.field) {
        const byField = { email: fields[0], category: fields[1], subject: fields[2], body: fields[3] };
        const field = byField[data.error.field];
        if (field) mark(field, field.text);
        if (field) field.input.focus();
      } else {
        status.textContent = "Your request could not be sent. Try again.";
      }
    } catch (err) {
      status.textContent = "Your request could not be sent. Try again.";
    }
    submit.disabled = false;
    submit.textContent = "Submit request";
  }

  form.addEventListener("submit", submitForm);
})();
