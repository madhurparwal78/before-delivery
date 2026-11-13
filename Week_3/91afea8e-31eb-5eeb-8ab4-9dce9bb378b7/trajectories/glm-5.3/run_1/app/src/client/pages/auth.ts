import { el, busy, announce } from "../ui.ts";
import { get, post, ApiFailure } from "../api.ts";
import { state, navigate, refreshMe } from "../app.ts";

export async function renderSignin(): Promise<HTMLElement> {
  const main = el("main", { class: "auth-main" });
  const panel = el("div", { class: "panel-deep", style: "max-width:520px;margin:0 auto" });
  panel.append(el("h1", { text: "sign in" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  const error = el("p", { class: "field-error" });

  const idLabel = el("label", { class: "field" });
  idLabel.append(el("span", { class: "label-text", text: "Email or phone" }));
  const idInput = el("input", { type: "text", autocomplete: "username" });
  idLabel.append(idInput);

  const passLabel = el("label", { class: "field" });
  passLabel.append(el("span", { class: "label-text", text: "Password" }));
  const passInput = el("input", { type: "password", autocomplete: "current-password" });
  passLabel.append(passInput);

  const submit = el("button", { class: "btn btn-primary", type: "submit", text: "Continue" });
  const form = el("form", {});
  form.append(idLabel, passLabel, submit);

  const forgot = el("a", { href: "/forgot", text: "Forgot password?" });
  const signupLink = el("a", { href: "/signup", text: "new here? make an account" });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.textContent = "";
    void busy(submit, async () => {
      try {
        const res = await post<{ resend_in: number }>("/api/auth/signin", {
          identifier: idInput.value.trim(),
          password: passInput.value,
        });
        window.sessionStorage.setItem("chauraha_resend_in", String(res.resend_in));
        const current = new URLSearchParams(window.location.search);
        const next = current.get("next");
        void navigate(next ? `/signin/code?next=${encodeURIComponent(next)}` : "/signin/code", true);
      } catch (err) {
        if (err instanceof ApiFailure) {
          if (err.code === "invalid_credentials") error.textContent = err.message;
          else error.textContent = err.message;
        }
      }
    });
  });

  panel.append(form, error, forgot, signupLink, status);
  main.append(panel);
  void state;
  return main;
}

export async function renderSigninCode(): Promise<HTMLElement> {
  const main = el("main", { class: "auth-main" });
  const panel = el("div", { class: "panel-deep", style: "max-width:520px;margin:0 auto" });
  const heading = el("h1", { text: "enter your code" });
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  status.textContent = "Enter the 6-digit code we sent to your phone.";
  const error = el("p", { class: "field-error" });

  const codeLabel = el("label", { class: "field" });
  codeLabel.append(el("span", { class: "label-text", text: "6-digit code" }));
  const codeInput = el("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code" });
  codeLabel.append(codeInput);

  const verifyBtn = el("button", { class: "btn btn-primary", type: "submit", text: "Verify" });
  const form = el("form", {});
  form.append(codeLabel, verifyBtn);

  const resendBtn = el("button", { class: "btn btn-ghost", type: "button", text: "Resend code" });
  const countdownEl = el("span", { role: "timer", "aria-label": "Resend countdown", class: "counter" });
  let resendIn = Number(window.sessionStorage.getItem("chauraha_resend_in") ?? "30") || 30;

  const paintResend = () => {
    if (resendIn > 0) {
      resendBtn.disabled = true;
      resendBtn.textContent = `resend in ${resendIn}s`;
    } else {
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend code";
    }
  };
  paintResend();
  const tick = window.setInterval(() => {
    if (resendIn > 0) {
      resendIn -= 1;
      paintResend();
    }
    if (resendIn <= 0) window.clearInterval(tick);
  }, 1000);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.textContent = "";
    void busy(verifyBtn, async () => {
      try {
        await post("/api/auth/signin/verify", { code: codeInput.value.trim() });
        window.clearInterval(tick);
        const params = new URLSearchParams(window.location.search);
        void await refreshMe();
        const next = params.get("next");
        if (next && next.startsWith("/") && !next.startsWith("//")) {
          await mergeGuestCart();
          await navigate(next);
        } else {
          const role = state.account?.role;
          const home = role === "seller" ? "/seller/shipments" : role === "support" ? "/support" : "/";
          await mergeGuestCart();
          await navigate(home);
        }
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });

  resendBtn.addEventListener("click", () => {
    void busy(resendBtn, async () => {
      try {
        const res = await post<{ resend_in: number }>("/api/auth/code/resend", {});
        resendIn = res.resend_in;
        paintResend();
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });

  panel.append(heading, form, error, resendBtn, countdownEl, status);
  main.append(panel);
  return main;
}

/** After full sign-in the guest cart merges line by line and each outcome is announced. */
async function mergeGuestCart(): Promise<void> {
  const raw = window.localStorage.getItem("chauraha_guest_cart");
  if (!raw) return;
  try {
    const lines = JSON.parse(raw) as Array<{ listing_id: string; quantity: number }>;
    if (lines.length === 0) return;
    const res = await post<{ results: Array<{ title: string; outcome: string; quantity: number }> }>("/api/cart/merge", { lines });
    window.sessionStorage.setItem("chauraha_merge", JSON.stringify(res.results));
    window.localStorage.removeItem("chauraha_guest_cart");
  } catch { /* the merge outcome shows on the cart page */ }
}

export async function renderSignup(): Promise<HTMLElement> {
  const main = el("main", { class: "auth-main" });
  const panel = el("div", { class: "panel-deep", style: "max-width:520px;margin:0 auto" });
  panel.append(el("h1", { text: "make an account" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  const error = el("p", { class: "field-error" });

  const fields: Array<[string, string, HTMLInputElement]> = [
    ["Name", "name", el("input", { type: "text", autocomplete: "name" })],
    ["Email", "email", el("input", { type: "email", autocomplete: "email" })],
    ["Phone", "phone", el("input", { type: "tel", autocomplete: "tel", placeholder: "+919800000001" })],
    ["Password", "password", el("input", { type: "password", autocomplete: "new-password" })],
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  const form = el("form", {});
  for (const [label, key, input] of fields) {
    const wrap = el("label", { class: "field" });
    wrap.append(el("span", { class: "label-text", text: label }), input);
    inputs[key] = input;
    form.append(wrap);
  }
  const submit = el("button", { class: "btn btn-primary", type: "submit", text: "Continue" });
  form.append(submit);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.textContent = "";
    void busy(submit, async () => {
      try {
        await post("/api/auth/signup", {
          name: inputs.name.value.trim(),
          email: inputs.email.value.trim(),
          phone: inputs.phone.value.trim(),
          password: inputs.password.value,
        });
        void navigate("/signup/code", true);
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });

  const signinLink = el("a", { href: "/signin", text: "already have an account? sign in" });
  panel.append(form, error, signinLink, status);
  main.append(panel);
  return main;
}

export async function renderSignupCode(): Promise<HTMLElement> {
  const main = el("main", { class: "auth-main" });
  const panel = el("div", { class: "panel-deep", style: "max-width:520px;margin:0 auto" });
  panel.append(el("h1", { text: "enter your code" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  status.textContent = "If this number can be used, we'll text a 6-digit code to it.";
  const error = el("p", { class: "field-error" });
  const codeLabel = el("label", { class: "field" });
  codeLabel.append(el("span", { class: "label-text", text: "6-digit code" }));
  const codeInput = el("input", { type: "text", inputmode: "numeric", maxlength: "6" });
  codeLabel.append(codeInput);
  const verifyBtn = el("button", { class: "btn btn-primary", text: "Verify" });
  const form = el("form", {});
  form.append(codeLabel, verifyBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(verifyBtn, async () => {
      try {
        await post("/api/auth/signup/verify", { code: codeInput.value.trim() });
        await refreshMe();
        await mergeGuestCart();
        await navigate("/");
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });
  panel.append(form, error, status);
  main.append(panel);
  void announce;
  return main;
}

export async function renderForgot(): Promise<HTMLElement> {
  const main = el("main", { class: "auth-main" });
  const panel = el("div", { class: "panel-deep", style: "max-width:520px;margin:0 auto" });
  panel.append(el("h1", { text: "forgot your password?" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Sign-in status" });
  const error = el("p", { class: "field-error" });
  const idLabel = el("label", { class: "field" });
  idLabel.append(el("span", { class: "label-text", text: "Email or phone" }));
  const idInput = el("input", { type: "text" });
  idLabel.append(idInput);
  const codeLabel = el("label", { class: "field" });
  codeLabel.append(el("span", { class: "label-text", text: "6-digit code" }));
  const codeInput = el("input", { type: "text", inputmode: "numeric", maxlength: "6" });
  codeLabel.append(codeInput);
  const newPassLabel = el("label", { class: "field" });
  newPassLabel.append(el("span", { class: "label-text", text: "New password" }));
  const newPassInput = el("input", { type: "password" });
  newPassLabel.append(newPassInput);
  const submit = el("button", { class: "btn btn-primary", text: "Reset password" });
  const form = el("form", {});
  form.append(idLabel, codeLabel, newPassLabel, submit);
  const sendBtn = el("button", { class: "btn btn-yellow", text: "Send code", type: "button" });

  sendBtn.addEventListener("click", () => {
    void busy(sendBtn, async () => {
      error.textContent = "";
      try {
        await post("/api/auth/password/forgot", { identifier: idInput.value.trim() });
        status.textContent = "If this number can be used, we'll text a 6-digit code to it.";
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(submit, async () => {
      error.textContent = "";
      try {
        await post("/api/auth/password/reset", {
          identifier: idInput.value.trim(),
          code: codeInput.value.trim(),
          new_password: newPassInput.value,
        });
        await navigate("/signin");
      } catch (err) {
        if (err instanceof ApiFailure) error.textContent = err.message;
      }
    });
  });
  panel.append(sendBtn, form, error, status);
  main.append(panel);
  return main;
}
