import { api, setToken } from "../api.js";

const FIELDS = ["name", "email", "password"];

export function init() {
  const form = document.querySelector("[data-signup-form]");
  const summary = document.querySelector("[data-signup-error]");

  const clear = () => {
    summary.textContent = "";
    FIELDS.forEach((field) => {
      form.elements[field].setAttribute("aria-invalid", "false");
      document.getElementById(`signup-${field}-error`).textContent = "";
    });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clear();
    const { ok, status, data } = await api("/api/auth/signup", {
      method: "POST",
      body: {
        name: form.elements.name.value,
        email: form.elements.email.value,
        password: form.elements.password.value,
      },
    });
    if (ok) {
      setToken(data.token);
      window.location.href = "/dashboard";
      return;
    }
    if (status === 409) {
      form.elements.email.setAttribute("aria-invalid", "true");
      document.getElementById("signup-email-error").textContent = "That email is already registered.";
      summary.textContent = "That email is already registered.";
      return;
    }
    const fields = data?.fields || {};
    FIELDS.forEach((field) => {
      if (fields[field]) {
        form.elements[field].setAttribute("aria-invalid", "true");
        document.getElementById(`signup-${field}-error`).textContent = fields[field];
      }
    });
    summary.textContent = "Please correct the fields marked below.";
  });
}
