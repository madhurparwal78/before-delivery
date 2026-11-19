/* Register: browser validation by the account field rules (DP-80). */
"use strict";
(() => {
  const form = document.getElementById("signupForm");
  const alertEl = document.getElementById("signupAlert");
  const email = document.getElementById("regEmail");
  const name = document.getElementById("regName");
  const username = document.getElementById("regUsername");
  const password = document.getElementById("regPassword");
  const dob = document.getElementById("regDob");
  const submit = document.getElementById("regSubmit");
  const loginLink = document.getElementById("regLoginLink");
  if (!form) return;

  const EMAIL_TEXT = "Enter a valid email address.";
  const NAME_TEXT = "Display name must be 1 to 32 characters, with no line breaks or control characters.";
  const USERNAME_TEXT = "Username must be 2 to 32 lowercase letters, digits, underscores or periods.";
  const USERNAME_TAKEN = "That username is taken.";
  const PASSWORD_TEXT = "Password must be 8 to 128 characters.";
  const DOB_TEXT = "You must be at least 13 years old.";
  const EMAIL_TAKEN = "That email is already registered.";

  const fields = [
    { input: email, error: "regEmailError", text: EMAIL_TEXT },
    { input: name, error: "regNameError", text: NAME_TEXT },
    { input: username, error: "regUsernameError", text: USERNAME_TEXT },
    { input: password, error: "regPasswordError", text: PASSWORD_TEXT },
    { input: dob, error: "regDobError", text: DOB_TEXT },
  ];

  const codePoints = (s) => Array.from(s).length;
  const hasControl = (s) => Array.from(s).some((c) => c.codePointAt(0) <= 0x1F || c.codePointAt(0) === 0x7F);

  function normalizeNfc(s) {
    return s.normalize ? s.normalize("NFC") : s;
  }

  function currentNext() {
    const raw = new URLSearchParams(location.search).get("next") || "";
    if (!raw) return "";
    if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\" || raw.includes("\\")) return "";
    for (const ch of raw) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1F || code === 0x7F) return "";
    }
    return raw;
  }
  const next = currentNext();
  if (next && loginLink) loginLink.href = "/login?next=" + encodeURIComponent(next);

  function mark(field, message) {
    const err = document.getElementById(field.error);
    if (message) {
      field.input.setAttribute("aria-invalid", "true");
      field.input.setAttribute("aria-describedby", field.error);
      err.textContent = message;
      err.hidden = false;
    } else {
      field.input.removeAttribute("aria-invalid");
      err.textContent = "";
      err.hidden = true;
    }
  }

  function validateAll() {
    const errors = [];
    const emailValue = email.value.trim();
    const local = emailValue.split("@")[0];
    const at = emailValue.lastIndexOf("@");
    const domain = at >= 0 ? emailValue.slice(at + 1) : "";
    const labels = domain.split(".");
    if (!emailValue || emailValue.length > 254 || hasControl(emailValue) || emailValue !== emailValue.trim()
        || !emailValue.includes("@") || !local || !domain || labels.length < 2 || labels.some((l) => !l)) {
      errors.push({ field: fields[0], message: EMAIL_TEXT });
    }
    const nameValue = normalizeNfc(name.value.trim());
    if (!nameValue || codePoints(nameValue) > 32 || hasControl(nameValue)) {
      errors.push({ field: fields[1], message: NAME_TEXT });
    }
    if (!/^[a-z0-9_.]{2,32}$/.test(username.value)) {
      errors.push({ field: fields[2], message: USERNAME_TEXT });
    }
    if (password.value.length < 8 || password.value.length > 128) {
      errors.push({ field: fields[3], message: PASSWORD_TEXT });
    }
    const dobValue = dob.value;
    let dobOk = false;
    if (dobValue) {
      const [y, m, d] = dobValue.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
        const today = new Date();
        const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        let thirteenth;
        try { thirteenth = Date.UTC(y + 13, m - 1, d); } catch (e) { thirteenth = Date.UTC(y + 13, 2, 1); }
        if (m === 2 && d === 29) {
          const test = new Date(Date.UTC(y + 13, 1, 29));
          if (test.getUTCDate() !== 29) thirteenth = Date.UTC(y + 13, 2, 1);
        }
        dobOk = thirteenth <= utcToday;
      }
    }
    if (!dobOk) errors.push({ field: fields[4], message: DOB_TEXT });
    return errors;
  }

  function renderSummary(errors) {
    alertEl.textContent = "";
    if (!errors.length) return;
    const line = document.createElement("p");
    line.textContent = errors.length === 1
      ? "Fix 1 field to continue."
      : `Fix ${errors.length} fields to continue.`;
    alertEl.appendChild(line);
    const list = document.createElement("ul");
    for (const err of errors) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = err.message;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        err.field.input.focus();
      });
      li.appendChild(link);
      list.appendChild(li);
    }
    alertEl.appendChild(list);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errors = validateAll();
    for (const field of fields) mark(field, null);
    if (errors.length) {
      renderSummary(errors);
      for (const err of errors) mark(err.field, err.message);
      errors[0].field.input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Creating account…";
    try {
      const resp = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.value.trim(),
          display_name: name.value.trim(),
          username: username.value,
          password: password.value,
          date_of_birth: dob.value,
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        HUB.setToken(data.access_token, data.user.id);
        // A join from register lands in the default channel; the register entry is replaced.
        const joinMatch = next.match(/^\/servers\/([a-z0-9-]+)\?join=1$/);
        if (joinMatch) {
          const joinResp = await fetch(`/api/servers/${joinMatch[1]}/join`, {
            method: "POST",
            headers: { Authorization: "Bearer " + HUB.state.token, "Content-Type": "application/json" },
            body: "{}",
          });
          const joinData = await joinResp.json();
          if (joinResp.ok) {
            const target = `/channels/${joinData.community_id}/${joinData.default_channel_id}`;
            history.replaceState({}, "", target);
            location.href = target;
            return;
          }
        }
        const target = next || "/servers";
        history.replaceState({}, "", target);
        location.href = target;
      } else {
        const serverErrors = [];
        const byField = { email: [fields[0], EMAIL_TAKEN, EMAIL_TEXT], username: [fields[2], USERNAME_TAKEN, USERNAME_TEXT] };
        if (data && data.error && data.error.field && byField[data.error.field]) {
          const entry = byField[data.error.field];
          serverErrors.push({ field: entry[0], message: entry[1] });
        }
        const allErrors = serverErrors.length ? serverErrors : [];
        renderSummary(allErrors);
        for (const err of allErrors) mark(err.field, err.message);
        if (allErrors.length) allErrors[0].field.input.focus();
        else alertEl.textContent = "Something went wrong. Try again.";
        password.value = "";
      }
    } catch (err) {
      alertEl.textContent = "Something went wrong. Try again.";
      password.value = "";
    }
    submit.disabled = false;
    submit.textContent = "Create an account";
  });
})();
