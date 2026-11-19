import { el, button, heading, link, navigate } from "../lib/dom.js";
import { Api } from "../lib/api.js";

export async function signinPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset", "aria-hidden": "true" });
  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });
  body.appendChild(heading(1, "Sign in"));

  const alertNode = el("div", { role: "alert", class: "alert", "aria-label": "Sign in problem", hidden: "true" });
  body.appendChild(alertNode);

  const form = el("form", { class: "form-col", novalidate: "true" });
  const email = el("input", { type: "email", placeholder: "Email" });
  email.setAttribute("aria-label", "Email");
  const password = el("input", { type: "password", placeholder: "Password" });
  password.setAttribute("aria-label", "Password");
  const emailLabel = el("label", {}, "Email");
  emailLabel.appendChild(email);
  const passwordLabel = el("label", {}, "Password");
  passwordLabel.appendChild(password);
  form.appendChild(emailLabel);
  form.appendChild(passwordLabel);
  const submit = button("Sign in", { class: "primary" });
  submit.type = "submit";
  form.appendChild(submit);
  form.appendChild(el("p", {}, "No account yet? ", link("/signup", "Sign up")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertNode.setAttribute("hidden", "true");
    try {
      await Api.post("/api/signin", { email: email.value, password: password.value });
      navigate("/dashboard");
    } catch (err) {
      alertNode.textContent = (err as { message: string }).message;
      alertNode.removeAttribute("hidden");
    }
  });
  body.appendChild(form);
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}
