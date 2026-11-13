// The sign-in dialog, shared by every page. Opens over any screen and any other
// dialog, keeps values on Escape, and returns focus to its opener.
import { apiJson, maybe, qs } from "./core";

export function openSignIn(opener: HTMLElement | null): Promise<boolean> {
  let dlg = maybe<HTMLDialogElement>("dialog#signin");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "signin";
    dlg.setAttribute("aria-label", "Sign in");
    dlg.innerHTML = `
      <h2>Sign in</h2>
      <div class="dlg-body">
        <label>Mobile number <input type="text" id="si-mobile" autocomplete="off"></label>
        <label>Password <input type="password" id="si-password" autocomplete="off"></label>
        <p class="field-error" id="si-error" hidden></p>
      </div>
      <div class="dlg-actions">
        <button class="primary" id="si-go">Sign in</button>
        <button class="secondary" id="si-create-toggle">New here? Create an account</button>
      </div>`;
    document.body.appendChild(dlg);
  }
  const mobileInput = qs<HTMLInputElement>("#si-mobile", dlg);
  const passwordInput = qs<HTMLInputElement>("#si-password", dlg);
  mobileInput.value = "";
  passwordInput.value = "";
  const errorEl = qs<HTMLElement>("#si-error", dlg);
  errorEl.hidden = true;
  let registering = false;
  const createToggle = qs<HTMLButtonElement>("#si-create-toggle", dlg);

  const showRegisterFields = () => {
    if (!dlg.querySelector("#si-name")) {
      const nameLbl = document.createElement("label");
      nameLbl.id = "si-name";
      nameLbl.innerHTML = `Full name <input type="text" id="si-fullname" autocomplete="off">`;
      dlg.querySelector(".dlg-body")?.appendChild(nameLbl);
      const createBtn = document.createElement("button");
      createBtn.className = "primary";
      createBtn.id = "si-register";
      createBtn.textContent = "Create account";
      dlg.querySelector(".dlg-actions")?.appendChild(createBtn);
      createBtn.addEventListener("click", () => void submit());
    }
    qs<HTMLElement>("#si-name", dlg).hidden = false;
  };

  createToggle.addEventListener("click", () => {
    registering = !registering;
    if (registering) {
      createToggle.textContent = "Back to sign in";
      showRegisterFields();
      qs<HTMLButtonElement>("#si-register", dlg).hidden = false;
      qs<HTMLButtonElement>("#si-go", dlg).hidden = true;
    } else {
      createToggle.textContent = "New here? Create an account";
      qs<HTMLButtonElement>("#si-register", dlg).hidden = true;
      qs<HTMLButtonElement>("#si-go", dlg).hidden = false;
    }
  });

  const submit = async (): Promise<void> => {
    const mobile = mobileInput.value.trim();
    const password = passwordInput.value;
    errorEl.hidden = true;
    if (registering) {
      const name = (maybe<HTMLInputElement>("#si-fullname", dlg)?.value ?? "").trim();
      if (name.length < 1) {
        errorEl.textContent = "Enter your full name.";
        errorEl.hidden = false;
        return;
      }
      if (!/^[6-9]\d{9}$/.test(mobile)) {
        errorEl.textContent = "Enter a 10-digit mobile number.";
        errorEl.hidden = false;
        return;
      }
      if (password.length < 8) {
        errorEl.textContent = "Use at least 8 characters.";
        errorEl.hidden = false;
        return;
      }
      const res = await apiJson<{ user: unknown }>("/api/auth/register", "POST", { name, mobile, password });
      if (!res.ok) {
        errorEl.textContent =
          res.fail.code === "mobile_taken"
            ? "That mobile number already has an account."
            : "Enter a 10-digit mobile number.";
        errorEl.hidden = false;
        return;
      }
      dlg.close();
      resolveSignIn(true);
      return;
    }
    const res = await apiJson<{ user: { id: string; role: string; name: string } }>("/api/auth/signin", "POST", { mobile, password });
    if (!res.ok) {
      errorEl.textContent = "That mobile number and password do not match.";
      errorEl.hidden = false;
      return;
    }
    dlg.close();
    resolveSignIn(true);
  };

  let resolveSignIn: (ok: boolean) => void = () => {};
  qs<HTMLButtonElement>("#si-go", dlg).addEventListener("click", () => void submit());

  return new Promise<boolean>((resolve) => {
    resolveSignIn = resolve;
    dlg.addEventListener(
      "close",
      () => {
        // Escape closes the dialog, keeps the values, and returns focus
        (opener ?? document.body).focus();
        resolve(false);
      },
      { once: true }
    );
    dlg.showModal();
    mobileInput.focus();
  });
}
