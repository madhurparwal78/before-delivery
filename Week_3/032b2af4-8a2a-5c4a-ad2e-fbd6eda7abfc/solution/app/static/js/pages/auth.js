import { api, saveToken, safeNext } from "../core/api.js";
import { $, $$, fieldError, notice } from "../core/dom.js";

const root = $("[data-auth-form]");
const mode = root.dataset.authForm;
const form = $("[data-form]", root);
const next = safeNext(new URLSearchParams(location.search).get("next"));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function mark(input, message) {
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  input.parentElement.querySelector(".field-error")?.remove();
  if (!message) return;
  const id = `${input.id}-error`;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  input.parentElement.append(fieldError(id, message));
}

function clientErrors(values) {
  const errors = {};
  if (mode === "signup") {
    if (!values.name.trim() || values.name.trim().length > 80) errors.name = "Enter a name of 1 to 80 characters.";
    if (!EMAIL.test(values.email.trim())) errors.email = "Enter a valid email address.";
    if (values.password.length < 8) errors.password = "Use a password of at least 8 characters.";
  }
  return errors;
}

const serverMessages = {
  name: "Enter a name of 1 to 80 characters.",
  email: "Enter a valid email address.",
  password: "Use a password of at least 8 characters.",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const slot = $("[data-form-error]", form);
  slot.replaceChildren();
  for (const input of $$("input", form)) mark(input, "");
  const errors = clientErrors(values);
  if (Object.keys(errors).length) {
    for (const [name, message] of Object.entries(errors)) mark(form.elements[name], message);
    form.elements[Object.keys(errors)[0]].focus();
    return;
  }
  const button = $("button[type=submit]", form);
  button.disabled = true;
  const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  const body = mode === "signup"
    ? { name: values.name.trim(), email: values.email.trim(), password: values.password }
    : { email: values.email, password: values.password };
  const result = await api(path, { method: "POST", body });
  button.disabled = false;
  if (result.ok) {
    saveToken(result.data.token, Boolean(values.remember));
    location.assign(next);
  } else if (result.status === 401) {
    slot.append(notice("error", "The username or password did not match. Please try again."));
  } else if (result.status === 409) {
    mark(form.elements.email, "That email is already registered. Log in instead.");
    form.elements.email.focus();
  } else if (result.status === 400 && result.data?.fields) {
    for (const name of Object.keys(result.data.fields)) if (form.elements[name]) mark(form.elements[name], serverMessages[name] || result.data.fields[name]);
  } else {
    slot.append(notice("error", "Something went wrong. Please try again."));
  }
});
