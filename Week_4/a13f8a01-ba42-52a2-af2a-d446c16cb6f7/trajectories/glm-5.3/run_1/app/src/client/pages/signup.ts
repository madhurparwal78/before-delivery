import { el, link, button, heading, navigate } from "../lib/dom.js";
import { Api } from "../lib/api.js";

export async function signupPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset", "aria-hidden": "true" });
  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });
  body.appendChild(heading(1, "Create your account"));

  const alertNode = el("div", { role: "alert", class: "alert", "aria-label": "There is a problem", hidden: "true" });
  const alertHeading = el("p", { text: "There is a problem" });
  const alertList = el("ul");
  alertNode.appendChild(alertHeading);
  alertNode.appendChild(alertList);
  body.appendChild(alertNode);

  const form = el("form", { class: "form-col", novalidate: "true" });
  const fields: Array<{ name: string; label: string; type: string }> = [
    { name: "handle", label: "Handle", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "password", label: "Password", type: "password" },
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of fields) {
    const labelEl = el("label", {}, f.label);
    const input = el("input", { type: f.type, name: f.name, placeholder: f.label });
    input.setAttribute("aria-label", f.label);
    inputs[f.name] = input;
    labelEl.appendChild(input);
    form.appendChild(labelEl);
  }
  const submit = button("Create account", { class: "primary" });
  submit.type = "submit";
  form.appendChild(submit);
  form.appendChild(el("p", {}, "Already have an account? ", link("/signin", "Sign in")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertNode.setAttribute("hidden", "true");
    alertList.innerHTML = "";
    try {
      const res = await Api.post<{ verification: string }>("/api/signup", {
        handle: inputs.handle!.value,
        email: inputs.email!.value,
        password: inputs.password!.value,
      });
      void res;
      navigate("/dashboard");
    } catch (err) {
      const apiErr = err as { fields?: Record<string, string>; message: string };
      const fieldErrors = apiErr.fields ?? {};
      for (const [field, message] of Object.entries(fieldErrors)) {
        const li = el("li");
        const a = link("", message);
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          inputs[field]?.focus();
        });
        li.appendChild(a);
        alertList.appendChild(li);
      }
      if (Object.keys(fieldErrors).length === 0) {
        alertList.appendChild(el("li", { text: apiErr.message }));
      }
      alertNode.removeAttribute("hidden");
    }
  });
  body.appendChild(form);
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}
