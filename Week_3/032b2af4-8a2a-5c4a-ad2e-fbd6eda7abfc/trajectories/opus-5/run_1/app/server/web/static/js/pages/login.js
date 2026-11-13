import { api, setToken } from "../api.js";

export function init() {
  const form = document.querySelector("[data-login-form]");
  const error = document.querySelector("[data-login-error]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const { ok, data } = await api("/api/auth/login", {
      method: "POST",
      body: {
        email: form.elements.email.value,
        password: form.elements.password.value,
      },
    });
    if (!ok) {
      error.textContent = "The username or password did not match. Please try again.";
      return;
    }
    setToken(data.token);
    window.location.href = "/dashboard";
  });
}
